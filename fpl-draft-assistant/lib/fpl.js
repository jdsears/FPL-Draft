// Fetch helpers for the official FPL Draft API with a small in-memory cache
// and a bundled sample-data fallback so the app still renders if the API is
// unreachable (e.g. local development behind a restrictive network).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = "https://draft.premierleague.com/api";
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

export async function getBootstrap() {
  try {
    // Player pool changes rarely; cache for 5 minutes.
    const data = await getJson(`${BASE}/bootstrap-static`, 5 * 60 * 1000);
    return { data, source: "live" };
  } catch (err) {
    const samplePath = path.join(__dirname, "sample-data.json");
    const data = JSON.parse(fs.readFileSync(samplePath, "utf8"));
    return { data, source: "sample", error: String(err.message || err) };
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

export async function getGameStatus() {
  return getJson(`${BASE}/game`, 60 * 1000);
}
