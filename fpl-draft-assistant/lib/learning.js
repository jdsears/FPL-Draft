// Learning from what actually happened.
//
// A projection nobody checks is an opinion. Each gameweek the app records the
// eleven it recommended and what it expected them to score; afterwards the
// league records what they really scored. Comparing the two says whether the
// model runs hot or cold, and by how much, which is the only honest basis for
// changing it.
//
// Two rules keep this from turning into overfitting. Nothing is corrected until
// there are a couple of gameweeks to correct from, and every correction is
// shrunk towards no correction in proportion to how little evidence there is, so
// one freak week moves the model a little and a settled pattern moves it a lot.
// Per-position corrections are shrunk towards the overall one rather than
// towards nothing, because "defenders specifically are over-rated" needs more
// evidence than "everything is over-rated".

const POSITIONS = ["GKP", "DEF", "MID", "FWD"];

/** Gameweeks of evidence before any correction is applied at all. */
export const MIN_GAMEWEEKS = 2;

/** Shrinkage: with n gameweeks a correction moves n/(n+SHRINK) of the way. */
export const SHRINK = 3;
export const POSITION_SHRINK = 8;

/** A correction is a sanity adjustment, never a rewrite. */
export const CORRECTION_FLOOR = 0.7;
export const CORRECTION_CEILING = 1.3;

const num = (value) => Number(value) || 0;
const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Shrink an observed ratio towards a baseline by how much evidence there is. */
function shrink(ratio, baseline, n, k) {
  if (!Number.isFinite(ratio) || n <= 0) return baseline;
  return clamp(baseline + (ratio - baseline) * (n / (n + k)), CORRECTION_FLOOR, CORRECTION_CEILING);
}

/** The finished match for one manager in one gameweek, or null. */
function finishedMatch(matches, event, entryId) {
  return (
    (matches || []).find(
      (m) =>
        num(m.event) === num(event) &&
        m.finished === true &&
        (m.league_entry_1 === entryId || m.league_entry_2 === entryId)
    ) || null
  );
}

function sidesOf(match, entryId) {
  const first = { id: match.league_entry_1, points: num(match.league_entry_1_points) };
  const second = { id: match.league_entry_2, points: num(match.league_entry_2_points) };
  return first.id === entryId ? [first, second] : [second, first];
}

function outcome(mine, theirs) {
  if (mine > theirs) return "W";
  if (mine < theirs) return "L";
  return "D";
}

function describe(result) {
  const lines = [];
  if (result.sample === 0) {
    lines.push("Nothing to learn from yet. The first comparison arrives once a gameweek has been scored.");
    return lines;
  }

  const weeks = `${result.sample} gameweek${result.sample === 1 ? "" : "s"}`;
  if (Math.abs(result.bias) < 1) {
    lines.push(`Across ${weeks} the projection has been close, out by ${round1(Math.abs(result.bias))} a week on average.`);
  } else {
    lines.push(
      `Across ${weeks} the projection has run ${result.bias < 0 ? "hot" : "cold"}, ${
        result.bias < 0 ? "over" : "under"
      }stating your eleven by ${round1(Math.abs(result.bias))} points a week.`
    );
  }
  lines.push(`Typical miss is ${round1(result.meanAbsoluteError)} points, on totals around ${round1(result.averageActual)}.`);

  if (result.applied) {
    const pct = Math.round((result.correction - 1) * 100);
    lines.push(
      pct === 0
        ? "No overall correction is being applied, because the projection is already about right."
        : `Projections are being scaled by ${result.correction.toFixed(2)}, so ${
            pct > 0 ? "up" : "down"
          } ${Math.abs(pct)}%.`
    );
  } else {
    lines.push(
      `No correction is applied yet. That needs ${MIN_GAMEWEEKS} scored gameweeks, and there ${
        result.sample === 1 ? "is 1" : `are ${result.sample}`
      }.`
    );
  }

  const positions = POSITIONS.filter((pos) => result.byPosition[pos] && result.byPosition[pos].sample >= 8);
  const off = positions
    .map((pos) => ({ pos, gap: result.byPosition[pos].correction - result.correction }))
    .filter((p) => Math.abs(p.gap) >= 0.05)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  if (off.length) {
    const worst = off[0];
    lines.push(
      `By position, ${worst.pos} are the furthest out and are being adjusted ${
        worst.gap < 0 ? "down" : "up"
      } relative to the rest.`
    );
  }

  if (result.calls.total > 0) {
    lines.push(
      `It has called ${result.calls.right} of ${result.calls.total} head-to-head results correctly.`
    );
  }
  return lines;
}

/**
 * Compare what was projected with what the league recorded.
 *
 * @param {object} input
 *   log        [{ event, projected, players: [{ id, position, projected }] }] as
 *              recorded before each gameweek, newest or oldest first, either way
 *   matches    the league's match list, which carries the real scores
 *   myEntryId  the user's league_entry id, which is what matches use
 *   actuals    optional { [event]: { [elementId]: points } } for per-position
 *              detail; the overall figures do not need it
 */
export function buildLearning(input = {}) {
  const matches = input.matches || [];
  const entryId = input.myEntryId;
  const actuals = input.actuals || {};

  const rows = [];
  for (const entry of input.log || []) {
    const event = num(entry?.event);
    if (!event) continue;
    const match = finishedMatch(matches, event, entryId);
    if (!match) continue;
    const [mine, theirs] = sidesOf(match, entryId);
    const projected = num(entry.projected);
    const opponentProjected = num(entry.opponentProjected) || null;
    rows.push({
      event,
      projected: round1(projected),
      actual: mine.points,
      error: round1(mine.points - projected),
      opponentProjected: opponentProjected === null ? null : round1(opponentProjected),
      opponentActual: theirs.points,
      result: outcome(mine.points, theirs.points),
      predicted: opponentProjected === null ? null : outcome(projected, opponentProjected),
    });
  }
  rows.sort((a, b) => a.event - b.event);

  const sample = rows.length;
  const sumProjected = rows.reduce((s, r) => s + r.projected, 0);
  const sumActual = rows.reduce((s, r) => s + r.actual, 0);
  const bias = sample ? (sumActual - sumProjected) / sample : 0;
  const meanAbsoluteError = sample ? rows.reduce((s, r) => s + Math.abs(r.error), 0) / sample : 0;
  const ratio = sumProjected > 0 ? sumActual / sumProjected : 1;
  const applied = sample >= MIN_GAMEWEEKS;
  const correction = applied ? shrink(ratio, 1, sample, SHRINK) : 1;

  // Per position, from the players actually started in the gameweeks recorded.
  const tallies = {};
  for (const pos of POSITIONS) tallies[pos] = { sample: 0, projected: 0, actual: 0 };
  for (const entry of input.log || []) {
    const event = num(entry?.event);
    const scored = actuals[event] || actuals[String(event)];
    if (!scored || !finishedMatch(matches, event, entryId)) continue;
    for (const player of entry.players || []) {
      const tally = tallies[player?.position];
      if (!tally) continue;
      const actual = scored[player.id] ?? scored[String(player.id)];
      if (actual === undefined || actual === null) continue;
      tally.sample += 1;
      tally.projected += num(player.projected);
      tally.actual += num(actual);
    }
  }

  const byPosition = {};
  for (const pos of POSITIONS) {
    const tally = tallies[pos];
    const positionRatio = tally.projected > 0 ? tally.actual / tally.projected : null;
    byPosition[pos] = {
      sample: tally.sample,
      projected: round1(tally.projected),
      actual: round1(tally.actual),
      ratio: positionRatio === null ? null : round2(positionRatio),
      // Shrunk towards the overall correction, not towards nothing: a claim
      // about one position needs more evidence than a claim about all of them.
      correction:
        applied && positionRatio !== null
          ? round2(shrink(positionRatio, correction, tally.sample, POSITION_SHRINK))
          : round2(correction),
    };
  }

  const calls = rows.reduce(
    (acc, row) => {
      if (!row.predicted) return acc;
      acc.total += 1;
      if (row.predicted === row.result) acc.right += 1;
      return acc;
    },
    { right: 0, total: 0 }
  );

  const result = {
    rows,
    sample,
    bias: round1(bias),
    meanAbsoluteError: round1(meanAbsoluteError),
    averageActual: sample ? round1(sumActual / sample) : 0,
    ratio: round2(ratio),
    correction: round2(correction),
    applied,
    byPosition,
    calls,
    minGameweeks: MIN_GAMEWEEKS,
  };
  result.summary = describe(result);
  return result;
}

/**
 * Read a set of corrections back off the wire. The client passes these to the
 * projection endpoints, so they are treated as untrusted and clamped.
 */
export function normaliseCorrections(value) {
  const corrections = {};
  let any = false;
  for (const pos of POSITIONS) {
    const raw = Number(value?.[pos]);
    if (Number.isFinite(raw) && raw > 0) {
      corrections[pos] = clamp(raw, CORRECTION_FLOOR, CORRECTION_CEILING);
      any = true;
    } else {
      corrections[pos] = 1;
    }
  }
  return any ? corrections : null;
}

/** The corrections to send onwards, keyed by position. */
export function correctionsFrom(learning) {
  if (!learning?.applied) return null;
  const corrections = {};
  for (const pos of POSITIONS) corrections[pos] = learning.byPosition[pos].correction;
  return corrections;
}
