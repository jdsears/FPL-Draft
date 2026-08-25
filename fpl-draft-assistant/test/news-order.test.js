import test from "node:test";
import assert from "node:assert/strict";
import { orderNotes, oldNoteIds } from "../client/src/newsOrder.js";

const note = (id, playerId, kind, over = {}) => ({
  id,
  playerId,
  kind,
  event: 2,
  at: "2026-08-25T09:00:00Z",
  ...over,
});

test("your players come first, worst news first", () => {
  const notes = [
    note("a", 30, "out"), // unowned player, terrible news
    note("b", 10, "penalties"), // mine, nice to know
    note("c", 20, "benched"), // opponent's, matters for their eleven
    note("d", 11, "doubt"), // mine, changes who starts
  ];
  const ordered = orderNotes(notes, { mine: new Set([10, 11]), theirs: new Set([20]) });
  assert.deepEqual(
    ordered.map((n) => n.id),
    ["d", "b", "c", "a"],
    "mine before theirs before everyone, and within a side the selection news leads"
  );
});

test("within the same side and kind, the newest note leads", () => {
  const notes = [
    note("older", 10, "doubt", { at: "2026-08-24T09:00:00Z" }),
    note("newer", 11, "doubt", { at: "2026-08-25T09:00:00Z" }),
  ];
  const ordered = orderNotes(notes, { mine: new Set([10, 11]) });
  assert.deepEqual(ordered.map((n) => n.id), ["newer", "older"]);
});

test("an unrecognised kind sinks rather than throwing", () => {
  const ordered = orderNotes([note("x", 10, "mystery"), note("y", 10, "out")], { mine: new Set([10]) });
  assert.deepEqual(ordered.map((n) => n.id), ["y", "x"]);
});

test("old notes are the ones recorded for an earlier gameweek", () => {
  const notes = [
    note("gw1", 10, "penalties", { event: 1 }),
    note("gw2", 11, "doubt", { event: 2 }),
    note("undated", 12, "note", { event: 0 }),
  ];
  assert.deepEqual(oldNoteIds(notes, 2), ["gw1"], "only the gameweek 1 note is old when planning gameweek 2");
  assert.deepEqual(oldNoteIds(notes, 3), ["gw1", "gw2"]);
});
