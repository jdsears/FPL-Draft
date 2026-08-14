// Snapshot last season's scoring rates before FPL wipes them.
//
// At gameweek 1 the draft game resets every player's total_points, minutes and
// points_per_game to zero for the new season. That leaves the in-season model
// with a one or two game sample to work from for the first few gameweeks, which
// is not enough to tell a good player having a slow start from a bad one.
//
// The server snapshots this by itself the first time it sees live pre-season
// data, but it writes to the filesystem, and on a host like Railway that is
// wiped by the next deploy. Running this and committing the result makes the
// snapshot part of the repository, so it survives.
//
//   npm run capture:baseline
//   git add lib/baseline.json && git commit -m "Snapshot last season's rates"
//
// Pass --force to overwrite a snapshot that is already there, or to take one
// after the season has started, which will capture the new season rather than
// the old one and is almost certainly not what you want.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaseline } from "../lib/season.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "lib", "baseline.json");
const SOURCE = "https://draft.premierleague.com/api/bootstrap-static";
const force = process.argv.includes("--force");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (fs.existsSync(OUT) && !force) {
  stop(`A snapshot already exists at ${OUT}. Pass --force to replace it.`);
}

let bootstrap;
try {
  const res = await fetch(SOURCE, { headers: HEADERS });
  if (!res.ok) stop(`The FPL API answered ${res.status}. Try again in a minute.`);
  bootstrap = await res.json();
} catch (err) {
  stop(`Could not reach the FPL API: ${err.message || err}`);
}

const current = Number(bootstrap?.events?.current) || 0;
if (current > 0 && !force) {
  stop(
    `Gameweek ${current} has already been played, so these are this season's numbers, not last season's. ` +
      "There is nothing useful left to capture. Pass --force only if you know that is what you want."
  );
}

const baseline = buildBaseline(bootstrap);
const count = Object.keys(baseline.players).length;
if (count === 0) stop("No players in the feed had a scoring rate, so there is nothing to snapshot.");

fs.writeFileSync(OUT, JSON.stringify(baseline));
console.log(`Captured ${count} players to ${path.relative(process.cwd(), OUT)}.`);
console.log("Commit it so the snapshot survives a redeploy:");
console.log("  git add lib/baseline.json");
console.log('  git commit -m "Snapshot last season\'s scoring rates"');
