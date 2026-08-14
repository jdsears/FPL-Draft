// Team news notes, kept in this browser.
//
// Same reasoning as the projection log: the server's filesystem is wiped on
// every deploy and there is no database, so anywhere else these would quietly
// disappear. They travel up with each request and come back applied.

const KEY = "fplda.notes";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Notes belong to a squad, so a shared browser does not mix two leagues up. */
export function scopeFor(leagueId, entryId) {
  return `${leagueId || "noleague"}:${entryId || "noteam"}`;
}

export function readNotes(scope) {
  const entry = readAll()[scope];
  // Older versions stored a bare array; treat it as notes with no tombstones.
  if (Array.isArray(entry)) return entry;
  return Array.isArray(entry?.notes) ? entry.notes : [];
}

/** Tombstones for notes deleted here, so a delete survives a sync round trip. */
export function readDeleted(scope) {
  const entry = readAll()[scope];
  return Array.isArray(entry?.deleted) ? entry.deleted : [];
}

function writeScope(all, scope, notes, deleted) {
  all[scope] = { notes, deleted };
  return writeAll(all);
}

/** Add notes, replacing any earlier note of the same kind about the same player. */
export function addNotes(scope, incoming) {
  const fresh = (incoming || []).filter((note) => note && note.playerId && note.kind);
  if (!scope || !fresh.length) return readNotes(scope);
  const all = readAll();
  const existing = readNotes(scope).filter(
    (note) => !fresh.some((n) => n.playerId === note.playerId && n.kind === note.kind)
  );
  const merged = existing.concat(fresh.map((note) => ({ ...note, id: note.id || crypto.randomUUID?.() || `${note.playerId}-${note.kind}-${Date.now()}` })));
  writeScope(all, scope, merged, readDeleted(scope));
  return merged;
}

export function removeNote(scope, id) {
  const all = readAll();
  const notes = readNotes(scope);
  const dead = notes.find((note) => note.id === id);
  const kept = notes.filter((note) => note.id !== id);
  // The tombstone must outlive the note, or another device pushes it back.
  const deleted = dead
    ? readDeleted(scope).concat({ id, until: Number(dead.expiresAfterEvent) || Number(dead.event) + 12 })
    : readDeleted(scope);
  writeScope(all, scope, kept, deleted);
  return kept;
}

export function clearNotes(scope) {
  const all = readAll();
  const deleted = readDeleted(scope).concat(
    readNotes(scope).map((note) => ({ id: note.id, until: Number(note.expiresAfterEvent) || Number(note.event) + 12 }))
  );
  writeScope(all, scope, [], deleted);
  return [];
}

/**
 * Forget notes that no longer apply to the gameweek in front of us. Team news
 * ages badly, so this runs on load rather than letting a stale doubt sit there
 * quietly suppressing a player.
 */
export function pruneExpired(scope, event) {
  const notes = readNotes(scope);
  const live = notes.filter((note) => {
    const until = Number(note?.expiresAfterEvent);
    return !Number.isFinite(until) || !until || Number(event) <= until;
  });
  if (live.length !== notes.length) {
    writeScope(readAll(), scope, live, readDeleted(scope));
  }
  return live;
}

/** Replace this device's copy with what a sync round trip handed back. */
export function replaceState(scope, notes, deleted) {
  writeScope(readAll(), scope, Array.isArray(notes) ? notes : [], Array.isArray(deleted) ? deleted : []);
  return Array.isArray(notes) ? notes : [];
}
