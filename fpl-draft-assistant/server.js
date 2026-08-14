import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getBootstrap,
  getMainGameData,
  getLeagueDetails,
  getDraftChoices,
  getElementStatus,
  getGameStatus,
  readBaseline,
  captureBaseline,
} from "./lib/fpl.js";
import { buildRankings } from "./lib/rankings.js";
import { buildFixtureContext } from "./lib/fixtures.js";
import { buildSeasonProjections, buildBaseline, PLANNING_WINDOW } from "./lib/season.js";
import { pickLineup } from "./lib/lineup.js";

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
async function projectSeason(windowRequest) {
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
  });
  return { source, fixturesSource: main.source, fixtureContext, projections };
}

app.get("/api/season", async (req, res) => {
  try {
    const { source, fixturesSource, fixtureContext, projections } = await projectSeason(req.query.window);
    res.json({ source, fixturesSource, fixtures: fixtureContext, ...projections });
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
  const ids = (value) => {
    const list = Array.isArray(value) ? value : [];
    return new Set(list.map(Number).filter((n) => Number.isFinite(n)));
  };
  try {
    const mine = ids(req.body?.elements);
    const theirs = ids(req.body?.opponentElements);
    const { source, fixturesSource, fixtureContext, projections } = await projectSeason(req.body?.window);

    const squadFor = (set) => projections.players.filter((p) => set.has(p.id));
    const mySquad = squadFor(mine);
    const theirSquad = squadFor(theirs);

    res.json({
      source,
      fixturesSource,
      fixtures: fixtureContext,
      currentEvent: projections.currentEvent,
      nextEvent: projections.currentEvent + 1,
      window: projections.window,
      preSeason: projections.preSeason,
      fixturesAvailable: projections.fixturesAvailable,
      baselineAvailable: projections.baselineAvailable,
      lineup: pickLineup(mySquad),
      // A player who has left the league is dropped from the projection, so a
      // squad can legitimately come back short of what was asked for.
      unknown: mine.size - mySquad.length,
      opponent: theirs.size ? pickLineup(theirSquad) : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
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
        (context.opponentSquad?.length ? ` Their squad from the draft: ${context.opponentSquad.join(", ")}.` : "")
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
