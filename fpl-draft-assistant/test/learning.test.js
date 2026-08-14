import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLearning,
  correctionsFrom,
  normaliseCorrections,
  MIN_GAMEWEEKS,
  CORRECTION_FLOOR,
  CORRECTION_CEILING,
} from "../lib/learning.js";

const ME = 105550;
const THEM = 92456;

const match = (event, mine, theirs, finished = true) => ({
  event,
  finished,
  started: finished,
  league_entry_1: ME,
  league_entry_1_points: finished ? mine : 0,
  league_entry_2: THEM,
  league_entry_2_points: finished ? theirs : 0,
});

/** A recorded projection: what the app expected before the gameweek. */
const logged = (event, projected, opponentProjected, players = []) => ({
  event,
  projected,
  opponentProjected,
  players,
});

test("nothing is learned from a gameweek that has not been scored", () => {
  const result = buildLearning({
    log: [logged(1, 40, 38)],
    matches: [match(1, 0, 0, false)],
    myEntryId: ME,
  });
  assert.equal(result.sample, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.correction, 1);
  assert.equal(result.applied, false);
  assert.match(result.summary[0], /Nothing to learn from yet/);
});

test("a scored gameweek is compared against what was projected", () => {
  const result = buildLearning({
    log: [logged(1, 40, 38)],
    matches: [match(1, 46, 35)],
    myEntryId: ME,
  });
  assert.equal(result.sample, 1);
  assert.deepEqual(result.rows, [
    {
      event: 1,
      projected: 40,
      actual: 46,
      error: 6,
      opponentProjected: 38,
      opponentActual: 35,
      result: "W",
      predicted: "W",
    },
  ]);
  assert.equal(result.bias, 6, "it under-projected by six");
  assert.equal(result.meanAbsoluteError, 6);
  assert.deepEqual(result.calls, { right: 1, total: 1 });
});

test("the manager is found whichever side of the fixture they are on", () => {
  const away = {
    event: 3,
    finished: true,
    league_entry_1: THEM,
    league_entry_1_points: 50,
    league_entry_2: ME,
    league_entry_2_points: 44,
  };
  const result = buildLearning({ log: [logged(3, 40, 41)], matches: [away], myEntryId: ME });
  assert.equal(result.rows[0].actual, 44);
  assert.equal(result.rows[0].opponentActual, 50);
  assert.equal(result.rows[0].result, "L");
  assert.equal(result.rows[0].predicted, "L", "it called the loss");
  assert.deepEqual(result.calls, { right: 1, total: 1 });
});

test("no correction is applied until there is enough to correct from", () => {
  assert.ok(MIN_GAMEWEEKS >= 2, "one gameweek is never enough");
  const one = buildLearning({ log: [logged(1, 50, 40)], matches: [match(1, 25, 40)], myEntryId: ME });
  assert.equal(one.applied, false);
  assert.equal(one.correction, 1, "a single bad week changes nothing");
  assert.match(one.summary.join(" "), /No correction is applied yet/);

  const two = buildLearning({
    log: [logged(1, 50, 40), logged(2, 50, 40)],
    matches: [match(1, 25, 40), match(2, 25, 40)],
    myEntryId: ME,
  });
  assert.equal(two.applied, true);
  assert.ok(two.correction < 1, "a consistent over-projection is corrected down");
});

test("a correction is shrunk towards no correction by how little evidence there is", () => {
  // A mild, consistent over-projection: 50 expected, 45 scored, so the raw ratio
  // is 0.9 every week. Deliberately gentle enough that the cap never binds, so
  // this measures the shrinkage rather than the clamp.
  const weeks = (n) =>
    Array.from({ length: n }, (_, i) => ({ log: logged(i + 1, 50, 40), match: match(i + 1, 45, 40) }));
  const run = (n) => {
    const w = weeks(n);
    return buildLearning({
      log: w.map((x) => x.log),
      matches: w.map((x) => x.match),
      myEntryId: ME,
    });
  };

  const two = run(2);
  const six = run(6);
  const twelve = run(12);
  assert.equal(two.ratio, 0.9, "the observed ratio is the same throughout");
  assert.equal(six.ratio, 0.9);
  assert.ok(two.correction > six.correction, "more evidence moves it further");
  assert.ok(six.correction > twelve.correction);
  assert.ok(twelve.correction > 0.9, "and never all the way to the raw ratio");
  for (const r of [two, six, twelve]) {
    assert.ok(r.correction >= CORRECTION_FLOOR && r.correction <= CORRECTION_CEILING);
  }
});

test("a correction is capped in both directions", () => {
  const many = (points) =>
    Array.from({ length: 40 }, (_, i) => ({ log: logged(i + 1, 50, 40), match: match(i + 1, points, 40) }));
  const hopeless = many(1);
  const flattering = many(500);
  const low = buildLearning({
    log: hopeless.map((x) => x.log),
    matches: hopeless.map((x) => x.match),
    myEntryId: ME,
  });
  const high = buildLearning({
    log: flattering.map((x) => x.log),
    matches: flattering.map((x) => x.match),
    myEntryId: ME,
  });
  assert.equal(low.correction, CORRECTION_FLOOR);
  assert.equal(high.correction, CORRECTION_CEILING);
});

test("per-position corrections need per-player results and are shrunk harder", () => {
  // Defenders score half what was projected; everyone else is spot on.
  const players = [
    { id: 1, position: "DEF", projected: 4 },
    { id: 2, position: "DEF", projected: 4 },
    { id: 3, position: "MID", projected: 6 },
    { id: 4, position: "MID", projected: 6 },
  ];
  const scored = { 1: 2, 2: 2, 3: 6, 4: 6 };
  const events = 5;
  const log = Array.from({ length: events }, (_, i) => logged(i + 1, 20, 20, players));
  const matches = Array.from({ length: events }, (_, i) => match(i + 1, 16, 20));
  const actuals = {};
  for (let e = 1; e <= events; e++) actuals[e] = scored;

  const withDetail = buildLearning({ log, matches, myEntryId: ME, actuals });
  assert.equal(withDetail.byPosition.DEF.sample, events * 2);
  assert.equal(withDetail.byPosition.DEF.ratio, 0.5);
  assert.equal(withDetail.byPosition.MID.ratio, 1);
  assert.ok(
    withDetail.byPosition.DEF.correction < withDetail.correction,
    "defenders are marked down relative to the whole"
  );
  assert.ok(
    withDetail.byPosition.MID.correction > withDetail.byPosition.DEF.correction,
    "and midfielders are not"
  );
  assert.ok(
    withDetail.byPosition.DEF.correction > 0.5,
    "but nowhere near the raw ratio on this little evidence"
  );

  // Without per-player results every position just gets the overall correction.
  const without = buildLearning({ log, matches, myEntryId: ME });
  assert.equal(without.byPosition.DEF.sample, 0);
  assert.equal(without.byPosition.DEF.ratio, null);
  assert.equal(without.byPosition.DEF.correction, without.correction);
  assert.equal(without.byPosition.FWD.correction, without.correction);
});

test("results are only counted for gameweeks the league has actually scored", () => {
  const result = buildLearning({
    log: [logged(1, 40, 38), logged(2, 41, 39), logged(3, 42, 40)],
    matches: [match(1, 45, 30), match(2, 0, 0, false)],
    myEntryId: ME,
  });
  assert.equal(result.sample, 1, "gameweek 2 is unfinished and 3 has no match at all");
  assert.deepEqual(result.rows.map((r) => r.event), [1]);
});

test("rows come back oldest first whatever order they were recorded in", () => {
  const result = buildLearning({
    log: [logged(3, 42, 40), logged(1, 40, 38), logged(2, 41, 39)],
    matches: [match(1, 45, 30), match(2, 38, 44), match(3, 41, 41)],
    myEntryId: ME,
  });
  assert.deepEqual(result.rows.map((r) => r.event), [1, 2, 3]);
  assert.deepEqual(result.rows.map((r) => r.result), ["W", "L", "D"]);
});

test("a projection with no opponent figure is still measured, just not called", () => {
  const result = buildLearning({
    log: [logged(1, 40, null), logged(2, 40, null)],
    matches: [match(1, 44, 30), match(2, 36, 50)],
    myEntryId: ME,
  });
  assert.equal(result.sample, 2);
  assert.deepEqual(result.rows.map((r) => r.predicted), [null, null]);
  assert.deepEqual(result.calls, { right: 0, total: 0 });
  assert.ok(!result.summary.join(" ").includes("head-to-head results"));
});

test("the summary reads as plain English and says what it is doing", () => {
  const result = buildLearning({
    log: [logged(1, 50, 40), logged(2, 50, 40), logged(3, 50, 40)],
    matches: [match(1, 40, 41), match(2, 42, 39), match(3, 41, 40)],
    myEntryId: ME,
  });
  assert.ok(result.summary.length >= 3);
  for (const line of result.summary) {
    assert.ok(line.endsWith("."), `"${line}" should end in a full stop`);
    assert.ok(!line.includes("—"), "no em dashes");
    assert.ok(!line.includes("!"), "no exclamation marks");
  }
  assert.match(result.summary.join(" "), /run hot, overstating your eleven/);
  assert.match(result.summary.join(" "), /being scaled by 0\.9/);
});

test("corrections are handed on only once they apply, and are clamped on the way back", () => {
  const none = buildLearning({ log: [logged(1, 40, 38)], matches: [match(1, 44, 30)], myEntryId: ME });
  assert.equal(correctionsFrom(none), null, "nothing to pass on from one gameweek");
  assert.equal(correctionsFrom(null), null);

  const applied = buildLearning({
    log: [logged(1, 50, 40), logged(2, 50, 40)],
    matches: [match(1, 40, 41), match(2, 42, 39)],
    myEntryId: ME,
  });
  const corrections = correctionsFrom(applied);
  assert.deepEqual(Object.keys(corrections), ["GKP", "DEF", "MID", "FWD"]);
  for (const value of Object.values(corrections)) assert.ok(value > 0 && value < 1);

  // Coming back off the wire, anything silly is clamped or ignored.
  assert.deepEqual(normaliseCorrections({ GKP: 99, DEF: -1, MID: 0.9, FWD: "x" }), {
    GKP: CORRECTION_CEILING,
    DEF: 1,
    MID: 0.9,
    FWD: 1,
  });
  assert.equal(normaliseCorrections(null), null);
  assert.equal(normaliseCorrections({}), null, "no usable values means no correction");
});

test("empty and malformed input does not throw", () => {
  for (const input of [undefined, {}, { log: [] }, { log: [null, {}], matches: null }]) {
    const result = buildLearning(input);
    assert.equal(result.sample, 0);
    assert.equal(result.correction, 1);
    assert.deepEqual(result.rows, []);
  }
});
