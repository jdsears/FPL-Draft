// The record of what the app projected, week by week.
//
// This has to be written down before a gameweek is played, because afterwards
// the inputs have moved on and the projection cannot be reconstructed. It lives
// in this browser rather than on the server, because the server's filesystem is
// wiped by every deploy and there is no database. That means it is per device,
// so there is a backup and restore for moving it.

const KEY = "fplda.projectionLog";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
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

/** One log per team per league, so a shared browser does not mix them up. */
export function scopeFor(leagueId, entryId) {
  return `${leagueId || "noleague"}:${entryId || "noteam"}`;
}

export function readLog(scope) {
  const events = readAll()[scope] || {};
  return Object.values(events)
    .filter((entry) => entry && Number(entry.event))
    .sort((a, b) => Number(a.event) - Number(b.event));
}

/**
 * Record the projection for the gameweek that is still to come. Rewriting the
 * same gameweek is deliberate: right up to the deadline the latest projection is
 * the one being acted on. Once the gameweek starts it stops being the upcoming
 * one, so nothing touches it again.
 */
export function recordProjection(scope, week) {
  const event = Number(week?.event);
  if (!scope || !event) return false;
  const all = readAll();
  const forScope = all[scope] || {};
  forScope[event] = {
    event,
    at: new Date().toISOString(),
    projected: Number(week.projected) || 0,
    opponentProjected: week.opponentProjected === null ? null : Number(week.opponentProjected) || null,
    opponentName: week.opponentName || null,
    players: (week.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      projected: Number(p.projected) || 0,
    })),
  };
  all[scope] = forScope;
  return writeAll(all);
}

/** Everything, for a backup that can be pasted into another browser. */
export function exportLog() {
  return JSON.stringify(readAll());
}

/**
 * Merge a backup in rather than replacing, so restoring on a device that has its
 * own partial history does not throw any of it away.
 */
export function importLog(text) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch {
    return { ok: false, error: "That does not look like a backup. It should be the JSON you copied out." };
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { ok: false, error: "That does not look like a backup." };
  }
  const all = readAll();
  let added = 0;
  for (const [scope, events] of Object.entries(incoming)) {
    if (!events || typeof events !== "object") continue;
    all[scope] = all[scope] || {};
    for (const [event, entry] of Object.entries(events)) {
      if (!Number(event) || !entry || typeof entry !== "object") continue;
      if (!all[scope][event]) added += 1;
      all[scope][event] = entry;
    }
  }
  if (!writeAll(all)) return { ok: false, error: "This browser would not let the backup be saved." };
  return { ok: true, added };
}
