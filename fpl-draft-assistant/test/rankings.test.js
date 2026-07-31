import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildRankings,
  availabilityFactor,
  fixtureFactor,
  RANKING_WEIGHTS,
  LOW_MINUTES_WEIGHTS,
  LOW_MINUTES_THRESHOLD,
} from "../lib/rankings.js";
import { buildFixtureContext } from "../lib/fixtures.js";

const TEAMS = [
  { id: 1, name: "Arsenal", short_name: "ARS" },
  { id: 2, name: "Liverpool", short_name: "LIV" },
];

// Main-game ids deliberately differ from the draft-game ids above, as they do
// in the real APIs, so these fixtures also cover the name-based join.
const MAIN_TEAMS = [
  { id: 91, name: "Arsenal", short_name: "ARS" },
  { id: 92, name: "Liverpool", short_name: "LIV" },
];

/** Arsenal get the gentlest possible run, Liverpool the hardest. */
function mainFixtures() {
  return Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    event: i + 1,
    team_h: 91,
    team_a: 92,
    team_h_difficulty: 1,
    team_a_difficulty: 5,
  }));
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
    total_points: 150,
    points_per_game: "4.0",
    minutes: 3000,
    goals_scored: 10,
    assists: 5,
    clean_sheets: 0,
    status: "a",
    news: "",
    ict_index: "100.0",
    draft_rank: 10,
    chance_of_playing_this_round: null,
    ...overrides,
  };
}

function bootstrap(elements) {
  return { elements, teams: TEAMS };
}

function byName(result, name) {
  const found = result.players.find((p) => p.name === name);
  assert.ok(found, `expected ${name} in the rankings`);
  return found;
}

test("weights sum to one and shift towards draft rank on low minutes", () => {
  for (const set of [RANKING_WEIGHTS, LOW_MINUTES_WEIGHTS]) {
    const total = Object.values(set).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `weights should sum to 1, got ${total}`);
  }
  assert.ok(LOW_MINUTES_WEIGHTS.draftRank > RANKING_WEIGHTS.draftRank);
  assert.ok(LOW_MINUTES_WEIGHTS.historical < RANKING_WEIGHTS.historical);
});

test("a player under the minutes threshold is scored on the expert draft rank", () => {
  // Two players with an identical thin points record. The one FPL rate highly
  // must out-rank the one they do not, which only happens if the draft-rank
  // weight has taken over.
  const result = buildRankings(
    bootstrap([
      element({
        id: 1,
        web_name: "Newcomer",
        total_points: 0,
        minutes: 0,
        points_per_game: "0.0",
        draft_rank: 1,
      }),
      element({
        id: 2,
        web_name: "Fringe",
        total_points: 0,
        minutes: 0,
        points_per_game: "0.0",
        draft_rank: 2,
      }),
      // A deep pool of established scorers gives the draft-rank conversion a
      // spread of points to map onto.
      ...Array.from({ length: 8 }, (_, i) =>
        element({
          id: 10 + i,
          web_name: `Regular${i}`,
          total_points: 200 - i * 20,
          minutes: 3000,
          points_per_game: `${5 - i * 0.4}`,
          draft_rank: 3 + i,
        })
      ),
    ])
  );

  const newcomer = byName(result, "Newcomer");
  const fringe = byName(result, "Fringe");
  const best = byName(result, "Regular0");

  assert.equal(newcomer.breakdown.lowMinutes, true);
  assert.equal(newcomer.breakdown.weights.draftRank, LOW_MINUTES_WEIGHTS.draftRank);
  assert.equal(best.breakdown.weights.draftRank, RANKING_WEIGHTS.draftRank);

  assert.ok(
    newcomer.rank < fringe.rank,
    `expected the better-rated newcomer to out-rank the fringe player, got ${newcomer.rank} vs ${fringe.rank}`
  );
  assert.ok(
    newcomer.projectedPoints > 0,
    "a newcomer with no history but the top draft rank should not score zero"
  );
  // Not buried: FPL's number one pick should sit inside the top handful.
  assert.ok(newcomer.rank <= 3, `expected a top-three rank, got ${newcomer.rank}`);
  assert.match(newcomer.breakdown.summary, /leans on expert opinion/);
});

test("a player with no draft rank falls back to the historical signal alone", () => {
  const result = buildRankings(bootstrap([element({ draft_rank: null })]));
  const player = byName(result, "Player");
  assert.equal(player.breakdown.draftRank, null);
  assert.equal(player.breakdown.weights.draftRank, 0);
  assert.equal(
    player.breakdown.weights.historical,
    RANKING_WEIGHTS.historical + RANKING_WEIGHTS.draftRank
  );
  assert.match(player.breakdown.summary, /no FPL draft rank published/);
});

test("missing fixtures fall back to the two historical signals without crashing", () => {
  const elements = [
    element({ id: 1, web_name: "Gunner", team: 1, draft_rank: 1 }),
    element({ id: 2, web_name: "Red", team: 2, draft_rank: 2 }),
  ];

  const withFixtures = buildRankings(bootstrap(elements), {
    fixtureContext: buildFixtureContext(MAIN_TEAMS, mainFixtures()),
  });
  assert.equal(withFixtures.fixturesAvailable, true);
  assert.equal(byName(withFixtures, "Gunner").fixtureAverage, 1);
  assert.equal(byName(withFixtures, "Red").fixtureAverage, 5);

  for (const missing of [undefined, null, { teams: [] }, buildFixtureContext(null, null)]) {
    const result = buildRankings(bootstrap(elements), { fixtureContext: missing });
    assert.equal(result.fixturesAvailable, false);
    const player = byName(result, "Gunner");
    assert.equal(player.fixtureAverage, null);
    assert.equal(player.breakdown.fixtureFactor, 1);
    // With no fixture signal the score is the historical and draft-rank blend.
    assert.equal(player.projectedPoints, player.breakdown.historical);
    assert.match(player.breakdown.summary, /opening fixtures not available/);
  }

  // A gentle opening run should still lift a player above an identical one
  // facing the hardest run.
  const gunner = byName(withFixtures, "Gunner");
  const red = byName(withFixtures, "Red");
  assert.ok(
    gunner.projectedPoints > red.projectedPoints,
    `gentle fixtures should beat brutal ones, got ${gunner.projectedPoints} vs ${red.projectedPoints}`
  );
});

test("an injured player ranks below an identical fit player", () => {
  const result = buildRankings(
    bootstrap([
      element({ id: 1, web_name: "Fit" }),
      element({
        id: 2,
        web_name: "Injured",
        status: "i",
        chance_of_playing_this_round: 0,
        news: "Hamstring injury, back in September",
      }),
      element({
        id: 3,
        web_name: "Doubtful",
        status: "d",
        chance_of_playing_this_round: 75,
        news: "Knock, 75% chance of playing",
      }),
    ])
  );

  const fit = byName(result, "Fit");
  const doubtful = byName(result, "Doubtful");
  const injured = byName(result, "Injured");

  assert.ok(fit.rank < doubtful.rank, "a fit player should out-rank a doubtful one");
  assert.ok(doubtful.rank < injured.rank, "a doubtful player should out-rank an injured one");
  assert.ok(fit.projectedPoints > injured.projectedPoints);
  // Discounted, not hidden.
  assert.ok(injured.projectedPoints > 0);
  assert.equal(result.players.length, 3);
  assert.match(injured.breakdown.summary, /injured/);
});

test("availability factors discount by status, chance of playing and news", () => {
  assert.equal(availabilityFactor("a", null, ""), 1);
  assert.ok(availabilityFactor("a", null, "Knock in training") < 1);
  assert.ok(availabilityFactor("d", 75, "Knock") < availabilityFactor("a", null, ""));
  assert.ok(availabilityFactor("i", 0, "Out") < availabilityFactor("d", 75, "Knock"));
  assert.ok(availabilityFactor("u", null, "Left the club") < availabilityFactor("i", 25, "Out"));
  assert.ok(availabilityFactor("i", 0, "Out") >= 0.2, "never discounted to nothing");
  assert.equal(availabilityFactor(undefined, undefined, undefined), 1);
});

test("fixture factor rewards easy runs, punishes hard ones and is capped", () => {
  assert.equal(fixtureFactor(3), 1);
  assert.equal(fixtureFactor(null), 1);
  assert.equal(fixtureFactor(undefined), 1);
  assert.ok(fixtureFactor(2) > 1);
  assert.ok(fixtureFactor(4.5) < 1);
  assert.ok(fixtureFactor(1) <= 1.15 + 1e-9, "swing is capped upwards");
  assert.ok(fixtureFactor(5) >= 0.85 - 1e-9, "swing is capped downwards");
});

test("every ranked player carries a breakdown and an explanation", () => {
  const result = buildRankings(bootstrap([element(), element({ id: 2, web_name: "Other", draft_rank: 4 })]), {
    fixtureContext: buildFixtureContext(MAIN_TEAMS, mainFixtures()),
  });
  for (const player of result.players) {
    const b = player.breakdown;
    assert.ok(b, "breakdown present");
    for (const key of ["historical", "draftRank", "fixtures", "availability"]) {
      assert.ok(key in b, `breakdown.${key} present`);
    }
    assert.equal(typeof b.summary, "string");
    assert.ok(b.summary.startsWith(`Ranked ${player.rank}:`), b.summary);
    assert.ok(b.summary.endsWith("."));
    assert.ok(!b.summary.includes("—"), "no em dashes in generated copy");
    assert.ok(!b.summary.includes("!"), "no exclamation marks in generated copy");
  }
  assert.equal(result.teamsInLeague, 10);
  assert.equal(result.weights.lowMinutesThreshold, LOW_MINUTES_THRESHOLD);
});

test("empty and malformed bootstraps do not throw", () => {
  for (const input of [{}, { elements: [] }, { elements: [], teams: [] }, undefined]) {
    const result = buildRankings(input);
    assert.deepEqual(result.players, []);
  }
  // A teams-in-league count is still accepted as the second argument.
  assert.equal(buildRankings(bootstrap([element()]), 8).teamsInLeague, 8);
});

test("the bundled demo snapshot runs the full blended model", () => {
  // Read rather than import, so the suite runs on any Node 18 or newer.
  const sample = JSON.parse(
    fs.readFileSync(new URL("../lib/sample-data.json", import.meta.url), "utf8")
  );
  const context = buildFixtureContext(sample.__main_game.teams, sample.__main_game.fixtures);
  assert.equal(context.teams.length, 20, "all 20 demo clubs have opening fixtures");
  for (const team of context.teams) {
    assert.equal(team.run.length, 6);
    assert.ok(team.average >= 1 && team.average <= 5);
  }

  const result = buildRankings(sample, { fixtureContext: context });
  assert.equal(result.fixturesAvailable, true);
  assert.ok(result.players.length > 100);
  assert.ok(
    result.players.some((p) => p.breakdown.lowMinutes && p.draftRank !== null),
    "demo data should exercise the low-minutes weight shift"
  );
  assert.ok(
    result.players.some((p) => p.status !== "a"),
    "demo data should exercise the availability signal"
  );
  assert.ok(result.players.every((p) => p.fixtureAverage !== null), "every demo club joins to fixtures");
});
