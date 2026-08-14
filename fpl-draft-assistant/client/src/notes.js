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
  const list = readAll()[scope];
  return Array.isArray(list) ? list : [];
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
  all[scope] = merged;
  writeAll(all);
  return merged;
}

export function removeNote(scope, id) {
  const all = readAll();
  all[scope] = readNotes(scope).filter((note) => note.id !== id);
  writeAll(all);
  return all[scope];
}

export function clearNotes(scope) {
  const all = readAll();
  all[scope] = [];
  writeAll(all);
  return [];
}

/**
 * Forget notes that no longer apply to the gameweek in front of us. Team news
 * ages badly, so this runs on load rather than letting a stale doubt sit there
 * quietly suppressing a player.
 */
export function pruneExpired(scope, event) {
  const live = readNotes(scope).filter((note) => {
    const until = Number(note?.expiresAfterEvent);
    return !Number.isFinite(until) || Number(event) <= until;
  });
  const all = readAll();
  if ((all[scope] || []).length !== live.length) {
    all[scope] = live;
    writeAll(all);
  }
  return live;
}
