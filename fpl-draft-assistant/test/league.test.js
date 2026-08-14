import test from "node:test";
import assert from "node:assert/strict";

import { buildSeasonOverview, managerRecord, remainingFixtures } from "../lib/league.js";

const ENTRIES = [
  { id: 1, entry_id: 105185, entry_name: "Son Jihad", player_first_name: "John", player_last_name: "Sears" },
  { id: 2, entry_id: 200002, entry_name: "Seskonomic Meltdown", player_first_name: "Tom", player_last_name: "K" },
  { id: 3, entry_id: 200003, entry_name: "WE'RE BACK", player_first_name: "Andrew", player_last_name: "Barker" },
];

const match = (event, a, aPoints, b, bPoints, finished = true) => ({
  event,
  finished,
  started: finished,
  league_entry_1: a,
  league_entry_1_points: finished ? aPoints : 0,
  league_entry_2: b,
  league_entry_2_points: finished ? bPoints : 0,
});

// Three played gameweeks then three to come, so both halves are exercised.
const MATCHES = [
  match(1, 1, 50, 2, 40),
  match(2, 1, 30, 3, 45),
  match(3, 1, 35, 2, 35),
  match(4, 1, 0, 3, 0, false),
  match(5, 1, 0, 2, 0, false),
  match(6, 1, 0, 3, 0, false),
];

test("a record is read from the scores, either side of the fixture", () => {
  const home = managerRecord(MATCHES, 1);
  assert.equal(home.played, 3);
  assert.equal(home.won, 1);
  assert.equal(home.drawn, 1);
  assert.equal(home.lost, 1);
  assert.equal(home.pointsFor, 115);
  assert.equal(home.pointsAgainst, 120);
  assert.deepEqual(home.form.map((f) => f.result), ["W", "L", "D"]);
  assert.equal(home.average, 38.3);

  // Entry 2 appears only as the second side, and should read as its own record.
  const away = managerRecord(MATCHES, 2);
  assert.equal(away.played, 2);
  assert.equal(away.lost, 1);
  assert.equal(away.drawn, 1);
  assert.equal(away.pointsFor, 75);
  assert.deepEqual(away.form.map((f) => f.result), ["L", "D"]);
});

test("form is the recent results only, and a manager with no games has none", () => {
  const long = Array.from({ length: 8 }, (_, i) => match(i + 1, 1, 40 + i, 2, 10));
  const record = managerRecord(long, 1, { formMatches: 3 });
  assert.equal(record.played, 8);
  assert.deepEqual(record.form.map((f) => f.event), [6, 7, 8], "most recent, oldest first");
  assert.equal(record.recentAverage, 46);
  assert.equal(record.average, 43.5, "the season average is the whole season");

  const unplayed = managerRecord([match(1, 1, 0, 2, 0, false)], 1);
  assert.equal(unplayed.played, 0);
  assert.equal(unplayed.recentAverage, null);
  assert.equal(unplayed.average, null);
});

test("remaining fixtures skip anything already started", () => {
  assert.deepEqual(remainingFixtures(MATCHES, 1), [
    { event: 4, opponentId: 3 },
    { event: 5, opponentId: 2 },
    { event: 6, opponentId: 3 },
  ]);
  assert.deepEqual(remainingFixtures(MATCHES, 1, 5), [
    { event: 5, opponentId: 2 },
    { event: 6, opponentId: 3 },
  ]);
  assert.deepEqual(remainingFixtures(MATCHES, 99), []);
  assert.deepEqual(remainingFixtures(undefined, 1), []);
});

test("the table follows the official rank, not the maths", () => {
  const overview = buildSeasonOverview({
    entries: ENTRIES,
    matches: MATCHES,
    // The feed says entry 3 is top even though entry 1 has scored more.
    standings: [
      { league_entry: 3, rank: 1, total: 6, points_for: 45, points_against: 30 },
      { league_entry: 1, rank: 2, total: 4, points_for: 115, points_against: 120 },
      { league_entry: 2, rank: 3, total: 1, points_for: 75, points_against: 85 },
    ],
    myEntryId: 1,
    fromEvent: 4,
  });

  assert.deepEqual(overview.table.map((r) => r.entryId), [3, 1, 2]);
  assert.deepEqual(overview.table.map((r) => r.rank), [1, 2, 3]);
  assert.equal(overview.table[1].name, "Son Jihad");
  assert.equal(overview.table[1].mine, true);
  assert.equal(overview.table[0].mine, false);
  assert.equal(overview.table[1].pointsFor, 115, "the standings feed is authoritative");
  assert.equal(overview.table[1].won, 1, "the record still comes from the matches");
});

test("without standings the table falls back to points won", () => {
  const overview = buildSeasonOverview({ entries: ENTRIES, matches: MATCHES, myEntryId: 1 });
  const byEntry = new Map(overview.table.map((r) => [r.entryId, r]));
  assert.equal(byEntry.get(1).leaguePoints, 4, "one win and one draw");
  assert.equal(byEntry.get(3).leaguePoints, 3);
  assert.equal(byEntry.get(2).leaguePoints, 1);
  assert.deepEqual(overview.table.map((r) => r.entryId), [1, 3, 2]);
});

test("before a ball is kicked the order is projected strength, not zeros", () => {
  // What the real feed looks like the day after a draft: every fixture unplayed,
  // every standings row zeroed, and rank null rather than 1.
  const unplayed = Array.from({ length: 6 }, (_, i) => match(i + 1, 1, 0, i % 2 ? 2 : 3, 0, false));
  const overview = buildSeasonOverview({
    entries: ENTRIES,
    matches: unplayed,
    standings: ENTRIES.map((e) => ({
      league_entry: e.id,
      rank: null,
      total: 0,
      points_for: 0,
      points_against: 0,
    })),
    strengths: { 1: 45, 2: 52, 3: 38 },
    myEntryId: 1,
    fromEvent: 1,
  });

  assert.deepEqual(overview.table.map((r) => r.entryId), [2, 1, 3], "strongest squad first");
  assert.deepEqual(overview.table.map((r) => r.rank), [null, null, null], "a null rank is not first place");
  assert.deepEqual(overview.table.map((r) => r.played), [0, 0, 0]);
  assert.equal(overview.schedule.length, 5, "the whole run is still ahead");
  assert.equal(overview.schedule[0].event, 1);
});

test("a squad with no projection sinks to the bottom rather than to the top", () => {
  const overview = buildSeasonOverview({
    entries: ENTRIES,
    matches: [],
    strengths: { 1: 40, 3: 44 },
    myEntryId: 1,
  });
  assert.deepEqual(overview.table.map((r) => r.entryId), [3, 1, 2]);
  assert.equal(overview.table[2].strength, null);
});

test("the waiver order is carried through from the entries", () => {
  const overview = buildSeasonOverview({
    entries: [{ id: 1, entry_name: "Son Jihad", waiver_pick: 6 }, { id: 2, entry_name: "Other" }],
    matches: [],
    myEntryId: 1,
  });
  const mine = overview.table.find((r) => r.entryId === 1);
  assert.equal(mine.waiverPick, 6);
  assert.equal(overview.table.find((r) => r.entryId === 2).waiverPick, null);
});

test("the schedule carries the strength of each opponent", () => {
  const overview = buildSeasonOverview({
    entries: ENTRIES,
    matches: MATCHES,
    myEntryId: 1,
    fromEvent: 4,
    strengths: { 1: 45, 2: 52, 3: 38 },
  });

  assert.deepEqual(overview.schedule.map((f) => [f.event, f.opponentName, f.opponentStrength]), [
    [4, "WE'RE BACK", 38],
    [5, "Seskonomic Meltdown", 52],
    [6, "WE'RE BACK", 38],
  ]);

  const sos = overview.strengthOfSchedule;
  assert.equal(overview.leagueAverageStrength, 45);
  assert.equal(sos.average, 42.7);
  assert.equal(sos.versusAverage, -2.3, "a slightly kinder run than the league average");
  assert.equal(sos.hardest.opponentName, "Seskonomic Meltdown");
  assert.equal(sos.easiest.opponentName, "WE'RE BACK");
});

test("the schedule is capped and unknown strengths are left null", () => {
  const overview = buildSeasonOverview({
    entries: ENTRIES,
    matches: MATCHES,
    myEntryId: 1,
    fromEvent: 4,
    upcoming: 2,
  });
  assert.equal(overview.schedule.length, 2);
  assert.deepEqual(overview.schedule.map((f) => f.opponentStrength), [null, null]);
  assert.equal(overview.leagueAverageStrength, null);
  assert.equal(overview.strengthOfSchedule.average, null);
  assert.equal(overview.strengthOfSchedule.versusAverage, null);
  assert.equal(overview.strengthOfSchedule.hardest, null);
});

test("a manager missing from the entries list is still named", () => {
  const overview = buildSeasonOverview({
    entries: [ENTRIES[0]],
    matches: MATCHES,
    myEntryId: 1,
    fromEvent: 4,
  });
  assert.deepEqual(overview.schedule.map((f) => f.opponentName), ["Entry 3", "Entry 2", "Entry 3"]);
  assert.equal(overview.table.length, 1);
});

test("an entry with no team name falls back to the manager's own name", () => {
  const overview = buildSeasonOverview({
    entries: [{ id: 1, player_first_name: "John", player_last_name: "Sears" }],
    matches: [],
    myEntryId: 1,
  });
  assert.equal(overview.table[0].name, "John Sears");
});

test("empty and malformed input does not throw", () => {
  for (const input of [undefined, {}, { entries: [], matches: [] }]) {
    const overview = buildSeasonOverview(input);
    assert.deepEqual(overview.table, []);
    assert.deepEqual(overview.schedule, []);
    assert.equal(overview.strengthOfSchedule.average, null);
  }
});
