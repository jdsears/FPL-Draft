// Evaluating trades.
//
// The naive way to value a trade is to compare the two players. That is wrong
// in a draft league, because only eleven of the fifteen score: a player whose
// score never reaches your eleven is worth nothing to you. So every swap here
// is valued by re-picking both elevens and comparing what they are expected to
// score.
//
// One consequence is worth stating plainly, because it decides what this file
// can honestly offer. Squads have to stay at 2 GKP, 5 DEF, 5 MID and 3 FWD, so
// a trade is position for position. Suppose we both leave one defender out.
// Mine are a1 to a5 with a5 benched, theirs b1 to b5 with b5 benched. For their
// spare to improve my eleven it must beat my worst starter, b5 > a4. For my
// spare to improve theirs, a5 > b4. Together those give
// b5 > a4 >= a5 > b4 >= b5, which cannot hold. So under one shared projection
// no like-for-like trade improves both sides. It is zero sum by construction.
//
// That does not make trading pointless, it makes the useful question a
// different one: which trades gain me the most, and how much do they cost the
// other manager. A trade that gains me two points a gameweek and costs them
// almost nothing is a deal worth asking for, because they may well value the
// player differently, or need a position I am deep in. One that guts their
// eleven will simply be refused. So the swaps are ranked by what they are worth
// to me, and each one says what it takes from them.

import { pickLineup, SQUAD_RULES } from "./lineup.js";

/** The smallest gain, in points a gameweek, worth putting to a rival. */
export const MIN_TRADE_GAIN = 0.3;

/**
 * How little a swap can cost the other manager and still be worth asking. Below
 * this their eleven barely notices, which is where the realistic deals are.
 */
export const EASY_ASK_COST = 0.5;

/** How many swaps to offer per rival. */
export const MAX_SUGGESTIONS = 6;

const round1 = (value) => Math.round(value * 10) / 10;

/** The eleven's expected points at full precision, before rounding. */
function elevenTotal(lineup) {
  return (lineup?.starters || []).reduce((sum, p) => sum + (Number(p?.season?.perGameweek) || 0), 0);
}

function swapped(squad, out, incoming) {
  return squad.map((p) => (p.id === out.id ? incoming : p));
}

const holds = (lineup, player) => (lineup?.starters || []).some((p) => p.id === player.id);

function describe(swap) {
  const cost = -swap.theirGain;
  const parts = [`${swap.in.name} for ${swap.out.name} is worth ${round1(swap.myGain)} a gameweek to you`];

  if (!swap.startedForMe && swap.startsForMe) {
    parts.push(`${swap.in.name} goes straight into your eleven while ${swap.out.name} was on your bench`);
  } else if (swap.startsForMe) {
    parts.push(`${swap.in.name} is an upgrade on ${swap.out.name} in your eleven`);
  } else {
    parts.push("the gain is in depth rather than in your eleven");
  }

  if (cost <= 0) parts.push("and it costs their eleven nothing, so it is a fair ask");
  else if (cost < EASY_ASK_COST) parts.push(`and it costs them only ${round1(cost)}, so it is worth asking`);
  else parts.push(`but it costs them ${round1(cost)}, so expect them to want more back`);

  if (!swap.startedForThem) {
    parts.push(`${swap.in.name} was not in their eleven either`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * Value one swap for both sides.
 *
 * @returns {object|null} null when the swap is not position for position, or
 *   when either player is not in the squad said to hold them.
 */
export function evaluateSwap(mySquad, theirSquad, myPlayer, theirPlayer, rules = SQUAD_RULES) {
  if (!myPlayer || !theirPlayer) return null;
  if (myPlayer.position !== theirPlayer.position) return null;
  if (!mySquad.some((p) => p.id === myPlayer.id)) return null;
  if (!theirSquad.some((p) => p.id === theirPlayer.id)) return null;

  const mineBefore = pickLineup(mySquad, rules);
  const theirsBefore = pickLineup(theirSquad, rules);
  const mineAfter = pickLineup(swapped(mySquad, myPlayer, theirPlayer), rules);
  const theirsAfter = pickLineup(swapped(theirSquad, theirPlayer, myPlayer), rules);

  const swap = {
    position: myPlayer.position,
    out: myPlayer,
    in: theirPlayer,
    myGain: round1(elevenTotal(mineAfter) - elevenTotal(mineBefore)),
    theirGain: round1(elevenTotal(theirsAfter) - elevenTotal(theirsBefore)),
    myFormation: mineAfter.label,
    theirFormation: theirsAfter.label,
    startedForMe: holds(mineBefore, myPlayer),
    startsForMe: holds(mineAfter, theirPlayer),
    startedForThem: holds(theirsBefore, theirPlayer),
    startsForThem: holds(theirsAfter, myPlayer),
  };
  swap.theirCost = round1(-swap.theirGain);
  swap.easyAsk = swap.theirCost < EASY_ASK_COST;
  swap.summary = describe(swap);
  return swap;
}

/**
 * Every one-for-one swap with a rival, ranked by what it is worth to the user,
 * with the ones that barely cost the rival pulled out separately because those
 * are the ones with a realistic chance of being accepted.
 *
 * @param {object} options
 *   minGain  smallest gain worth offering, in points a gameweek
 *   limit    how many swaps to return in each list
 */
export function suggestTrades(mySquad, theirSquad, options = {}) {
  const rules = options.rules || SQUAD_RULES;
  const minGain = options.minGain === undefined ? MIN_TRADE_GAIN : options.minGain;
  const limit = options.limit || MAX_SUGGESTIONS;
  const mine = (mySquad || []).filter(Boolean);
  const theirs = (theirSquad || []).filter(Boolean);

  const mineBefore = pickLineup(mine, rules);
  const theirsBefore = pickLineup(theirs, rules);
  if (!mineBefore.playable || !theirsBefore.playable) {
    return {
      playable: false,
      myEleven: round1(elevenTotal(mineBefore)),
      theirEleven: round1(elevenTotal(theirsBefore)),
      myFormation: mineBefore.label,
      theirFormation: theirsBefore.label,
      best: [],
      easyAsks: [],
      considered: 0,
    };
  }

  const swaps = [];
  for (const myPlayer of mine) {
    for (const theirPlayer of theirs) {
      const swap = evaluateSwap(mine, theirs, myPlayer, theirPlayer, rules);
      if (swap) swaps.push(swap);
    }
  }

  const ranked = swaps
    .filter((s) => s.myGain >= minGain - 1e-9)
    // Most valuable to me first, and among equals the one that costs them least.
    .sort((a, b) => b.myGain - a.myGain || a.theirCost - b.theirCost);

  // Several of my benched players are worth the same to me, so the same target
  // shows up once per player I could send. Only the cheapest version is worth
  // listing, and the sort has already put it first.
  const seen = new Set();
  const worthIt = ranked.filter((s) => {
    if (seen.has(s.in.id)) return false;
    seen.add(s.in.id);
    return true;
  });

  return {
    playable: true,
    myEleven: round1(elevenTotal(mineBefore)),
    theirEleven: round1(elevenTotal(theirsBefore)),
    myFormation: mineBefore.label,
    theirFormation: theirsBefore.label,
    best: worthIt.slice(0, limit),
    easyAsks: worthIt.filter((s) => s.easyAsk).slice(0, limit),
    considered: swaps.length,
  };
}
