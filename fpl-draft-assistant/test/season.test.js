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

test("a thin prior counts for almost nothing", () => {
  const elements = [element({ code: 700, total_points: 2, points_per_game: "2.0", starts: 1, form: "0.0" })];
  const withPrior = (appearances) =>
    buildSeasonProjections(bootstrap(elements, { current: 1 }), {
      fixtureContext: contextFor(2, 5),
      currentEvent: 1,
      baseline: { 700: { pointsPerGame: 7, appearances } },
    }).players[0].season;

  const cameo = withPrior(1);
  const regular = withPrior(36);
  assert.ok(cameo.weights.prior < SEASON_WEIGHTS.prior / 5, "one appearance is barely evidence");
  assert.equal(regular.weights.prior, SEASON_WEIGHTS.prior, "a full season earns the full weight");
  assert.ok(regular.perFixture > cameo.perFixture, "the same rate counts for more with more football behind it");
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

test("a learned correction scales a position without touching the others", () => {
  const elements = [
    element({ id: 1, web_name: "Keeper", element_type: 1 }),
    element({ id: 2, web_name: "Mid", element_type: 3 }),
  ];
  const plain = buildSeasonProjections(bootstrap(elements), {
    fixtureContext: contextFor(),
    currentEvent: 5,
  });
  const corrected = buildSeasonProjections(bootstrap(elements), {
    fixtureContext: contextFor(),
    currentEvent: 5,
    corrections: { GKP: 0.8, DEF: 1, MID: 1, FWD: 1 },
  });

  const gkp = (r) => r.players.find((p) => p.position === "GKP");
  const mid = (r) => r.players.find((p) => p.position === "MID");
  assert.equal(gkp(plain).season.correction, 1);
  assert.equal(gkp(corrected).season.correction, 0.8);
  assert.ok(
    Math.abs(gkp(corrected).season.perGameweek - gkp(plain).season.perGameweek * 0.8) < 0.02,
    "the goalkeeper is marked down by exactly the correction"
  );
  assert.equal(mid(corrected).season.perGameweek, mid(plain).season.perGameweek, "the midfielder is untouched");
  assert.deepEqual(corrected.corrections, { GKP: 0.8, DEF: 1, MID: 1, FWD: 1 });
  assert.equal(plain.corrections, null);
});

test("a manager naming his starter overrides last season's minutes", () => {
  // Solanke's shape: scores well when he plays, but barely played last season,
  // so the history alone buries him.
  const elements = [
    element({ id: 1, web_name: "Named", total_points: 45, points_per_game: "4.5", starts: 10 }),
    element({ id: 2, web_name: "Displaced", total_points: 152, points_per_game: "4.0", starts: 38 }),
  ];
  const build = (intel) =>
    buildSeasonProjections(bootstrap(elements, { current: null }), {
      fixtureContext: contextFor(1, 1),
      currentEvent: 0,
      window: 1,
      intel,
    });

  const before = build(null);
  assert.ok(
    find(before, "Displaced").season.perGameweek > find(before, "Named").season.perGameweek,
    "on history alone the ever-present wins"
  );

  const after = build({
    1: { factor: 1.05, playFloor: 0.92, playCap: null, notes: [] },
    2: { factor: 0.85, playFloor: null, playCap: 0.15, notes: [] },
  });
  const named = find(after, "Named");
  const displaced = find(after, "Displaced");
  assert.ok(named.season.perGameweek > displaced.season.perGameweek, "the manager's word flips it");
  assert.ok(
    named.season.perGameweek > find(before, "Named").season.perGameweek * 2.5,
    "a named starter who rarely played is transformed, not nudged"
  );
  assert.equal(named.season.playProbability, 0.92);
  assert.equal(named.season.historyPlayProbability, find(before, "Named").season.playProbability);
  assert.equal(named.season.intelShift, "up");
  assert.equal(displaced.season.intelShift, "down");
  assert.match(named.season.summary, /marked up on team news/);
  assert.match(displaced.season.summary, /marked down on team news/);
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
