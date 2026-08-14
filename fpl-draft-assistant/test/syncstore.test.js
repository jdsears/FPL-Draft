import test from "node:test";
import assert from "node:assert/strict";

import { mergeNotes, mergeLog, mergeState } from "../lib/syncstore.js";

const note = (id, over = {}) => ({
  id,
  playerId: 1,
  kind: "doubt",
  event: 6,
  expiresAfterEvent: 6,
  at: "2026-08-20T10:00:00Z",
  ...over,
});

test("two devices' notes merge to the union", () => {
  const merged = mergeNotes(
    { notes: [note("a"), note("b")], deleted: [] },
    { notes: [note("b"), note("c")], deleted: [] },
    6
  );
  assert.deepEqual(merged.notes.map((n) => n.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(merged.deleted, []);
});

test("a delete on one device kills the note everywhere, and stays dead", () => {
  const laptop = { notes: [], deleted: [{ id: "a", until: 6 }] };
  const phone = { notes: [note("a"), note("b")], deleted: [] };

  const merged = mergeNotes(laptop, phone, 6);
  assert.deepEqual(merged.notes.map((n) => n.id), ["b"], "the tombstone wins");
  assert.equal(merged.deleted.length, 1, "and travels on, so a third device also kills it");

  // The phone syncs again later, still carrying the dead note.
  const again = mergeNotes(merged, phone, 6);
  assert.deepEqual(again.notes.map((n) => n.id), ["b"], "it does not resurrect");
});

test("expired notes and spent tombstones are swept during the merge", () => {
  const merged = mergeNotes(
    { notes: [note("old", { expiresAfterEvent: 4 })], deleted: [{ id: "x", until: 4 }] },
    { notes: [note("fresh", { expiresAfterEvent: 8 })], deleted: [] },
    7
  );
  assert.deepEqual(merged.notes.map((n) => n.id), ["fresh"]);
  assert.deepEqual(merged.deleted, [], "a tombstone outlives its note by a week, then goes too");
});

test("the same note from two devices resolves to the newer write", () => {
  const merged = mergeNotes(
    { notes: [note("a", { detail: "older", at: "2026-08-20T09:00:00Z" })] },
    { notes: [note("a", { detail: "newer", at: "2026-08-20T11:00:00Z" })] },
    6
  );
  assert.equal(merged.notes.length, 1);
  assert.equal(merged.notes[0].detail, "newer");
});

test("projection logs merge by gameweek, later write winning", () => {
  const merged = mergeLog(
    { 1: { event: 1, projected: 40, at: "2026-08-20T09:00:00Z" }, 2: { event: 2, projected: 41, at: "b" } },
    { 1: { event: 1, projected: 43, at: "2026-08-21T09:00:00Z" }, 3: { event: 3, projected: 39, at: "c" } }
  );
  assert.deepEqual(Object.keys(merged).sort(), ["1", "2", "3"]);
  assert.equal(merged[1].projected, 43, "the rewrite closer to the deadline is the one that counts");
  assert.equal(merged[2].projected, 41);
});

test("mergeState combines both halves and stamps the result", () => {
  const stored = { notes: [note("a")], deleted: [], log: { 1: { event: 1, projected: 40, at: "x" } } };
  const incoming = { notes: [note("b")], deleted: [], log: { 2: { event: 2, projected: 42, at: "y" } } };
  const merged = mergeState(stored, incoming, 6);
  assert.deepEqual(merged.notes.map((n) => n.id).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(merged.log).sort(), ["1", "2"]);
  assert.ok(merged.updatedAt);
});

test("malformed input does not throw and junk is dropped", () => {
  const merged = mergeState(undefined, { notes: [null, {}, { id: "x" }], deleted: [null, {}], log: { zero: {}, 1: null } }, 6);
  assert.deepEqual(merged.notes, [], "a note without a player is junk");
  assert.deepEqual(merged.deleted, []);
  assert.deepEqual(merged.log, {});
  assert.deepEqual(mergeLog(null, undefined), {});
});
