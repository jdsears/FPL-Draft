import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeasonProjections,
  buildBaseline,
  seasonFixtureFactor,
  appearancesFrom,
  SEASON_WEIGHTS,
  PLANNING_WINDOW,
} from "../lib/season.js";
import { buildFixtureContext } from "../lib/fixtures.js";

const TEAMS = [
  { id: 1, name: "Arsenal", short_name: "ARS" },
  { id: 2, name: "Liverpool", short_name: "LIV" },
];
const MAIN_TEAMS = [
  { id: 91, name: "Arsenal", short_name: "ARS" },
  { id: 92, name: "Liverpool", short_name: "LIV" },
];

/** Arsenal get the gentlest run, Liverpool the hardest, across events 6 to 10. */
function windowFixtures(first = 6, count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    event: first + i,
    team_h: 91,
    team_a: 92,
    team_h_difficulty: 2,
    team_a_difficulty: 5,
  }));
}

function contextFor(first = 6, count = 5, fixtures = windowFixtures(first, count)) {
  return buildFixtureContext(MAIN_TEAMS, fixtures, { firstEvent: first, gameweeks: count });
}

function element(overrides = {}) {
  return {
    id: 1,
    code: 1000,
    first_name: "Test",
    second_name: "Player",
    web_name: "Player",
    element_type: 3,
    team: 1,
    total_points: 50,
    points_per_game: "5.0",
    form: "5.0",
    minutes: 900,
    starts: 10,
    status: "a",
    news: "",
    chance_of_playing_this_round: null,
    ...overrides,
  };
}

const bootstrap = (elements, events = { current: 5 }) => ({ elements, teams: TEAMS, events });
const find = (result, name) => {
  const hit = result.players.find((p) => p.name === name);
  assert.ok(hit, `expected ${name}`);
  return hit;
};

test("weights sum to one and the window has a sane default", () => {
  const total = Object.values(SEASON_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights should sum to 1, got ${total}`);
  assert.ok(PLANNING_WINDOW >= 3 && PLANNING_WINDOW <= 8);
});

test("appearances are recovered from points per game", () => {
  // A real example: 162 points at 4.4 a game is 37 appearances.
  assert.equal(appearancesFrom(162, 4.4, 37), 37);
  assert.equal(appearancesFrom(0, 0, 4), 4, "falls back to starts before a player scores");
  assert.equal(appearancesFrom(0, 0, 0), 0);
});

test("a nailed-on starter is worth more per gameweek than an equal-rate benchwarmer", () => {
  const result = buildSeasonProjections(
    bootstrap([
      element({ id: 1, web_name: "Starter", total_points: 25, points_per_game: "5.0", starts: 5 }),
      element({ id: 2, web_name: "Cameo", total_points: 10, points_per_game: "5.0", starts: 2 }),
    ]),
    { fixtureContext: contextFor(), currentEvent: 5 }
  );

  const starter = find(result, "Starter");
  const cameo = find(result, "Cameo");

  assert.equal(starter.season.perFixture, cameo.season.perFixture, "same rate when they play");
  assert.equal(starter.season.playProbability, 1);
  assert.equal(cameo.season.playProbability, 0.4);
  assert.ok(
    starter.season.perGameweek > cameo.season.perGameweek * 2,
    "playing time should dominate an identical rate"
  );
  assert.equal(starter.season.rank, 1);
});

test("a double gameweek counts twice and a blank counts for nothing", () => {
  const doubled = windowFixtures(6, 5).concat({
    id: 99,
    event: 6,
    team_h: 91,
    team_a: 92,
    team_h_difficulty: 2,
    team_a_difficulty: 5,
  });
  const result = buildSeasonProjections(bootstrap([element({ web_name: "Gunner", team: 1 })]), {
    fixtureContext: contextFor(6, 5, doubled),
    currentEvent: 5,
  });
  const player = find(result, "Gunner");
  assert.equal(player.season.fixtures, 6, "six fixtures across a five-gameweek window");
  assert.match(player.season.summary, /6 fixtures in the next 5/);

  // A club with nothing scheduled is dropped from the context, so a player
  // there has no fixtures and no expected points.
  const blank = buildSeasonProjections(bootstrap([element({ web_name: "Idle", team: 1 })]), {
    fixtureContext: buildFixtureContext(MAIN_TEAMS, [], { firstEvent: 6, gameweeks: 5 }),
    currentEvent: 5,
  });
  assert.equal(blank.fixturesAvailable, false);
});

test("fixture difficulty over a short window swings harder than on a draft board", () => {
  assert.equal(seasonFixtureFactor(3), 1);
  assert.equal(seasonFixtureFactor(null), 1);
  assert.ok(seasonFixtureFactor(2) > 1.1);
  assert.ok(seasonFixtureFactor(4.5) < 0.85);
  assert.ok(seasonFixtureFactor(1) <= 1.2 + 1e-9, "capped upwards");
  assert.ok(seasonFixtureFactor(5) >= 0.8 - 1e-9, "capped downwards");

  const result = buildSeasonProjections(
    bootstrap([
      element({ id: 1, web_name: "Gunner", team: 1 }),
      element({ id: 2, web_name: "Red", team: 2 }),
    ]),
    { fixtureContext: contextFor(), currentEvent: 5 }
  );
  assert.ok(find(result, "Gunner").season.windowPoints > find(result, "Red").season.windowPoints);
});

test("form is ignored until it means something, then it counts", () => {
  const early = buildSeasonProjections(
    bootstrap([element({ points_per_game: "4.0", form: "9.0" })], { current: 2 }),
    { fixtureContext: contextFor(3, 5), currentEvent: 2 }
  );
  const earlyPlayer = find(early, "Player");
  assert.equal(earlyPlayer.season.weights.form, 0, "two gameweeks of form is noise");
  assert.equal(earlyPlayer.season.perFixture, 4, "so the rate carries it alone");

  const later = buildSeasonProjections(
    bootstrap([element({ points_per_game: "4.0", form: "9.0" })], { current: 8 }),
    { fixtureContext: contextFor(9, 5), currentEvent: 8 }
  );
  const laterPlayer = find(later, "Player");
  assert.equal(laterPlayer.season.weights.form, SEASON_WEIGHTS.form);
  assert.ok(laterPlayer.season.perFixture > 4, "a player in form should be marked up");
  assert.ok(laterPlayer.season.perFixture < 9, "but not all the way to the form figure");
});

test("before the season starts the stats are last season's, over a full season", () => {
  const result = buildSeasonProjections(
    bootstrap([element({ total_points: 162, points_per_game: "4.4", starts: 37, form: "0.0" })], {
      current: null,
    }),
    { fixtureContext: contextFor(1, 5), currentEvent: 0 }
  );
  const player = find(result, "Player");
  assert.equal(result.preSeason, true);
  assert.equal(player.season.appearances, 37);
  // 37 of 38 gameweeks, not 37 of nothing.
  assert.ok(player.season.playProbability > 0.9 && player.season.playProbability <= 1);
  assert.equal(player.season.weights.form, 0, "pre-season form is meaningless");
});

test("a pre-season baseline lifts an early-season projection towards last season", () => {
  const elements = [element({ code: 500, total_points: 2, points_per_game: "2.0", starts: 1, form: "0.0" })];
  const withoutPrior = buildSeasonProjections(bootstrap(elements, { current: 1 }), {
    fixtureContext: contextFor(2, 5),
    currentEvent: 1,
  });
  const withPrior = buildSeasonProjections(bootstrap(elements, { current: 1 }), {
    fixtureContext: contextFor(2, 5),
    currentEvent: 1,
    baseline: { 500: { pointsPerGame: 7, appearances: 36 } },
  });

  assert.equal(withoutPrior.baselineAvailable, false);
  assert.equal(withPrior.baselineAvailable, true);
  assert.equal(withoutPrior.players[0].season.weights.prior, 0);
  assert.equal(withPrior.players[0].season.weights.prior, SEASON_WEIGHTS.prior);
  assert.ok(
    withPrior.players[0].season.perFixture > withoutPrior.players[0].season.perFixture,
    "one good gameweek of history should not be the only evidence"
  );
});

test("flagged players are marked down and departed players are gone", () => {
  const result = buildSeasonProjections(
    bootstrap([
      element({ id: 1, web_name: "Fit" }),
      element({ id: 2, web_name: "Injured", status: "i", chance_of_playing_this_round: 0, news: "Knee" }),
      element({ id: 3, web_name: "Left", status: "u", news: "Has joined Como permanently" }),
    ]),
    { fixtureContext: contextFor(), currentEvent: 5 }
  );

  assert.deepEqual(result.players.map((p) => p.name), ["Fit", "Injured"]);
  const injured = find(result, "Injured");
  assert.ok(injured.season.windowPoints < find(result, "Fit").season.windowPoints);
  assert.ok(injured.season.windowPoints > 0, "discounted, not zeroed");
  assert.match(injured.season.summary, /carrying a flag/);
});

test("every player carries a plain-English weekly explanation", () => {
  const result = buildSeasonProjections(
    bootstrap([element(), element({ id: 2, web_name: "Other", team: 2 })]),
    { fixtureContext: contextFor(), currentEvent: 5 }
  );
  for (const p of result.players) {
    assert.match(p.season.summary, /^Expected [\d.]+ a gameweek: /);
    assert.ok(p.season.summary.endsWith("."));
    assert.ok(!p.season.summary.includes("—"), "no em dashes");
    assert.ok(!p.season.summary.includes("!"), "no exclamation marks");
  }
  assert.equal(result.window, PLANNING_WINDOW);
  assert.equal(result.currentEvent, 5);
});

test("empty and malformed bootstraps do not throw", () => {
  for (const input of [{}, { elements: [] }, undefined, { elements: [], teams: [] }]) {
    assert.deepEqual(buildSeasonProjections(input).players, []);
  }
});

test("the baseline keeps only players with a scoring rate", () => {
  const baseline = buildBaseline({
    elements: [
      { code: 1, total_points: 162, points_per_game: "4.4", starts: 37, minutes: 3330 },
      { code: 2, total_points: 0, points_per_game: "0.0", starts: 0, minutes: 0 },
    ],
  });
  assert.deepEqual(Object.keys(baseline.players), ["1"]);
  assert.equal(baseline.players[1].appearances, 37);
  assert.equal(baseline.players[1].minutes, 3330);
  assert.deepEqual(buildBaseline({}).players, {});
});
