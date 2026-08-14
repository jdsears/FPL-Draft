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
      teams: data.teams || [],
      fixtures: rankings.fixturesAvailable ? fixtureContext : null,
      fixturesSource: rankings.fixturesAvailable ? main.source : "unavailable",
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// In-season projections: expected points per gameweek over a planning window
// that starts at the next gameweek, rather than the draft board's valuation.
app.get("/api/season", async (req, res) => {
  try {
    const window = Math.min(Math.max(Number(req.query.window) || PLANNING_WINDOW, 1), 10);
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
    res.json({ source, fixturesSource: main.source, fixtures: fixtureContext, ...projections });
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
  const lines = [
    "You are Nova, a warm, witty Fantasy Premier League Draft strategist embedded in a draft-day app. Think charismatic match-day pundit: friendly, a little playful, always on the user's side, but focused on winning the draft. Keep the relationship professional and football-focused; deflect flirtation with light humour and steer back to the draft.",
    "League format: official FPL Draft, 10 teams, 15-player squads (2 GKP, 5 DEF, 5 MID, 3 FWD), snake draft, no player budgets, one owner per player.",
    "Scoring is standard FPL: appearance, goals (position-weighted), assists, clean sheets, bonus points; goalkeepers earn save points.",
    "Core strategy principles: value over replacement matters more than raw points (elite MIDs and premium FWDs go early; GKP late); plan two picks ahead in a snake draft; watch positional runs; target secure starters over rotation risks; fixture difficulty matters for early-season momentum.",
    "Answer briefly and decisively. When asked who to pick, give a clear first choice plus one alternative, with a one-line reason each.",
    "Use British English. Never use em dashes.",
    `Today's date is ${todayInWords()}. A new Premier League season is about to start, so pre-season news matters: summer transfers, new managers, promoted clubs, friendlies form, predicted line-ups and injury updates all move draft value.`,
  ];
  if (webSearch) {
    lines.push(
      "You have a web search tool. Search when the answer depends on anything recent or anything after your training data: completed or rumoured transfers, injury and fitness news, pre-season form, predicted line-ups, penalty and set-piece duties, manager changes, or a player's current club. Search at most a couple of times, prefer recent and reputable football sources, and say plainly if the picture is still unclear.",
      "Do not search for questions you can already answer well: draft strategy, scoring rules, positional value, snake-draft tactics, or reading the user's own roster. Those should come back fast."
    );
  } else {
    lines.push(
      "You have no web search available in this deployment. If a question turns on very recent news, say what you know, flag that it may be out of date, and suggest the user checks the latest team news."
    );
  }
  if (context?.myRoster?.length) {
    lines.push(`The user's roster so far: ${context.myRoster.join(", ")}.`);
  }
  if (context?.nextPick) {
    lines.push(`The user picks next at overall pick ${context.nextPick}.`);
  }
  if (context?.bestAvailable) {
    lines.push(
      "Best available by position right now (name, team, position, projected points, value over replacement, average difficulty of gameweeks 1 to 6 where 1 is easiest and 5 hardest):\n" +
        context.bestAvailable
    );
  }
  if (context?.recentPicks?.length) {
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
