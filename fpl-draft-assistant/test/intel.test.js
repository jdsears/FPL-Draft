import test from "node:test";
import assert from "node:assert/strict";

import {
  INTEL_KINDS,
  buildAdjustments,
  buildNote,
  describeNote,
  isLive,
  pruneNotes,
  resolvePlayer,
  MAX_BOOST,
  MIN_FACTOR,
} from "../lib/intel.js";

const PLAYERS = [
  { id: 1, name: "Isak", fullName: "Alexander Isak", position: "FWD", teamShort: "LIV", teamName: "Liverpool" },
  { id: 2, name: "M.Salah", fullName: "Mohamed Salah", position: "MID", teamShort: "LIV", teamName: "Liverpool" },
  { id: 3, name: "Ekitiké", fullName: "Hugo Ekitike", position: "FWD", teamShort: "LIV", teamName: "Liverpool" },
  { id: 4, name: "Wissa", fullName: "Yoane Wissa", position: "FWD", teamShort: "NEW", teamName: "Newcastle" },
  // Two players who share a surname, to force the ambiguous path.
  { id: 5, name: "Gomes", fullName: "Angel Gomes", position: "MID", teamShort: "MUN", teamName: "Man Utd" },
  { id: 6, name: "Gomes", fullName: "Joao Gomes", position: "MID", teamShort: "WOL", teamName: "Wolves" },
];

const note = (over = {}) =>
  buildNote({ player: "Isak", kind: "doubt", ...over }, { players: PLAYERS, event: 6, now: "2026-09-20", ...(over.options || {}) })
    .note;

test("a player is found by web name, full name, surname or partial", () => {
  assert.equal(resolvePlayer(PLAYERS, "Isak").player.id, 1);
  assert.equal(resolvePlayer(PLAYERS, "Alexander Isak").player.id, 1);
  assert.equal(resolvePlayer(PLAYERS, "M.Salah").player.id, 2);
  assert.equal(resolvePlayer(PLAYERS, "Salah").player.id, 2);
  assert.equal(resolvePlayer(PLAYERS, "Mohamed").player.id, 2);
  // Accents and punctuation should not matter either way round.
  assert.equal(resolvePlayer(PLAYERS, "Ekitike").player.id, 3);
  assert.equal(resolvePlayer(PLAYERS, "Ekitiké").player.id, 3);
});

test("a name that matches two players asks rather than guessing", () => {
  const result = resolvePlayer(PLAYERS, "Gomes");
  assert.equal(result.player, undefined);
  assert.equal(result.ambiguous.length, 2);
  assert.match(result.error, /could be Gomes of MUN, Gomes of WOL/);

  // Naming the club settles it.
  assert.equal(resolvePlayer(PLAYERS, "Gomes", "WOL").player.id, 6);
  assert.equal(resolvePlayer(PLAYERS, "Gomes", "Wolves").player.id, 6);
});

test("a name nobody has is refused, not guessed at", () => {
  assert.match(resolvePlayer(PLAYERS, "Ronaldo").error, /No player in the league matches/);
  assert.match(resolvePlayer(PLAYERS, "").error, /No player name given/);
  assert.match(resolvePlayer([], "Isak").error, /No player/);
});

test("a note carries its source, its gameweek and when it stops counting", () => {
  const built = buildNote(
    { player: "Isak", kind: "doubt", detail: "Knock in training", confidence: "high" },
    { players: PLAYERS, event: 6, now: "2026-09-20T10:00:00Z", source: "you" }
  );
  assert.equal(built.error, undefined);
  assert.equal(built.note.playerId, 1);
  assert.equal(built.note.playerName, "Isak");
  assert.equal(built.note.kind, "doubt");
  assert.equal(built.note.label, INTEL_KINDS.doubt.label);
  assert.equal(built.note.confidence, "high");
  assert.equal(built.note.source, "you");
  assert.equal(built.note.event, 6);
  // A fitness doubt lasts one gameweek, so it is dead after gameweek 6.
  assert.equal(built.note.expiresAfterEvent, 6);
  assert.equal(isLive(built.note, 6), true);
  assert.equal(isLive(built.note, 7), false);

  // Being on penalties is worth knowing for months, not days.
  const pens = buildNote({ player: "Salah", kind: "penalties" }, { players: PLAYERS, event: 6 });
  assert.equal(pens.note.expiresAfterEvent, 6 + INTEL_KINDS.penalties.life - 1);
  assert.equal(isLive(pens.note, 12), true);
});

test("an unknown kind of note is refused", () => {
  const built = buildNote({ player: "Isak", kind: "vibes" }, { players: PLAYERS, event: 6 });
  assert.equal(built.note, undefined);
  assert.match(built.error, /is not a kind of note/);
  assert.match(built.error, /doubt/);
});

test("a note about a player who cannot be identified is refused", () => {
  const built = buildNote({ player: "Gomes", kind: "out" }, { players: PLAYERS, event: 6 });
  assert.equal(built.note, undefined);
  assert.match(built.error, /Which one/);
});

test("bad news pulls a projection down, and the strongest kinds nearly zero it", () => {
  const out = buildAdjustments([note({ kind: "out", confidence: "high" })], 6);
  assert.ok(out[1].factor < 0.1, "a player ruled out is all but written off");
  assert.ok(out[1].factor > 0, "but not exactly zero, because Thursday news is not Saturday's team");

  const doubt = buildAdjustments([note({ kind: "doubt", confidence: "high" })], 6);
  assert.ok(doubt[1].factor > 0.5 && doubt[1].factor < 0.7, "a doubt is a discount, not a write-off");
});

test("confidence decides how far a note moves the number", () => {
  const factor = (confidence) => buildAdjustments([note({ kind: "doubt", confidence })], 6)[1].factor;
  assert.ok(factor("low") > factor("medium"));
  assert.ok(factor("medium") > factor("high"));
  assert.ok(factor("low") < 1, "even a soft claim counts for something");
  assert.equal(factor("nonsense"), factor("medium"), "an unrecognised confidence is treated as medium");
});

test("selection news acts on playing time, not the scoring rate", () => {
  // The manager naming his starter overrides last season's minutes.
  const starter = buildAdjustments([note({ kind: "starting", confidence: "high" })], 6)[1];
  assert.equal(starter.playFloor, 0.92, "a named starter plays, whatever the history said");
  assert.equal(starter.playCap, null);

  // And a rumour lifts less far than a team sheet.
  const rumour = buildAdjustments([note({ kind: "starting", confidence: "low" })], 6)[1];
  assert.ok(rumour.playFloor < starter.playFloor);
  assert.ok(rumour.playFloor > 0.3);

  // The other direction: fit, but not expected to start.
  const benched = buildAdjustments([note({ kind: "benched", confidence: "high" })], 6)[1];
  assert.equal(benched.playCap, 0.15);
  assert.equal(benched.playFloor, null);
  const maybeBenched = buildAdjustments([note({ kind: "benched", confidence: "low" })], 6)[1];
  assert.ok(maybeBenched.playCap > benched.playCap, "a rumoured benching caps less brutally");

  // A note with no selection claim leaves playing time alone.
  const pens = buildAdjustments([note({ kind: "penalties" })], 6)[1];
  assert.equal(pens.playFloor, null);
  assert.equal(pens.playCap, null);
});

test("two reasons to worry compound, two reasons to like do not", () => {
  const both = buildAdjustments(
    [note({ kind: "doubt", confidence: "high" }), note({ kind: "rotation", confidence: "high" })],
    6
  );
  const one = buildAdjustments([note({ kind: "doubt", confidence: "high" })], 6);
  assert.ok(both[1].factor < one[1].factor, "a doubt and a rotation risk is worse than either alone");

  const good = buildAdjustments(
    [note({ kind: "penalties", confidence: "high" }), note({ kind: "form", confidence: "high" })],
    6
  );
  const pens = buildAdjustments([note({ kind: "penalties", confidence: "high" })], 6);
  assert.equal(good[1].factor, pens[1].factor, "on penalties and in form is one observation, not two");
});

test("the same kind of note recorded twice counts once, and the newest wins", () => {
  // A repeated news sweep records the same doubt again with a fresh id. That is
  // the same observation twice, not twice the evidence.
  const older = { ...note({ kind: "doubt", confidence: "high" }), id: "a", at: "2026-09-19" };
  const newer = { ...note({ kind: "doubt", confidence: "low" }), id: "b", at: "2026-09-21" };
  const twice = buildAdjustments([older, newer], 6);
  const newestOnly = buildAdjustments([newer], 6);
  assert.equal(twice[1].factor, newestOnly[1].factor, "only the newest note of a kind moves the number");
  assert.equal(twice[1].notes.length, 1, "and only one of them is shown as applied");

  // Different kinds still compound as before.
  const doubtOnly = buildAdjustments([older], 6);
  const mixed = buildAdjustments([older, note({ kind: "rotation", confidence: "high" })], 6);
  assert.ok(mixed[1].factor < doubtOnly[1].factor, "a different kind of worry still compounds");
});

test("no pile of notes can run away with a projection", () => {
  const good = Array.from({ length: 8 }, () => note({ kind: "penalties", confidence: "high" }));
  const bad = Array.from({ length: 8 }, () => note({ kind: "out", confidence: "high" }));
  assert.ok(buildAdjustments(good, 6)[1].factor <= MAX_BOOST);
  assert.ok(buildAdjustments(bad, 6)[1].factor >= MIN_FACTOR);
});

test("expired notes stop counting and can be swept away", () => {
  const stale = note({ kind: "doubt" });
  assert.deepEqual(buildAdjustments([stale], 8), {}, "a gameweek-old doubt says nothing about gameweek 8");
  assert.deepEqual(pruneNotes([stale], 8), []);
  assert.deepEqual(pruneNotes([stale], 6), [stale]);

  const pens = note({ kind: "penalties" });
  assert.equal(pruneNotes([stale, pens], 8).length, 1, "the long-lived note survives");
});

test("the headline is the worst news about a player", () => {
  const adjustments = buildAdjustments(
    [
      note({ kind: "penalties", confidence: "high" }),
      note({ kind: "out", confidence: "high" }),
      note({ kind: "doubt", confidence: "low" }),
    ],
    6
  );
  assert.equal(adjustments[1].headline.kind, "out");
  assert.equal(adjustments[1].notes.length, 3);
});

test("a note reads as a sentence, and says where it came from", () => {
  const mine = describeNote(note({ kind: "doubt", detail: "Knock in training." }));
  assert.equal(mine, "Fitness doubt: Knock in training (you said this, gameweek 6).");

  const found = buildNote(
    { player: "Isak", kind: "out", detail: "Ruled out by the manager" },
    { players: PLAYERS, event: 6, source: "search" }
  ).note;
  assert.match(describeNote(found), /Nova found this/);
  for (const line of [mine, describeNote(found)]) {
    assert.ok(line.endsWith("."));
    assert.ok(!line.includes("—"), "no em dashes");
    assert.ok(!line.includes("!"), "no exclamation marks");
  }
  assert.equal(describeNote({ kind: "nonsense" }), "");
});

test("empty and malformed input does not throw", () => {
  assert.deepEqual(buildAdjustments(undefined, 6), {});
  assert.deepEqual(buildAdjustments([null, {}, { kind: "nope" }], 6), {});
  assert.deepEqual(pruneNotes(undefined, 6), []);
  assert.equal(buildNote(undefined, {}).note, undefined);
  assert.equal(isLive({}, 6), true, "a note with no expiry is treated as current");
});
