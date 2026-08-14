// Fetch helpers for the official FPL Draft API with a small in-memory cache
// and a bundled sample-data fallback so the app still renders if the API is
// unreachable (e.g. local development behind a restrictive network).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = "https://draft.premierleague.com/api";
// The main game publishes fixture difficulty, which the draft game does not.
const MAIN = "https://fantasy.premierleague.com/api";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

const cache = new Map(); // url -> { at, data }

async function getJson(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`FPL API ${res.status} for ${url}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

function readSample() {
  const samplePath = path.join(__dirname, "sample-data.json");
  return JSON.parse(fs.readFileSync(samplePath, "utf8"));
}

// FPL wipes last season's totals once the new season is under way, which leaves
// the in-season model with nothing to lean on for the first few gameweeks. So
// the last pre-season bootstrap is snapshotted while those numbers still exist.
const BASELINE_PATH = path.join(__dirname, "baseline.json");

export function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write the snapshot the first time live pre-season data is seen. Best effort:
 * a read-only or ephemeral filesystem just means the prior is unavailable, and
 * the model says so rather than failing.
 */
export function captureBaseline(bootstrap, build) {
  if (bootstrap?.events?.current) return null; // season already under way
  const existing = readBaseline();
  if (existing) return existing;
  try {
    const baseline = build(bootstrap);
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline));
    return baseline;
  } catch {
    return null;
  }
}

export async function getBootstrap() {
  try {
    // Player pool changes rarely; cache for 5 minutes.
    const data = await getJson(`${BASE}/bootstrap-static`, 5 * 60 * 1000);
    return { data, source: "live" };
  } catch (err) {
    return { data: readSample(), source: "sample", error: String(err.message || err) };
  }
}

/**
 * Teams and fixtures from the main game, used for opening-fixture difficulty.
 * Cached for six hours because fixture difficulty barely moves. Never throws:
 * on failure the caller gets empty arrays and a source of "unavailable" so the
 * ranking model can fall back to its two historical signals.
 *
 * @param {{allowSample?: boolean}} options  allowSample mirrors the demo
 *   fallback used for the player pool, so demo mode exercises the full model.
 */
export async function getMainGameData({ allowSample = false } = {}) {
  try {
    const [bootstrap, fixtures] = await Promise.all([
      getJson(`${MAIN}/bootstrap-static/`, SIX_HOURS),
      getJson(`${MAIN}/fixtures/`, SIX_HOURS),
    ]);
    return {
      teams: bootstrap.teams || [],
      fixtures: Array.isArray(fixtures) ? fixtures : [],
      // The main game publishes each gameweek's deadline, which the draft game
      // shares because the matches are the same.
      events: bootstrap.events || [],
      source: "live",
    };
  } catch (err) {
    const error = String(err.message || err);
    if (allowSample) {
      const sample = readSample().__main_game;
      if (sample) {
        return {
          teams: sample.teams || [],
          fixtures: sample.fixtures || [],
          events: sample.events || [],
          source: "sample",
          error,
        };
      }
    }
    return { teams: [], fixtures: [], events: [], source: "unavailable", error };
  }
}

export async function getLeagueDetails(leagueId) {
  return getJson(`${BASE}/league/${leagueId}/details`, 30 * 1000);
}

export async function getDraftChoices(leagueId) {
  // Live draft picks; keep the cache short so the board stays fresh.
  return getJson(`${BASE}/draft/${leagueId}/choices`, 10 * 1000);
}

export async function getElementStatus(leagueId) {
  return getJson(`${BASE}/league/${leagueId}/element-status`, 30 * 1000);
}

/**
 * What every player actually scored in one gameweek. Finished gameweeks never
 * change, so they are cached for a long time; a live one is kept brief.
 */
export async function getEventLive(event, { finished = false } = {}) {
  return getJson(`${BASE}/event/${event}/live`, finished ? SIX_HOURS : 60 * 1000);
}

export async function getGameStatus() {
  return getJson(`${BASE}/game`, 60 * 1000);
}
