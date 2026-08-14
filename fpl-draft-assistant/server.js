import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getBootstrap,
  getMainGameData,
  getLeagueDetails,
  getDraftChoices,
  getElementStatus,
  getEventLive,
  getGameStatus,
  readBaseline,
  captureBaseline,
} from "./lib/fpl.js";
import { buildRankings } from "./lib/rankings.js";
import { buildFixtureContext } from "./lib/fixtures.js";
import { buildSeasonProjections, buildBaseline, PLANNING_WINDOW } from "./lib/season.js";
import { pickLineup } from "./lib/lineup.js";
import { buildWaiverBoard } from "./lib/waivers.js";
import { buildSeasonOverview } from "./lib/league.js";
import { suggestTrades } from "./lib/trades.js";
import { buildLearning, correctionsFrom, normaliseCorrections } from "./lib/learning.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
// Nova's live web search. Set NOVA_WEB_SEARCH=off to answer from the model
// alone; each search is billed to the owner's Anthropic key.
const WEB_SEARCH_ENABLED = (process.env.NOVA_WEB_SEARCH || "on").toLowerCase() !== "off";
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 };

// ---------- FPL data routes ----------

app.get("/api/bootstrap", async (_req, res) => {
  try {
    const { data, source } = await getBootstrap();
    // Opening fixtures come from the main game. If they are unreachable the
    // ranking model drops to its historical signals rather than failing.
    const main = await getMainGameData({ allowSample: source === "sample" });
    const fixtureContext = buildFixtureContext(main.teams, main.fixtures);
    const rankings = buildRankings(data, { fixtureContext });
    res.json({
      source,
      ...rankings,
      // The client needs to know which gameweek is next to work out who it is
      // playing and what to project.
      currentEvent: Number(data?.events?.current) || 0,
      teams: data.teams || [],
      fixtures: rankings.fixturesAvailable ? fixtureContext : null,
      fixturesSource: rankings.fixturesAvailable ? main.source : "unavailable",
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * Shared in-season projection build: expected points per gameweek over a
 * planning window that starts at the next gameweek, rather than the draft
 * board's valuation. Used by the season list and the weekly lineup alike so
 * both always speak about players in the same numbers.
 */
async function projectSeason(windowRequest, corrections = null) {
  const window = Math.min(Math.max(Number(windowRequest) || PLANNING_WINDOW, 1), 10);
  const { data, source } = await getBootstrap();
  if (source === "live") captureBaseline(data, buildBaseline);

  const currentEvent = Number(data?.events?.current) || 0;
  const main = await getMainGameData({ allowSample: source === "sample" });
  const fixtureContext = buildFixtureContext(main.teams, main.fixtures, {
    firstEvent: currentEvent + 1,
    gameweeks: window,
  });

  const projections = buildSeasonProjections(data, {
    fixtureContext,
    currentEvent,
    window,
    baseline: readBaseline()?.players || null,
    corrections: normaliseCorrections(corrections),
  });
  return {
    source,
    fixturesSource: main.source,
    fixtureContext,
    projections,
    deadline: nextDeadline(main.events, currentEvent + 1),
  };
}

/**
 * When the next gameweek locks. Comes from the main game, which publishes the
 * deadline the draft game shares, because the matches are the same.
 */
function nextDeadline(events, event) {
  const row = (events || []).find((e) => Number(e.id) === Number(event));
  if (!row?.deadline_time) return null;
  const at = new Date(row.deadline_time);
  if (Number.isNaN(at.getTime())) return null;
  return { event: Number(event), at: row.deadline_time, hoursAway: (at.getTime() - Date.now()) / 3600000 };
}

app.get("/api/season", async (req, res) => {
  try {
    const { source, fixturesSource, fixtureContext, projections, deadline } = await projectSeason(req.query.window);
    res.json({ source, fixturesSource, fixtures: fixtureContext, deadline, ...projections });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * The weekly decision: the best legal eleven from a squad, and the same for a
 * head-to-head opponent so the week has a projected scoreline. The squads come
 * from the client because it is the client that knows who owns whom, whether
 * from live draft picks or manual marks.
 */
app.post("/api/my-week", async (req, res) => {
  try {
    // The league's own ownership feed knows about waiver moves since the draft,
    // so prefer it over whatever the client has marked.
    const ownership = await readOwnership(req.body?.leagueId);
    const squadOf = (entryId, fallback) => {
      const fromFeed = entryId ? ownership.byEntry.get(Number(entryId)) : null;
      return { elements: new Set(fromFeed || elementIds(fallback)), fromFeed: Boolean(fromFeed) };
    };

    const me = squadOf(req.body?.myEntryId, req.body?.elements);
    const them = squadOf(req.body?.opponentEntryId, req.body?.opponentElements);
    const { source, fixturesSource, fixtureContext, projections, deadline } = await projectSeason(
      req.body?.window,
      req.body?.corrections
    );

    const squadFor = (set) => projections.players.filter((p) => set.has(p.id));
    const mySquad = squadFor(me.elements);
    const theirSquad = squadFor(them.elements);

    res.json({
      source,
      fixturesSource,
      fixtures: fixtureContext,
      squadSource: me.fromFeed ? "league" : "marks",
      ownershipError: ownership.error,
      deadline,
      corrections: projections.corrections,
      currentEvent: projections.currentEvent,
      nextEvent: projections.currentEvent + 1,
      window: projections.window,
      preSeason: projections.preSeason,
      fixturesAvailable: projections.fixturesAvailable,
      baselineAvailable: projections.baselineAvailable,
      lineup: pickLineup(mySquad),
      // A player who has left the league is dropped from the projection, so a
      // squad can legitimately come back short of what was asked for.
      unknown: me.elements.size - mySquad.length,
      opponent: them.elements.size ? pickLineup(theirSquad) : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const elementIds = (value) =>
  Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];

/**
 * Who owns whom, from the league's element-status feed. This is the only source
 * that knows about waiver moves since the draft, so it is preferred everywhere,
 * with the client's own view of the draft as the fallback.
 *
 * The feed's owner field carries an entry_id. That is a different number from
 * the league_entry id used by the matches and standings feeds, so anything that
 * needs to line up with those has to be mapped through league_entries.
 */
async function readOwnership(leagueId) {
  const empty = {
    byEntry: new Map(),
    owned: new Set(),
    source: "unavailable",
    error: "",
    pendingClaims: 0,
  };
  if (!leagueId) return empty;
  try {
    const rows = (await getElementStatus(leagueId))?.element_status || [];
    if (!rows.length) return empty;
    const byEntry = new Map();
    const owned = new Set();
    let pendingClaims = 0;
    for (const row of rows) {
      const element = Number(row.element);
      const owner = row.owner === null || row.owner === undefined ? null : Number(row.owner);
      if (owner !== null) {
        if (!byEntry.has(owner)) byEntry.set(owner, []);
        byEntry.get(owner).push(element);
        owned.add(element);
      } else if (row.status !== undefined && String(row.status).toLowerCase() !== "a") {
        // Unowned but not available means a claim is already in for them.
        owned.add(element);
        pendingClaims += 1;
      }
    }
    return { byEntry, owned, source: "league", error: "", pendingClaims };
  } catch (err) {
    return { ...empty, error: String(err.message || err) };
  }
}

/**
 * Free agents and the claims worth making.
 */
app.post("/api/free-agents", async (req, res) => {
  try {
    const leagueId = req.body?.leagueId;
    const ownership = await readOwnership(leagueId);
    const myEntryId = Number(req.body?.myEntryId) || null;
    const fromFeed = myEntryId ? ownership.byEntry.get(myEntryId) : null;

    // Waiver order decides who gets first refusal, so it changes whether a
    // claim is worth making at all.
    let waiver = null;
    let transactionMode = "";
    if (leagueId) {
      try {
        const details = await getLeagueDetails(leagueId);
        transactionMode = details?.league?.transaction_mode || "";
        const entries = details?.league_entries || [];
        const me = entries.find((e) => String(e.entry_id) === String(myEntryId));
        if (me && Number(me.waiver_pick)) waiver = { pick: Number(me.waiver_pick), of: entries.length };
      } catch {
        // The waiver order is a nicety; the rankings stand without it.
      }
    }

    const owned = ownership.source === "league" ? ownership.owned : new Set(elementIds(req.body?.ownedElements));
    const mine = new Set(fromFeed || elementIds(req.body?.elements));

    const { source, fixturesSource, fixtureContext, projections, deadline } = await projectSeason(
      req.body?.window,
      req.body?.corrections
    );
    const board = buildWaiverBoard(projections.players, { owned, mine });

    res.json({
      source,
      fixturesSource,
      fixtures: fixtureContext,
      ownershipSource: ownership.source === "league" ? "league" : "picks",
      ownershipError: ownership.error,
      pendingClaims: ownership.pendingClaims,
      squadSource: fromFeed ? "league" : "marks",
      waiver,
      transactionMode,
      deadline,
      corrections: projections.corrections,
      currentEvent: projections.currentEvent,
      nextEvent: projections.currentEvent + 1,
      window: projections.window,
      fixturesAvailable: projections.fixturesAvailable,
      ...board,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * The season from the league's point of view: the table, how strong each squad
 * is from here, and who the user still has to play. Every squad is projected
 * the same way the user's own is, so "strength" means one thing throughout: the
 * points a manager's best legal eleven is expected to score in a gameweek.
 */
app.post("/api/season-overview", async (req, res) => {
  try {
    const leagueId = req.body?.leagueId;
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });

    const details = await getLeagueDetails(leagueId);
    const entries = details?.league_entries || [];
    // The matches and standings feeds work in league_entry ids, while ownership
    // and picks work in entry_ids, so squads are rekeyed once, here.
    const leagueEntryFor = (entryId) => {
      const entry = entries.find((e) => String(e.entry_id) === String(entryId));
      return entry ? entry.id : null;
    };

    const squads = new Map();
    const ownership = await readOwnership(leagueId);
    let ownershipSource = ownership.source;
    const ownershipError = ownership.error;
    for (const [entryId, elements] of ownership.byEntry) {
      const key = leagueEntryFor(entryId);
      if (key !== null) squads.set(key, elements);
    }
    if (!squads.size && req.body?.squadsByEntryId) {
      for (const [entryId, elements] of Object.entries(req.body.squadsByEntryId)) {
        const key = leagueEntryFor(entryId);
        if (key !== null) squads.set(key, elementIds(elements));
      }
      if (squads.size) ownershipSource = "picks";
    }

    const { source, projections } = await projectSeason(req.body?.window, req.body?.corrections);
    const byId = new Map(projections.players.map((p) => [p.id, p]));
    const strengths = {};
    for (const [owner, elements] of squads) {
      const lineup = pickLineup(elements.map((id) => byId.get(id)).filter(Boolean));
      if (lineup.playable) strengths[owner] = lineup.expected;
    }

    const overview = buildSeasonOverview({
      entries,
      standings: details?.standings || [],
      matches: details?.matches || [],
      strengths,
      myEntryId: Number(req.body?.myEntryId) || null,
      fromEvent: projections.currentEvent + 1,
      upcoming: Math.min(Math.max(Number(req.body?.upcoming) || 5, 1), 38),
    });

    // Some leagues hold a second draft mid-season, which changes how much the
    // rest of the season is worth planning for.
    const nextDraft = (details?.league?.drafts || [])
      .filter((d) => !d.draft_completed && Number(d.event) > projections.currentEvent)
      .sort((a, b) => Number(a.event) - Number(b.event))[0];

    res.json({
      source,
      leagueName: details?.league?.name || "",
      transactionMode: details?.league?.transaction_mode || "",
      nextDraft: nextDraft ? { event: Number(nextDraft.event), at: nextDraft.draft_dt || "" } : null,
      ownershipSource,
      ownershipError,
      currentEvent: projections.currentEvent,
      nextEvent: projections.currentEvent + 1,
      window: projections.window,
      ...overview,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

/**
 * Trades, against every rival at once, because the useful question is not
 * "is this trade good" but "where in the league is there a deal". Each swap is
 * valued by re-picking both elevens; see lib/trades.js for why that means a
 * like-for-like trade cannot help both sides.
 */
app.post("/api/trades", async (req, res) => {
  try {
    const leagueId = req.body?.leagueId;
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    const myEntryId = Number(req.body?.myEntryId) || null;

    const details = await getLeagueDetails(leagueId);
    const entries = details?.league_entries || [];
    const ownership = await readOwnership(leagueId);

    const { source, projections } = await projectSeason(req.body?.window, req.body?.corrections);
    const byId = new Map(projections.players.map((p) => [p.id, p]));
    const squadOf = (elements) => (elements || []).map((id) => byId.get(id)).filter(Boolean);

    const myElements = ownership.byEntry.get(myEntryId) || elementIds(req.body?.elements);
    const mySquad = squadOf(myElements);

    const rivals = [];
    for (const entry of entries) {
      if (entry.entry_id === myEntryId) continue;
      const theirSquad = squadOf(ownership.byEntry.get(entry.entry_id));
      if (!theirSquad.length) continue;
      const result = suggestTrades(mySquad, theirSquad, { limit: 3 });
      rivals.push({
        entryId: entry.entry_id,
        name: entry.entry_name || `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim(),
        manager: `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim(),
        ...result,
      });
    }
    // The rival with the biggest gain on offer goes first.
    const topGain = (rival) => (rival.best[0] ? rival.best[0].myGain : -Infinity);
    rivals.sort((a, b) => topGain(b) - topGain(a));

    res.json({
      source,
      leagueName: details?.league?.name || "",
      tradesAllowed: (details?.league?.trades || "") !== "n",
      squadSource: ownership.byEntry.has(myEntryId) ? "league" : "marks",
      ownershipError: ownership.error,
      currentEvent: projections.currentEvent,
      nextEvent: projections.currentEvent + 1,
      window: projections.window,
      myEleven: rivals[0]?.myEleven ?? null,
      myFormation: rivals[0]?.myFormation ?? "",
      squadKnown: mySquad.length > 0,
      rivals,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/league/:id", async (req, res) => {
  try {
    res.json(await getLeagueDetails(req.params.id));
  } catch (err) {
    res.status(502).json({ error: `Could not load league ${req.params.id}: ${err.message}` });
  }
});

app.get("/api/league/:id/choices", async (req, res) => {
  try {
    res.json(await getDraftChoices(req.params.id));
  } catch (err) {
    res.status(502).json({ error: `Could not load draft picks: ${err.message}` });
  }
});

app.get("/api/league/:id/element-status", async (req, res) => {
  try {
    res.json(await getElementStatus(req.params.id));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

/**
 * What the projections were worth. The client keeps the log of what was
 * projected each gameweek, because it is the only thing here with storage that
 * survives a redeploy. The actual scores come from the league's own match list,
 * and the per-player detail from the gameweek's live feed when it answers.
 */
app.post("/api/learning", async (req, res) => {
  try {
    const leagueId = req.body?.leagueId;
    const myEntryId = Number(req.body?.myEntryId) || null;
    if (!leagueId || !myEntryId) return res.status(400).json({ error: "leagueId and myEntryId required" });

    const details = await getLeagueDetails(leagueId);
    const entries = details?.league_entries || [];
    // The log is keyed by entry_id; matches work in league_entry ids.
    const me = entries.find((e) => String(e.entry_id) === String(myEntryId));
    if (!me) return res.status(404).json({ error: "That team is not in this league." });

    const log = Array.isArray(req.body?.log) ? req.body.log : [];
    const matches = details?.matches || [];
    const scored = new Set(
      matches.filter((m) => m.finished === true).map((m) => Number(m.event))
    );

    // Per-player results are a nicety: without them the overall figures still
    // stand, only the per-position breakdown is missing.
    const actuals = {};
    let liveSource = "unavailable";
    let liveError = "";
    const wanted = [...new Set(log.map((e) => Number(e?.event)).filter((e) => e && scored.has(e)))];
    for (const event of wanted) {
      try {
        const live = await getEventLive(event, { finished: true });
        const elements = live?.elements;
        if (!elements) continue;
        const points = {};
        // The feed has been seen keyed by element id; tolerate an array too.
        const rows = Array.isArray(elements) ? elements.entries() : Object.entries(elements);
        for (const [key, value] of rows) {
          const total = value?.stats?.total_points ?? value?.total_points;
          if (total !== undefined && total !== null) points[Number(value?.id ?? key)] = Number(total);
        }
        if (Object.keys(points).length) {
          actuals[event] = points;
          liveSource = "live";
        }
      } catch (err) {
        liveError = String(err.message || err);
      }
    }

    const learning = buildLearning({ log, matches, myEntryId: me.id, actuals });
    res.json({
      ...learning,
      liveSource,
      liveError,
      scoredEvents: [...scored].sort((a, b) => a - b),
      corrections: correctionsFrom(learning),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

/**
 * Which upstream feeds actually answer from the server, which is a different
 * question from whether they answer in a logged-in browser. One page to check
 * rather than several URLs to try by hand.
 */
app.get("/api/health", async (req, res) => {
  const leagueId = req.query.league;
  const checks = [];
  const check = async (name, note, run) => {
    const started = Date.now();
    try {
      const detail = await run();
      checks.push({ name, note, ok: true, ms: Date.now() - started, detail });
    } catch (err) {
      checks.push({ name, note, ok: false, ms: Date.now() - started, error: String(err.message || err) });
    }
  };

  await check("draft bootstrap", "the player pool, and public", async () => {
    const { data, source } = await getBootstrap();
    if (source !== "live") throw new Error("falling back to the bundled demo data");
    return `${(data.elements || []).length} players, gameweek ${data?.events?.current || 0} played`;
  });
  await check("main game", "fixture difficulty and deadlines", async () => {
    const main = await getMainGameData();
    if (main.source !== "live") throw new Error(main.error || "unreachable");
    return `${main.teams.length} clubs, ${main.fixtures.length} fixtures, ${(main.events || []).length} gameweeks`;
  });

  if (leagueId) {
    await check("league details", "standings, fixtures and who is in the league", async () => {
      const details = await getLeagueDetails(leagueId);
      const entries = (details?.league_entries || []).length;
      if (!entries) throw new Error("answered, but with no entries");
      return `${entries} teams, ${(details.matches || []).length} matches, draft ${details?.league?.draft_status || "unknown"}`;
    });
    await check("element status", "who owns whom, including waiver moves", async () => {
      const rows = (await getElementStatus(leagueId))?.element_status || [];
      const owned = rows.filter((r) => r.owner !== null && r.owner !== undefined).length;
      if (!rows.length) throw new Error("answered, but with no rows");
      return `${rows.length} players, ${owned} owned`;
    });
    await check("draft picks", "the draft itself, used as a fallback", async () => {
      const choices = (await getDraftChoices(leagueId))?.choices || [];
      return `${choices.length} picks`;
    });
  }

  const failed = checks.filter((c) => !c.ok);
  res.status(failed.length ? 207 : 200).json({
    ok: failed.length === 0,
    league: leagueId || null,
    hint: leagueId
      ? undefined
      : "Add ?league=YOUR_LEAGUE_ID to also check the feeds behind the season, free agent and trade views.",
    checks,
  });
});

/**
 * The pre-season snapshot, as a file to save. The server takes this by itself
 * the first time it sees live pre-season data, but it writes to disk, and a host
 * that rebuilds its filesystem on deploy loses it. Downloading this and
 * committing it to lib/baseline.json makes it permanent, which matters because
 * once gameweek 1 starts the numbers behind it no longer exist anywhere.
 */
app.get("/api/baseline", async (_req, res) => {
  const offer = (baseline) => {
    res.setHeader("content-disposition", 'attachment; filename="baseline.json"');
    res.json(baseline);
  };
  const existing = readBaseline();
  if (existing) return offer(existing);
  try {
    const { data, source } = await getBootstrap();
    if (source !== "live") {
      return res.status(503).json({ error: "Live FPL data is unreachable, so there is nothing to snapshot." });
    }
    const current = Number(data?.events?.current) || 0;
    if (current > 0) {
      return res.status(409).json({
        error: `Gameweek ${current} has been played, so the feed now holds this season's numbers rather than last season's. There is nothing left to capture.`,
      });
    }
    return offer(buildBaseline(data));
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/game", async (_req, res) => {
  try {
    res.json(await getGameStatus());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---------- AI chat ----------

/** Today's date in British form, computed per request so Nova is never stale. */
function todayInWords(now = new Date()) {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Pull sources out of a Messages API response. Citations attached to the text
 * are the honest answer; if the model searched but cited nothing, fall back to
 * the results it read.
 */
function collectSources(content) {
  const cited = new Map();
  const searched = new Map();
  const add = (map, url, title) => {
    if (!url || map.has(url)) return;
    map.set(url, { title: String(title || url).slice(0, 200), url });
  };
  for (const block of content || []) {
    for (const citation of block?.citations || []) add(cited, citation.url, citation.title);
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result?.type === "web_search_result") add(searched, result.url, result.title);
      }
    }
  }
  const sources = cited.size ? [...cited.values()] : [...searched.values()].slice(0, 4);
  return sources.slice(0, 8);
}

function buildSystemPrompt(context, { webSearch = false } = {}) {
  // The same assistant serves two very different jobs: a one-off draft, and
  // then a season of weekly decisions. Advice framed around picking players is
  // useless once the squads are settled, so the framing follows the gameweek.
  const gameweek = Number(context?.gameweek) || 0;
  const inSeason = gameweek > 0;
  const lines = [
    `You are Nova, a warm, witty Fantasy Premier League Draft strategist embedded in an FPL Draft app. Think charismatic match-day pundit: friendly, a little playful, always on the user's side, but focused on winning their league. Keep the relationship professional and football-focused; deflect flirtation with light humour and steer back to the football.`,
    "League format: official FPL Draft, 10 teams, 15-player squads (2 GKP, 5 DEF, 5 MID, 3 FWD), snake draft, no player budgets, one owner per player.",
    "Scoring is standard FPL: appearance, goals (position-weighted), assists, clean sheets, bonus points; goalkeepers earn save points.",
    "Answer briefly and decisively. When asked to choose, give a clear first choice plus one alternative, with a one-line reason each.",
    "Use British English. Never use em dashes.",
  ];
  if (inSeason) {
    lines.push(
      `The draft is long finished and the season is under way. Gameweek ${gameweek} is next. Every question is about managing a settled squad, not about drafting.`,
      "The levers available each week: which eleven of the fifteen to start (there is no captain in this league, so the eleven is the whole decision), claiming free agents or waivers, and proposing trades with rival managers. Head-to-head results decide the league, so beating one specific opponent this week can matter more than maximising points in the abstract.",
      "In-season principles: minutes are worth more than reputation, because a benched star scores nothing; a short run of fixtures swings a week far more than a season average does; do not chase one big score from a player who does not start; a free agent who plays every week beats a squad player with a better name; when trading, value the rest of the season for both sides and be honest about which side wins.",
      `Today's date is ${todayInWords()}. Team news moves fast, so injuries, suspensions, rotation and predicted line-ups for gameweek ${gameweek} matter more than anything historical.`
    );
  } else {
    lines.push(
      "Core draft principles: value over replacement matters more than raw points (elite MIDs and premium FWDs go early; GKP late); plan two picks ahead in a snake draft; watch positional runs; target secure starters over rotation risks; fixture difficulty matters for early-season momentum.",
      `Today's date is ${todayInWords()}. A new Premier League season is about to start, so pre-season news matters: summer transfers, new managers, promoted clubs, friendlies form, predicted line-ups and injury updates all move draft value.`
    );
  }
  if (webSearch) {
    lines.push(
      inSeason
        ? `You have a web search tool. Search when the answer depends on anything recent: injury and fitness updates, suspensions, predicted line-ups for gameweek ${gameweek}, rotation and rest, penalty and set-piece duties, a manager change, or a completed transfer. Search at most a couple of times, prefer recent and reputable football sources, and say plainly if the picture is still unclear.`
        : "You have a web search tool. Search when the answer depends on anything recent or anything after your training data: completed or rumoured transfers, injury and fitness news, pre-season form, predicted line-ups, penalty and set-piece duties, manager changes, or a player's current club. Search at most a couple of times, prefer recent and reputable football sources, and say plainly if the picture is still unclear.",
      inSeason
        ? "Do not search for questions you can already answer well: the scoring rules, how the projections work, reading the user's own squad, or general advice on managing a squad. Those should come back fast."
        : "Do not search for questions you can already answer well: draft strategy, scoring rules, positional value, snake-draft tactics, or reading the user's own roster. Those should come back fast."
    );
  } else {
    lines.push(
      "You have no web search available in this deployment. If a question turns on very recent news, say what you know, flag that it may be out of date, and suggest the user checks the latest team news."
    );
  }
  if (context?.myRoster?.length) {
    lines.push(
      inSeason
        ? `The user's squad: ${context.myRoster.join(", ")}.`
        : `The user's roster so far: ${context.myRoster.join(", ")}.`
    );
  }
  if (context?.opponent) {
    lines.push(
      `The user's head-to-head opponent in gameweek ${gameweek} is ${context.opponent}.` +
        (context.opponentSquad?.length ? ` Their squad: ${context.opponentSquad.join(", ")}.` : "")
    );
  }
  // Nova should reason from the app's own conclusions rather than rederive them,
  // and should be able to disagree with them out loud when she has a reason.
  if (context?.lineup) {
    lines.push(
      `The app has worked out the user's best legal eleven for gameweek ${gameweek} and it is: ${context.lineup}. ` +
        "Treat that as the starting point. If you would change it, say which player and why, in one line."
    );
  }
  if (context?.bench) lines.push(`Left on the bench: ${context.bench}.`);
  if (context?.projection) lines.push(`The projected gameweek: ${context.projection}.`);
  if (context?.warnings?.length) {
    lines.push(`Flags on the eleven the app picked: ${context.warnings.join("; ")}.`);
  }
  if (context?.claims?.length) {
    lines.push(
      // The summaries end in a full stop of their own, so trim before joining.
      `Free agent claims the app rates as worthwhile, best first: ${context.claims
        .map((claim) => String(claim).replace(/\.\s*$/, ""))
        .join("; ")}. ` +
        "These are same-position swaps, because the squad has to stay at 2 GKP, 5 DEF, 5 MID and 3 FWD."
    );
  }
  if (context?.deadline) lines.push(`The gameweek ${gameweek} deadline is ${context.deadline}.`);
  if (context?.learning?.length) {
    lines.push(
      "How the app's own projections have actually performed so far, which you should take into account and can quote:\n" +
        context.learning.map((line) => `- ${line}`).join("\n")
    );
  }
  if (context?.nextPick) {
    lines.push(`The user picks next at overall pick ${context.nextPick}.`);
  }
  if (context?.bestAvailable) {
    lines.push(
      (inSeason
        ? "Players nobody in the league owns, by position, best first (name, team, position, projected points, value over replacement, average difficulty of the opening gameweeks where 1 is easiest and 5 hardest). These are the free agents available to claim:\n"
        : "Best available by position right now (name, team, position, projected points, value over replacement, average difficulty of gameweeks 1 to 6 where 1 is easiest and 5 hardest):\n") +
        context.bestAvailable
    );
  }
  if (!inSeason && context?.recentPicks?.length) {
    lines.push(`Most recent picks by other managers: ${context.recentPicks.join("; ")}.`);
  }
  if (context?.dataSource === "sample") {
    lines.push("Note: the app is currently showing demo data, not live FPL data. Say so if asked about specific numbers.");
  }
  return lines.join("\n\n");
}

app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(400).json({
      error:
        "No ANTHROPIC_API_KEY is set. Add it as an environment variable in Railway (Settings > Variables) to enable the AI assistant.",
    });
  }
  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // Searched answers need room for the tool exchange plus the reply.
        max_tokens: WEB_SEARCH_ENABLED ? 2048 : 1024,
        system: buildSystemPrompt(context, { webSearch: WEB_SEARCH_ENABLED }),
        ...(WEB_SEARCH_ENABLED ? { tools: [WEB_SEARCH_TOOL] } : {}),
        messages: messages.slice(-20).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || "").slice(0, 4000),
        })),
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || `Anthropic API error ${r.status}`;
      return res.status(502).json({ error: msg });
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    res.json({ reply: text, sources: collectSources(data.content) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---------- Static client ----------

const dist = path.join(__dirname, "client", "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(PORT, () => console.log(`FPL Draft Assistant running on port ${PORT}`));
