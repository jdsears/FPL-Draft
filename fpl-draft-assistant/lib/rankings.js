// Draft rankings built from the FPL bootstrap data.
//
// Framework: Value Over Replacement Player (VORP) for a 10-team league.
// Each squad is 15 players (2 GK, 5 DEF, 5 MID, 3 FWD), so the "replacement
// level" at each position is roughly the best player still on waivers once
// every team has filled its slots. A player's draft value is how far above
// that replacement level they score, which is why mid-tier midfielders often
// out-rank big-name forwards on a draft board.
//
// The score feeding that framework is a blend of four signals rather than last
// season's points alone, because August drafts turn on transfers, promotions,
// new roles, fitness and the opening run of fixtures:
//
//   1. historical projection  last season's points, adjusted for minutes
//   2. FPL official draft rank FPL's own pre-season ordering, priced in points
//   3. opening fixtures       average difficulty of gameweeks 1 to 6
//   4. availability risk      injury, doubt and suspension flags
//
// Every component is expressed in projected-points units so the weighted sum
// stays readable on the board and VORP keeps its meaning.

import { NEUTRAL_DIFFICULTY, indexFixtureTeams, findFixtureTeam } from "./fixtures.js";

const SQUAD_SLOTS = { 1: 2, 2: 5, 3: 5, 4: 3 }; // GK, DEF, MID, FWD per team
const POSITIONS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** Signal weights. Tune the model here. */
export const RANKING_WEIGHTS = {
  historical: 0.45,
  draftRank: 0.35,
  fixtures: 0.1,
  availability: 0.1,
};

/**
 * Players with little Premier League history (new signings, promoted-team
 * standouts) lean on FPL's expert ordering instead of a thin points record.
 */
export const LOW_MINUTES_WEIGHTS = {
  historical: 0.15,
  draftRank: 0.65,
  fixtures: 0.1,
  availability: 0.1,
};

export const LOW_MINUTES_THRESHOLD = 900; // minutes of Premier League football
export const PREVIOUS_SEASON = "2025/26";

/** How hard the opening fixtures push a score, per point of difficulty. */
export const FIXTURE_SWING = 0.1;
export const FIXTURE_SWING_CAP = 0.15;

/** Availability multipliers by FPL status code. */
export const AVAILABILITY_FACTORS = {
  a: 1, // available
  d: 0.8, // doubtful
  i: 0.45, // injured
  s: 0.5, // suspended
  u: 0.25, // unavailable
  n: 0.4, // not in squad / on loan
};
const NEWS_ONLY_FACTOR = 0.97;
const MIN_AVAILABILITY_FACTOR = 0.2;

/**
 * FPL keeps players in the pool after they leave the Premier League, marked
 * unavailable with news like "Has joined Como permanently" or "Has joined
 * Elche on loan for the rest of the season". They cannot score, so drafting
 * one wastes a pick and they are dropped from the board entirely.
 */
const DEPARTURE_NEWS = /\b(has joined|has left|has returned to)\b/i;

export function hasLeftTheLeague(status, news) {
  return String(status || "").toLowerCase() === "u" && DEPARTURE_NEWS.test(String(news || ""));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;

function ordinal(n) {
  const abs = Math.abs(Math.round(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${abs}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[abs % 10] || "th";
  return `${abs}${suffix}`;
}

/** Turn status, chance of playing and news into a 0.2 to 1 multiplier. */
export function availabilityFactor(status, chanceOfPlaying, news) {
  const code = String(status || "a").toLowerCase();
  let factor = AVAILABILITY_FACTORS[code] ?? 1;
  const chance = Number(chanceOfPlaying);
  if (Number.isFinite(chance) && chanceOfPlaying !== null && chanceOfPlaying !== "") {
    factor = Math.min(factor, 0.35 + 0.65 * clamp(chance / 100, 0, 1));
  }
  if (factor >= 1 && String(news || "").trim()) factor = NEWS_ONLY_FACTOR;
  return clamp(factor, MIN_AVAILABILITY_FACTOR, 1);
}

/** Turn an average opening difficulty into a multiplier around 1. */
export function fixtureFactor(average) {
  if (average === null || average === undefined || !Number.isFinite(Number(average))) return 1;
  const swing = FIXTURE_SWING * (NEUTRAL_DIFFICULTY - Number(average));
  return 1 + clamp(swing, -FIXTURE_SWING_CAP, FIXTURE_SWING_CAP);
}

// Last season's total is the anchor. For players who missed chunks of the
// season, blend in points-per-game over a fuller schedule so a high-PPG player
// who missed ten games is not buried.
function historicalProjection(element) {
  const total = Number(element.total_points) || 0;
  const ppg = parseFloat(element.points_per_game) || 0;
  const mins = Number(element.minutes) || 0;
  const ppgProjection = ppg * 33; // assumes some rotation and injury
  const blend = mins > LOW_MINUTES_THRESHOLD ? Math.max(total, 0.6 * total + 0.4 * ppgProjection) : total;
  return { total, ppg, mins, historical: Math.round(blend) };
}

/**
 * Plausible season totals per position, used only when there is no historical
 * data at all to price the draft order against. Top is roughly a first-round
 * pick's season, floor is roughly replacement level.
 */
export const POSITION_POINT_CURVE = {
  1: { top: 165, floor: 55 }, // GKP
  2: { top: 175, floor: 55 }, // DEF
  3: { top: 265, floor: 55 }, // MID
  4: { top: 235, floor: 55 }, // FWD
};

/** A convex decay down the draft order, so elite picks keep a real gap. */
function curvePoints(elementType, index, count) {
  const { top, floor } = POSITION_POINT_CURVE[elementType] || POSITION_POINT_CURVE[3];
  if (count <= 1) return top;
  const share = Math.min(1, index / (count - 1));
  return Math.round(floor + (top - floor) * Math.pow(1 - share, 1.6));
}

// FPL publishes an expert draft order but no expected points. Map each
// position's draft order onto that position's spread of historical
// projections, so the best-rated defender is priced like the best-scoring
// defender. That keeps the signal in points and rescues players whose own
// record is thin.
//
// When a new season starts, FPL resets every player's points and minutes in
// the bootstrap, so that spread is all zeros and would price the whole draft
// order at nothing. In that case fall back to a synthetic curve, which keeps
// the board ordered on the expert signal until real form arrives.
function assignDraftRankScores(rows, elementType) {
  const spread = rows.map((r) => r.historical).sort((a, b) => b - a);
  const useCurve = !spread.some((value) => value > 0);
  const ordered = rows
    .filter((r) => Number.isFinite(r.draftRank))
    .sort((a, b) => a.draftRank - b.draftRank);
  ordered.forEach((row, i) => {
    row.draftRankScore = useCurve
      ? curvePoints(elementType, i, ordered.length)
      : spread[i] ?? spread[spread.length - 1] ?? 0;
  });
}

function outputTier(historical, positionSpread) {
  if (!positionSpread.length || historical <= 0) return null;
  const better = positionSpread.filter((v) => v > historical).length;
  const percentile = better / positionSpread.length;
  if (percentile <= 0.05) return "elite";
  if (percentile <= 0.2) return "strong";
  if (percentile <= 0.45) return "solid";
  return "modest";
}

function fixturePhrase(average) {
  if (average === null || average === undefined) return null;
  const avg = Number(average);
  const tone =
    avg <= 2.4 ? "gentle" : avg <= 2.9 ? "kind" : avg <= 3.4 ? "balanced" : avg <= 3.9 ? "testing" : "brutal";
  return `${tone} opening fixtures (difficulty ${avg.toFixed(1)})`;
}

function availabilityPhrase(status, chance, news, factor) {
  const code = String(status || "a").toLowerCase();
  const pct = Number(chance);
  const hasPct = Number.isFinite(pct) && chance !== null && chance !== "";
  if (code === "i") return hasPct ? `injured, ${pct}% chance of playing` : "currently injured";
  if (code === "s") return "suspended";
  if (code === "u") return "not available to play";
  if (code === "n") return "outside the squad for now";
  if (code === "d") return hasPct ? `a fitness doubt, ${pct}% chance of playing` : "a fitness doubt";
  if (factor < 1) return "a note in the latest FPL news";
  return "no injury flags";
}

/**
 * Plain-English explanation of a rank, generated entirely from the data.
 * Example: "Ranked 12: strong 2025/26 output, FPL's draft order puts them 8th
 * overall, gentle opening fixtures (difficulty 2.3), no injury flags."
 */
function describeRank(player, positionSpread, historyAvailable = true) {
  const b = player.breakdown;
  const parts = [];

  if (!historyAvailable) {
    parts.push(`${PREVIOUS_SEASON} totals not published for the new season`);
  } else if (player.minutes <= 0) {
    parts.push(`no ${PREVIOUS_SEASON} Premier League minutes`);
  } else if (player.minutes < LOW_MINUTES_THRESHOLD) {
    parts.push(`only ${player.minutes} Premier League minutes in ${PREVIOUS_SEASON}`);
  } else {
    const tier = outputTier(b.historical, positionSpread);
    parts.push(tier ? `${tier} ${PREVIOUS_SEASON} output` : `${PREVIOUS_SEASON} output on the board`);
  }

  parts.push(
    Number.isFinite(player.draftRank)
      ? `FPL's draft order puts them ${ordinal(player.draftRank)} overall`
      : "no FPL draft rank published"
  );

  parts.push(fixturePhrase(b.fixtureAverage) || "opening fixtures not available");
  parts.push(availabilityPhrase(player.status, player.chanceOfPlaying, player.news, b.availabilityFactor));

  const weighting =
    b.lowMinutes && Number.isFinite(player.draftRank) && historyAvailable
      ? ", so the rank leans on expert opinion rather than history"
      : "";
  return `Ranked ${player.rank}: ${parts.join(", ")}${weighting}.`;
}

/**
 * Build the ranked draft board.
 *
 * @param {object} bootstrap  draft-game bootstrap-static payload
 * @param {object|number} options  { teamsInLeague, fixtureContext } or a
 *   teams-in-league count for backwards compatibility.
 */
export function buildRankings(bootstrap, options = {}) {
  const opts = typeof options === "number" ? { teamsInLeague: options } : options || {};
  const teamsInLeague = opts.teamsInLeague || 10;
  const fixtureContext = opts.fixtureContext || null;
  const fixtureTeams = fixtureContext?.teams || [];
  const fixturesAvailable = fixtureTeams.length > 0;
  const fixtureIndex = fixturesAvailable ? indexFixtureTeams(fixtureTeams) : null;

  // Departed players are dropped before anything else, so they cannot skew the
  // replacement levels or the draft-rank conversion either.
  const allElements = bootstrap?.elements || [];
  const elements = allElements.filter((e) => !hasLeftTheLeague(e.status, e.news));
  const departedExcluded = allElements.length - elements.length;
  const teams = new Map((bootstrap?.teams || []).map((t) => [t.id, t]));

  const rows = elements.map((e) => {
    const { total, ppg, mins, historical } = historicalProjection(e);
    const team = teams.get(e.team) || {};
    const fixtureTeam = fixtureIndex ? findFixtureTeam(fixtureIndex, team) : null;
    const draftRank = Number.isFinite(Number(e.draft_rank)) && e.draft_rank !== null ? Number(e.draft_rank) : null;
    return {
      e,
      team,
      total,
      ppg,
      mins,
      historical,
      draftRank,
      draftRankScore: null,
      fixtureAverage: fixtureTeam ? fixtureTeam.average : null,
      fixtureTeamShort: fixtureTeam ? fixtureTeam.shortName : null,
    };
  });

  // Draft rank is priced within each position, so the conversion is fair
  // between a top goalkeeper and a top midfielder.
  for (const etype of Object.keys(SQUAD_SLOTS)) {
    assignDraftRankScores(
      rows.filter((r) => r.e.element_type === Number(etype)),
      Number(etype)
    );
  }

  // FPL zeroes last season's points and minutes when the new season's game
  // goes live, so the board has to say what it is actually ranking on.
  const historyAvailable = rows.some((r) => r.mins > 0 || r.total > 0);
  const spreads = Object.fromEntries(
    Object.keys(SQUAD_SLOTS).map((etype) => [
      etype,
      rows.filter((r) => r.e.element_type === Number(etype)).map((r) => r.historical),
    ])
  );

  const scored = rows.map((r) => {
    const base = r.mins < LOW_MINUTES_THRESHOLD ? LOW_MINUTES_WEIGHTS : RANKING_WEIGHTS;
    const weights = { ...base };

    // With no published draft rank there is no expert signal to blend, so that
    // weight returns to the historical record.
    if (r.draftRankScore === null) {
      weights.historical += weights.draftRank;
      weights.draftRank = 0;
    }

    const core = weights.historical + weights.draftRank;
    const blended =
      core > 0
        ? (weights.historical * r.historical + weights.draftRank * (r.draftRankScore ?? 0)) / core
        : r.historical;

    const fixFactor = fixtureFactor(r.fixtureAverage);
    const availFactor = availabilityFactor(
      r.e.status,
      r.e.chance_of_playing_this_round,
      r.e.news
    );
    const fixtureComponent = blended * fixFactor;
    const availabilityComponent = blended * availFactor;

    const score =
      weights.historical * r.historical +
      weights.draftRank * (r.draftRankScore ?? 0) +
      weights.fixtures * fixtureComponent +
      weights.availability * availabilityComponent;

    return {
      ...r,
      weights,
      fixFactor,
      availFactor,
      fixtureComponent,
      availabilityComponent,
      score: Math.round(score),
    };
  });

  // Replacement level per position: the score of the player just outside the
  // league-wide slot count.
  const replacement = {};
  for (const [etype, slots] of Object.entries(SQUAD_SLOTS)) {
    const pool = scored
      .filter((p) => p.e.element_type === Number(etype))
      .sort((a, b) => b.score - a.score);
    const idx = Math.min(slots * teamsInLeague, Math.max(pool.length - 1, 0));
    replacement[etype] = pool[idx] ? pool[idx].score : 0;
  }

  const ranked = scored
    .map((p) => {
      const e = p.e;
      const vorp = p.score - (replacement[e.element_type] || 0);
      return {
        id: e.id,
        code: e.code,
        name: e.web_name,
        fullName: `${e.first_name} ${e.second_name}`.trim(),
        position: POSITIONS[e.element_type] || "?",
        elementType: e.element_type,
        teamId: e.team,
        teamShort: p.team.short_name || "",
        teamName: p.team.name || "",
        lastSeasonPoints: p.total,
        ppg: p.ppg,
        minutes: p.mins,
        historicalProjection: p.historical,
        projectedPoints: p.score,
        vorp,
        status: e.status,
        chanceOfPlaying: e.chance_of_playing_this_round ?? null,
        news: e.news || "",
        goals: e.goals_scored ?? 0,
        assists: e.assists ?? 0,
        cleanSheets: e.clean_sheets ?? 0,
        ictIndex: parseFloat(e.ict_index) || 0,
        draftRank: p.draftRank,
        fixtureAverage: p.fixtureAverage,
        // Key into the fixture context. Held separately because the main
        // game's short names do not always match the draft game's.
        fixtureTeam: p.fixtureTeamShort,
        breakdown: {
          historical: p.historical,
          draftRank: p.draftRankScore === null ? null : Math.round(p.draftRankScore),
          fixtures: Math.round(p.fixtureComponent),
          availability: Math.round(p.availabilityComponent),
          weights: p.weights,
          lowMinutes: p.mins < LOW_MINUTES_THRESHOLD,
          fixtureAverage: p.fixtureAverage,
          fixtureFactor: round1(p.fixFactor * 100) / 100,
          availabilityFactor: round1(p.availFactor * 100) / 100,
          summary: "",
        },
      };
    })
    .filter((p) => p.lastSeasonPoints > 0 || p.minutes > 0 || p.draftRank !== null)
    .sort((a, b) => b.vorp - a.vorp || b.projectedPoints - a.projectedPoints);

  ranked.forEach((p, i) => {
    p.rank = i + 1;
    p.breakdown.summary = describeRank(p, spreads[p.elementType] || [], historyAvailable);
  });

  return {
    players: ranked,
    replacement,
    teamsInLeague,
    weights: { default: RANKING_WEIGHTS, lowMinutes: LOW_MINUTES_WEIGHTS, lowMinutesThreshold: LOW_MINUTES_THRESHOLD },
    fixturesAvailable,
    historyAvailable,
    departedExcluded,
  };
}
