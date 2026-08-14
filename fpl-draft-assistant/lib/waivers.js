// Free agents and waiver claims.
//
// In a draft league there is no transfer market, only the players nobody owns.
// So the whole question is: is the best unowned player in a position better,
// from here to the end of the season, than the worst player I hold in it?
//
// Squads must stay at 2 GKP, 5 DEF, 5 MID and 3 FWD, so every claim is a
// same-position swap. That makes the comparison exact rather than a judgement
// about squad shape.

const POSITIONS = ["GKP", "DEF", "MID", "FWD"];

/** How many unowned players to shortlist in each position. */
export const SHORTLIST_PER_POSITION = 8;

/**
 * The smallest gain worth a claim, in points per gameweek. Below this the two
 * players are the same player as far as the model can tell, and churning the
 * squad costs you the waiver priority.
 */
export const MIN_GAIN = 0.3;

const expectedOf = (player) => Number(player?.season?.perGameweek) || 0;
const byExpected = (a, b) => expectedOf(b) - expectedOf(a);
const round1 = (value) => Math.round(value * 10) / 10;

const FLAGGED = new Set(["i", "n", "u", "s"]);

/** Why this swap is worth making, in one sentence. */
function describe(out, incoming, gain) {
  const parts = [
    `${incoming.name} is projected ${round1(gain)} more a gameweek than ${out.name}`,
  ];
  const status = String(out.status || "a").toLowerCase();
  if (FLAGGED.has(status)) parts.push(`${out.name} is not available to play`);
  else if (status === "d") parts.push(`${out.name} is carrying a doubt`);
  else if ((out.season?.playProbability ?? 1) < 0.6) parts.push(`${out.name} is not a regular starter`);

  if (out.season?.fixtures === 0) parts.push(`${out.name} has no fixture in the window`);
  if (incoming.season?.appearances !== undefined && incoming.season.appearances < 3) {
    parts.push(`though ${incoming.name} has barely played, so the projection is thin`);
  }
  if (FLAGGED.has(String(incoming.status || "a").toLowerCase())) {
    parts.push(`but ${incoming.name} is flagged too, so check the news first`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * Rank the unowned players and find the swaps worth making.
 *
 * @param {Array} players  every projected player (see lib/season.js)
 * @param {object} options
 *   owned        Set of element ids owned by anyone in the league, mine included
 *   mine         Set of element ids in the user's own squad
 *   perPosition  how many free agents to shortlist per position
 *   minGain      smallest gain in points per gameweek worth acting on
 */
export function buildWaiverBoard(players, options = {}) {
  const all = (players || []).filter(Boolean);
  const owned = options.owned instanceof Set ? options.owned : new Set(options.owned || []);
  const mine = options.mine instanceof Set ? options.mine : new Set(options.mine || []);
  const perPosition = options.perPosition || SHORTLIST_PER_POSITION;
  const minGain = options.minGain === undefined ? MIN_GAIN : options.minGain;

  // A player in my own squad is owned whether or not the ownership feed says so.
  const held = new Set([...owned, ...mine]);

  const freeAgents = {};
  const squad = {};
  for (const pos of POSITIONS) {
    freeAgents[pos] = all
      .filter((p) => p.position === pos && !held.has(p.id))
      .sort(byExpected)
      .slice(0, perPosition);
    squad[pos] = all.filter((p) => p.position === pos && mine.has(p.id)).sort(byExpected);
  }

  const upgrades = [];
  for (const pos of POSITIONS) {
    const out = squad[pos][squad[pos].length - 1];
    const incoming = freeAgents[pos][0];
    if (!out || !incoming) continue;
    const gain = expectedOf(incoming) - expectedOf(out);
    // A gain of exactly the threshold counts, so allow for the rounding error
    // in subtracting two decimals.
    if (gain < minGain - 1e-9) continue;
    upgrades.push({
      position: pos,
      out,
      in: incoming,
      gain: round1(gain),
      summary: describe(out, incoming, gain),
    });
  }
  upgrades.sort((a, b) => b.gain - a.gain);

  return {
    freeAgents,
    upgrades,
    // Nothing to compare against is a different message from nothing to do.
    squadKnown: [...mine].length > 0,
    availableCount: all.filter((p) => !held.has(p.id)).length,
  };
}
