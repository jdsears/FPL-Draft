// In-season player valuation.
//
// The draft board answers "who is worth a pick", which is a settled question
// once the draft is done. Week to week the question is different: how many
// points will this player score me in the next gameweek or few, given the rate
// they are scoring at, how reliably they play, and who they face.
//
// Everything here is in points per fixture or points per gameweek, never
// season totals, because every in-season decision is a weekly one: who starts,
// who to claim off waivers, whether a trade helps.

import { NEUTRAL_DIFFICULTY, indexFixtureTeams, findFixtureTeam } from "./fixtures.js";
import { availabilityFactor, hasLeftTheLeague } from "./rankings.js";

const POSITIONS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const GAMEWEEKS_IN_SEASON = 38;

/** How the scoring rate is put together. Tune the model here. */
export const SEASON_WEIGHTS = {
  rate: 0.55, // points per appearance across the season so far
  form: 0.3, // FPL's form figure, the last 30 days
  prior: 0.15, // last season, only if a baseline snapshot exists
};

/** Gameweeks of fixtures to plan over. */
export const PLANNING_WINDOW = 5;

/** Form is noise until a few gameweeks have been played. */
export const FORM_MIN_GAMEWEEKS = 3;

/** How hard fixture difficulty pushes an expectation, per point off neutral. */
export const FIXTURE_SWING = 0.12;
export const FIXTURE_SWING_CAP = 0.2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Fixture difficulty over a planning window swings an expectation further than
 * it does on a draft board: one hard week out of five is a bigger share of the
 * horizon than one hard week out of a whole season.
 */
export function seasonFixtureFactor(average) {
  const value = Number(average);
  if (!Number.isFinite(value) || value <= 0) return 1;
  const swing = FIXTURE_SWING * (NEUTRAL_DIFFICULTY - value);
  return 1 + clamp(swing, -FIXTURE_SWING_CAP, FIXTURE_SWING_CAP);
}

/**
 * FPL's points_per_game is per appearance, so appearances can be recovered
 * from it. Falls back to starts when a player has yet to score.
 */
export function appearancesFrom(totalPoints, pointsPerGame, starts) {
  const total = Number(totalPoints) || 0;
  const ppg = Number(pointsPerGame) || 0;
  if (ppg > 0) return Math.max(Math.round(total / ppg), 0);
  return Math.max(Number(starts) || 0, 0);
}

function describe(player) {
  const b = player.season;
  const parts = [`${round1(b.perFixture)} a game when they play`];

  const chance = Math.round(b.playProbability * 100);
  if (chance >= 90) parts.push("plays virtually every week");
  else if (chance >= 70) parts.push(`plays about ${Math.round(chance / 10)} weeks in 10`);
  else if (chance >= 40) parts.push(`started only about half the time (${chance}%)`);
  else parts.push(`rarely starts (${chance}% of gameweeks)`);

  if (b.fixtures === 0) parts.push(`blank across the next ${b.gameweeks} gameweeks`);
  else if (b.fixtures > b.gameweeks) parts.push(`${b.fixtures} fixtures in the next ${b.gameweeks}`);
  else if (b.fixtureAverage !== null) {
    const tone =
      b.fixtureAverage <= 2.4
        ? "a gentle"
        : b.fixtureAverage <= 2.9
          ? "a kind"
          : b.fixtureAverage <= 3.4
            ? "a balanced"
            : b.fixtureAverage <= 3.9
              ? "a testing"
              : "a brutal";
    parts.push(`${tone} run (difficulty ${b.fixtureAverage.toFixed(1)})`);
  } else {
    parts.push("fixtures unavailable");
  }

  if (b.availabilityFactor < 1) parts.push("carrying a flag, so check the news");
  if (b.intelShift === "down") parts.push("marked down on team news");
  else if (b.intelShift === "up") parts.push("marked up on team news");

  return `Expected ${round1(b.perGameweek)} a gameweek: ${parts.join(", ")}.`;
}

/**
 * Project every available player over a planning window.
 *
 * @param {object} bootstrap  draft-game bootstrap-static payload
 * @param {object} options
 *   fixtureContext  a context built for the window (see lib/fixtures.js)
 *   currentEvent    gameweeks completed; 0 before the season starts
 *   window          gameweeks in the planning horizon
 *   baseline        optional { [code]: { pointsPerGame, appearances } } from a
 *                   pre-season snapshot, used as an early-season prior
 *   corrections     optional { GKP, DEF, MID, FWD } multipliers learned from how
 *                   past projections actually turned out (see lib/learning.js)
 *   intel           optional { [elementId]: { factor, notes } } from dated team
 *                   news the numbers cannot see (see lib/intel.js)
 */
export function buildSeasonProjections(bootstrap, options = {}) {
  const window = options.window || PLANNING_WINDOW;
  const currentEvent = Math.max(0, Number(options.currentEvent) || 0);
  const baseline = options.baseline || null;
  const corrections = options.corrections || null;
  const intel = options.intel || null;
  const fixtureTeams = options.fixtureContext?.teams || [];
  const fixturesAvailable = fixtureTeams.length > 0;
  const fixtureIndex = fixturesAvailable ? indexFixtureTeams(fixtureTeams) : null;

  // Before a ball is kicked the season stats are last season's, so the same
  // maths works with a full season as the denominator.
  const matchesSoFar = currentEvent > 0 ? currentEvent : GAMEWEEKS_IN_SEASON;
  const preSeason = currentEvent === 0;

  const teams = new Map((bootstrap?.teams || []).map((t) => [t.id, t]));
  const elements = (bootstrap?.elements || []).filter((e) => !hasLeftTheLeague(e.status, e.news));

  const players = elements.map((e) => {
    const total = Number(e.total_points) || 0;
    const ppg = parseFloat(e.points_per_game) || 0;
    const form = parseFloat(e.form) || 0;
    const appearances = appearancesFrom(total, ppg, e.starts);
    const playProbability = clamp(appearances / matchesSoFar, 0, 1);

    const prior = baseline?.[e.code] || null;
    const weights = { rate: ppg > 0 ? SEASON_WEIGHTS.rate : 0, form: 0, prior: 0 };
    if (!preSeason && currentEvent >= FORM_MIN_GAMEWEEKS && form > 0) weights.form = SEASON_WEIGHTS.form;
    if (prior && Number(prior.pointsPerGame) > 0) weights.prior = SEASON_WEIGHTS.prior;

    const totalWeight = weights.rate + weights.form + weights.prior;
    const perFixture =
      totalWeight > 0
        ? (weights.rate * ppg + weights.form * form + weights.prior * (Number(prior?.pointsPerGame) || 0)) /
          totalWeight
        : 0;

    // What past gameweeks say this position's projections are worth. Neutral
    // until there is enough evidence to say otherwise.
    const position = POSITIONS[e.element_type] || "?";
    const correction = Number(corrections?.[position]) || 1;

    const team = teams.get(e.team) || {};
    const fixtureTeam = fixtureIndex ? findFixtureTeam(fixtureIndex, team) : null;
    const fixtureAverage = fixtureTeam ? fixtureTeam.average : null;
    // A double gameweek is two chances to score, a blank is none.
    const fixtures = fixtureTeam ? fixtureTeam.fixtureCount : window;
    const fixtureFactor = seasonFixtureFactor(fixtureAverage);
    const availability = availabilityFactor(e.status, e.chance_of_playing_this_round, e.news);

    // Team news the model cannot read: a doubt, a suspension, a manager naming
    // his starter. Selection news overrides the history on playing time, since
    // "he is our striker" from the manager outweighs last season's minutes; the
    // rate factors stay bounded so news tilts the rate rather than setting it.
    const news = intel?.[e.id] || null;
    const newsFactor = Number(news?.factor) || 1;
    let effectivePlay = playProbability;
    if (news && Number.isFinite(news.playFloor)) effectivePlay = Math.max(effectivePlay, news.playFloor);
    if (news && Number.isFinite(news.playCap)) effectivePlay = Math.min(effectivePlay, news.playCap);
    const intelShift =
      newsFactor < 1 || effectivePlay < playProbability
        ? "down"
        : newsFactor > 1 || effectivePlay > playProbability
          ? "up"
          : null;

    const perPlayedFixture = perFixture * fixtureFactor * availability * correction * newsFactor;
    const windowPoints = perPlayedFixture * effectivePlay * fixtures;

    const player = {
      id: e.id,
      code: e.code,
      name: e.web_name,
      fullName: `${e.first_name} ${e.second_name}`.trim(),
      position,
      elementType: e.element_type,
      teamId: e.team,
      teamShort: team.short_name || "",
      teamName: team.name || "",
      status: e.status,
      chanceOfPlaying: e.chance_of_playing_this_round ?? null,
      news: e.news || "",
      fixtureTeam: fixtureTeam ? fixtureTeam.shortName : null,
      notes: news?.notes || [],
      season: {
        perFixture: round2(perFixture),
        perGameweek: round2(windowPoints / window),
        windowPoints: round1(windowPoints),
        gameweeks: window,
        fixtures,
        fixtureAverage,
        fixtureFactor: round2(fixtureFactor),
        availabilityFactor: round2(availability),
        playProbability: round2(effectivePlay),
        historyPlayProbability: round2(playProbability),
        appearances,
        pointsPerGame: ppg,
        form,
        weights,
        preSeason,
        correction: round2(correction),
        intelFactor: round2(newsFactor),
        intelShift,
        summary: "",
      },
    };
    player.season.summary = describe(player);
    return player;
  });

  players.sort((a, b) => b.season.windowPoints - a.season.windowPoints);
  players.forEach((p, i) => (p.season.rank = i + 1));

  return {
    players,
    currentEvent,
    window,
    preSeason,
    fixturesAvailable,
    baselineAvailable: Boolean(baseline),
    weights: SEASON_WEIGHTS,
    corrections,
  };
}

/**
 * Reduce a bootstrap to the per-player rates worth keeping as an early-season
 * prior. FPL wipes last season's totals once the new season is under way, so
 * this has to be captured while it is still there.
 */
export function buildBaseline(bootstrap) {
  const players = {};
  for (const e of bootstrap?.elements || []) {
    const ppg = parseFloat(e.points_per_game) || 0;
    if (ppg <= 0) continue;
    players[e.code] = {
      pointsPerGame: ppg,
      appearances: appearancesFrom(e.total_points, ppg, e.starts),
      minutes: Number(e.minutes) || 0,
    };
  }
  return { capturedFor: "previous season", players };
}
