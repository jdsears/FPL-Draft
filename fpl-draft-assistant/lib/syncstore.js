// Keeping devices in agreement.
//
// Notes and the projection log live in each browser, because the server's disk
// is wiped on every deploy. That made a phone and a laptop drift: news recorded
// on one changed nothing on the other. The fix is a meeting point rather than a
// home: every device pushes what it has, the server merges and hands back the
// union, and each device replaces its copy with the result. The server's copy
// is a convenience cache; if a deploy wipes it, the next device to visit
// repopulates it from its own storage, so nothing is lost while at least one
// signed-in browser remembers.
//
// Deletion is the part naive merges get wrong: remove a note on the laptop and
// the phone would push it straight back. So a removal leaves a tombstone, which
// outlives the note it killed and wins every merge it attends.

const MAX_NOTES = 200;
const MAX_TOMBSTONES = 300;
const MAX_LOG_EVENTS = 60;

const num = (value) => Number(value) || 0;

function noteIsLive(note, event) {
  const until = num(note?.expiresAfterEvent);
  return !until || num(event) <= until;
}

function tombstoneIsLive(stone, event) {
  // A tombstone must outlive its note, or the note resurrects from a device
  // that has not synced since the delete.
  const until = num(stone?.until);
  return !until || num(event) <= until + 1;
}

/** Merge two sets of notes plus tombstones. Tombstones win. */
export function mergeNotes(a = {}, b = {}, event = 0) {
  const stones = new Map();
  for (const stone of [...(a.deleted || []), ...(b.deleted || [])]) {
    if (stone && stone.id && tombstoneIsLive(stone, event)) stones.set(stone.id, stone);
  }

  const notes = new Map();
  for (const note of [...(a.notes || []), ...(b.notes || [])]) {
    if (!note || !note.id || !note.playerId) continue;
    if (stones.has(note.id)) continue;
    if (!noteIsLive(note, event)) continue;
    // The same note from two devices: the newer write wins, though they are
    // almost always identical.
    const existing = notes.get(note.id);
    if (!existing || String(note.at || "") > String(existing.at || "")) notes.set(note.id, note);
  }

  return {
    notes: [...notes.values()].slice(-MAX_NOTES),
    deleted: [...stones.values()].slice(-MAX_TOMBSTONES),
  };
}

/**
 * Merge two projection logs, keyed by gameweek. A projection is rewritten right
 * up to the deadline, so for the same gameweek the later write wins.
 */
export function mergeLog(a = {}, b = {}) {
  const merged = {};
  for (const source of [a, b]) {
    for (const [event, entry] of Object.entries(source || {})) {
      if (!num(event) || !entry || typeof entry !== "object") continue;
      const existing = merged[event];
      if (!existing || String(entry.at || "") > String(existing.at || "")) merged[event] = entry;
    }
  }
  const events = Object.keys(merged)
    .sort((x, y) => num(x) - num(y))
    .slice(-MAX_LOG_EVENTS);
  return Object.fromEntries(events.map((event) => [event, merged[event]]));
}

/** One device's push, merged into the stored state for its squad. */
export function mergeState(stored = {}, incoming = {}, event = 0) {
  const notes = mergeNotes(
    { notes: stored.notes, deleted: stored.deleted },
    { notes: incoming.notes, deleted: incoming.deleted },
    event
  );
  return {
    notes: notes.notes,
    deleted: notes.deleted,
    log: mergeLog(stored.log, incoming.log),
    updatedAt: new Date().toISOString(),
  };
}
