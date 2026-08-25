// Intel: what you know that the numbers do not.
//
// The model reads history. It cannot read a press conference, a training-ground
// report or a manager saying somebody is rested on Saturday. That kind of thing
// arrives in conversation, either because you heard it or because Nova searched
// for it, and until now it changed nothing.
//
// A note attaches a dated, typed claim to one player, which then adjusts that
// player's projection. Three things keep it honest. Every note says where it came
// from. Every note expires, because team news goes stale faster than anything
// else in football. And the adjustments are bounded, so a note tilts a decision
// rather than dictating it.

/**
 * What a note can say, and what it does to a projection.
 *
 * factor     multiplies the player's expected points when they play
 * playFloor  lifts how often they are expected to play, because "he is our
 *            starting striker" from the manager outweighs last season's minutes
 * playCap    caps it, for the same reason in the other direction
 * life       how many gameweeks the note stays relevant for
 *
 * Selection news acts on playing time rather than on the scoring rate: a
 * confirmed starter is not a slightly better player, he is a player who will
 * actually be on the pitch, which for someone the history says rarely plays can
 * honestly triple the number. The strongest kinds are near zero rather than
 * zero, because a player ruled out on Thursday does occasionally start anyway.
 */
export const INTEL_KINDS = {
  out: { label: "Ruled out", factor: 0.04, life: 1, bad: true },
  suspended: { label: "Suspended", factor: 0.02, life: 1, bad: true },
  benched: { label: "Not expected to start", factor: 0.85, playCap: 0.15, life: 1, bad: true },
  doubt: { label: "Fitness doubt", factor: 0.6, life: 1, bad: true },
  rotation: { label: "Rotation risk", factor: 0.9, playCap: 0.65, life: 1, bad: true },
  starting: { label: "Expected to start", factor: 1.05, playFloor: 0.92, life: 1 },
  returning: { label: "Back in training", factor: 1.02, playFloor: 0.6, life: 2 },
  penalties: { label: "On penalties", factor: 1.12, life: 8 },
  setpieces: { label: "On set pieces", factor: 1.06, life: 8 },
  form: { label: "In form", factor: 1.05, life: 3 },
  note: { label: "Note", factor: 1, life: 2 },
};

/** How sure the claim is, which scales how far the factor moves from neutral. */
export const CONFIDENCE = { low: 0.45, medium: 0.75, high: 1 };

/** No stack of notes may do more than this to one player. */
export const MAX_BOOST = 1.35;
export const MIN_FACTOR = 0.02;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;

/** Strip a name to something two spellings of it can agree on. */
export function normaliseName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Find the player a note is about. Names arrive as typed or as spoken, so this
 * tries exact, then surname, then a containment match, and gives up rather than
 * guessing between two players who match equally well.
 *
 * @returns {{player: object}|{error: string}|{ambiguous: Array}}
 */
export function resolvePlayer(players, name, teamHint = "") {
  const wanted = normaliseName(name);
  if (!wanted) return { error: "No player name given." };
  const team = normaliseName(teamHint);
  const pool = (players || []).filter(Boolean);

  const scored = [];
  for (const player of pool) {
    const web = normaliseName(player.name);
    const full = normaliseName(player.fullName);
    const surname = normaliseName(String(player.fullName || "").split(" ").slice(-1)[0]);
    let score = 0;
    if (web === wanted || full === wanted) score = 100;
    else if (surname && surname === wanted) score = 80;
    else if (full.includes(wanted) && wanted.length >= 4) score = 60;
    else if (web.includes(wanted) && wanted.length >= 4) score = 55;
    if (!score) continue;
    // A club named alongside the player settles most collisions.
    if (team && (normaliseName(player.teamShort) === team || normaliseName(player.teamName) === team)) {
      score += 15;
    }
    scored.push({ player, score });
  }

  if (!scored.length) return { error: `No player in the league matches "${name}".` };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const tied = scored.filter((s) => s.score === best.score);
  if (tied.length > 1) {
    return {
      ambiguous: tied.slice(0, 5).map((s) => `${s.player.name} (${s.player.teamShort})`),
      error: `"${name}" could be ${tied
        .slice(0, 5)
        .map((s) => `${s.player.name} of ${s.player.teamShort}`)
        .join(", ")}. Which one?`,
    };
  }
  return { player: best.player };
}

/**
 * Turn a claim into a note ready to store. Rejects anything it cannot make
 * sense of rather than storing a note that will not do what it says.
 */
export function buildNote(claim, options = {}) {
  const kind = String(claim?.kind || "").toLowerCase();
  const spec = INTEL_KINDS[kind];
  if (!spec) {
    return { error: `"${claim?.kind}" is not a kind of note. Use one of: ${Object.keys(INTEL_KINDS).join(", ")}.` };
  }
  const resolved = resolvePlayer(options.players, claim?.player, claim?.team);
  if (!resolved.player) return { error: resolved.error };

  const confidence = CONFIDENCE[String(claim?.confidence || "medium").toLowerCase()] ? String(claim.confidence).toLowerCase() : "medium";
  const event = Number(options.event) || 0;
  const life = Number(claim?.gameweeks) > 0 ? Math.min(Number(claim.gameweeks), 12) : spec.life;

  return {
    note: {
      id: `${resolved.player.id}-${kind}-${options.now || ""}`,
      playerId: resolved.player.id,
      playerName: resolved.player.name,
      teamShort: resolved.player.teamShort || "",
      position: resolved.player.position || "",
      kind,
      label: spec.label,
      detail: String(claim?.detail || "").slice(0, 300),
      confidence,
      source: options.source === "search" ? "search" : "you",
      sourceUrl: String(claim?.url || "").slice(0, 500) || null,
      event,
      // Team news goes stale faster than anything else, so a note says when it
      // stops counting rather than lingering for the season.
      expiresAfterEvent: event + life - 1,
      at: options.now || null,
    },
  };
}

/** Is this note still worth listening to in the given gameweek? */
export function isLive(note, event) {
  const until = Number(note?.expiresAfterEvent);
  if (!Number.isFinite(until)) return true;
  return Number(event) <= until;
}

/**
 * Collapse the live notes into one adjustment per player.
 *
 * Bad news compounds, because two reasons to doubt a player are worse than one.
 * Good news does not, because being on penalties and in form is mostly the same
 * observation twice; the strongest single claim stands.
 */
export function buildAdjustments(notes, event) {
  const live = (notes || []).filter((note) => note && isLive(note, event));

  // Two notes of the same kind about the same player are the same observation
  // recorded twice, not twice the evidence, so only the newest counts. Without
  // this, a repeated sweep compounds its own echo: two "doubt" notes would
  // multiply to far worse than the manager ever said.
  const newest = new Map();
  for (const note of live) {
    const key = `${note.playerId}:${note.kind}`;
    const existing = newest.get(key);
    if (!existing || String(note.at || "") > String(existing.at || "")) newest.set(key, note);
  }

  const byPlayer = new Map();
  for (const note of newest.values()) {
    const spec = INTEL_KINDS[note.kind];
    if (!spec) continue;
    const weight = CONFIDENCE[note.confidence] ?? CONFIDENCE.medium;
    // A low-confidence claim moves the factor part of the way from neutral.
    const factor = 1 + (spec.factor - 1) * weight;
    const entry = byPlayer.get(note.playerId) || { factor: 1, best: 1, floor: null, cap: null, notes: [] };
    if (spec.bad) entry.factor *= factor;
    else entry.best = Math.max(entry.best, factor);
    if (Number.isFinite(spec.playFloor)) {
      // A soft claim lifts less far: a rumoured starter is not a named one.
      entry.floor = Math.max(entry.floor ?? 0, spec.playFloor * weight);
    }
    if (Number.isFinite(spec.playCap)) {
      entry.cap = Math.min(entry.cap ?? 1, 1 - (1 - spec.playCap) * weight);
    }
    entry.notes.push(note);
    byPlayer.set(note.playerId, entry);
  }

  const adjustments = {};
  for (const [playerId, entry] of byPlayer) {
    const combined = clamp(entry.factor * entry.best, MIN_FACTOR, MAX_BOOST);
    adjustments[playerId] = {
      factor: round2(combined),
      // Selection news, applied to playing time rather than the rate. Bad news
      // wins a contradiction: a cap beats a floor because being left out is the
      // more recent kind of certainty a manager expresses.
      playFloor: entry.floor === null ? null : round2(entry.floor),
      playCap: entry.cap === null ? null : round2(entry.cap),
      notes: entry.notes,
      // The worst news is what a lineup screen needs to shout about.
      headline: entry.notes.slice().sort((a, b) => spread(a) - spread(b))[0] || null,
    };
  }
  return adjustments;
}

/** How far a note pushes a projection, lowest first, so the worst news leads. */
function spread(note) {
  const spec = INTEL_KINDS[note.kind];
  if (!spec) return 1;
  const weight = CONFIDENCE[note.confidence] ?? CONFIDENCE.medium;
  return 1 + (spec.factor - 1) * weight;
}

/** Drop notes that have expired, so the store does not grow for ever. */
export function pruneNotes(notes, event) {
  return (notes || []).filter((note) => note && isLive(note, event));
}

/** One line describing a note, for a lineup row or a chat reply. */
export function describeNote(note) {
  const spec = INTEL_KINDS[note?.kind];
  if (!spec) return "";
  const who = note.source === "search" ? "Nova found this" : "you said this";
  const parts = [spec.label];
  if (note.detail) parts.push(note.detail.replace(/\.$/, ""));
  return `${parts.join(": ")} (${who}, gameweek ${note.event}).`;
}
