import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFixtureContext,
  indexFixtureTeams,
  findFixtureTeam,
  normaliseTeamName,
  OPENING_GAMEWEEKS,
} from "../lib/fixtures.js";

const MAIN_TEAMS = [
  { id: 11, name: "Arsenal", short_name: "ARS" },
  { id: 12, name: "Liverpool", short_name: "LIV" },
  { id: 13, name: "Nott'm Forest", short_name: "NFO" },
];

test("averages difficulty across the opening gameweeks only", () => {
  const context = buildFixtureContext(MAIN_TEAMS, [
    { event: 1, team_h: 11, team_a: 12, team_h_difficulty: 4, team_a_difficulty: 5 },
    { event: 2, team_h: 12, team_a: 11, team_h_difficulty: 2, team_a_difficulty: 4 },
    // Beyond the opening run, so ignored.
    { event: 30, team_h: 11, team_a: 12, team_h_difficulty: 1, team_a_difficulty: 1 },
    // Unscheduled fixtures carry a null event.
    { event: null, team_h: 11, team_a: 13, team_h_difficulty: 2, team_a_difficulty: 2 },
  ]);

  assert.equal(context.gameweeks.length, OPENING_GAMEWEEKS);
  const arsenal = context.teams.find((t) => t.shortName === "ARS");
  assert.equal(arsenal.average, 4); // (4 + 4) / 2
  assert.equal(arsenal.fixtureCount, 2);
  assert.equal(arsenal.run.length, OPENING_GAMEWEEKS);
  assert.equal(arsenal.run[0].fixtures[0].opponent, "LIV");
  assert.equal(arsenal.run[0].fixtures[0].home, true);
  assert.equal(arsenal.run[1].fixtures[0].home, false);
  assert.deepEqual(arsenal.run[2].fixtures, [], "a blank gameweek stays empty");

  // Clubs with nothing scheduled in the opening run are left out entirely.
  assert.ok(!context.teams.some((t) => t.shortName === "NFO"));
});

test("double gameweeks average across both fixtures", () => {
  const context = buildFixtureContext(MAIN_TEAMS, [
    { event: 1, team_h: 11, team_a: 12, team_h_difficulty: 5, team_a_difficulty: 5 },
    { event: 1, team_h: 11, team_a: 13, team_h_difficulty: 1, team_a_difficulty: 5 },
  ]);
  const arsenal = context.teams.find((t) => t.shortName === "ARS");
  assert.equal(arsenal.run[0].fixtures.length, 2);
  assert.equal(arsenal.average, 3);
});

test("missing or malformed inputs return an empty context", () => {
  for (const [teams, fixtures] of [
    [null, null],
    [undefined, undefined],
    [MAIN_TEAMS, null],
    [MAIN_TEAMS, []],
    [[], []],
  ]) {
    const context = buildFixtureContext(teams, fixtures);
    assert.deepEqual(context.teams, []);
  }
});

test("missing difficulty values are treated as neutral", () => {
  const context = buildFixtureContext(MAIN_TEAMS, [
    { event: 1, team_h: 11, team_a: 12, team_h_difficulty: null, team_a_difficulty: undefined },
  ]);
  assert.equal(context.teams.find((t) => t.shortName === "ARS").average, 3);
});

test("draft-game teams join to main-game teams by name, not id", () => {
  const context = buildFixtureContext(MAIN_TEAMS, [
    { event: 1, team_h: 11, team_a: 12, team_h_difficulty: 2, team_a_difficulty: 4 },
    { event: 2, team_h: 13, team_a: 11, team_h_difficulty: 3, team_a_difficulty: 3 },
  ]);
  const index = indexFixtureTeams(context.teams);

  // Draft-game ids differ from main-game ids, and names vary in punctuation.
  assert.equal(findFixtureTeam(index, { id: 1, name: "Arsenal", short_name: "ARS" }).mainTeamId, 11);
  assert.equal(findFixtureTeam(index, { id: 7, name: "Nottingham Forest", short_name: "NOT" }).mainTeamId, 13);
  assert.equal(findFixtureTeam(index, { name: "Liverpool" }).mainTeamId, 12);
  assert.equal(findFixtureTeam(index, { short_name: "LIV" }).mainTeamId, 12);
  assert.equal(findFixtureTeam(index, { name: "Real Madrid", short_name: "RMA" }), null);
  assert.equal(findFixtureTeam(index, null), null);
  assert.equal(findFixtureTeam(null, { name: "Arsenal" }), null);
});

test("every 2026/27 club joins from the draft game to the main game", () => {
  // Draft-game names and short names, taken from a live draft bootstrap.
  const draftTeams = [
    [1, "Arsenal", "ARS"],
    [2, "Aston Villa", "AVL"],
    [3, "Bournemouth", "BOU"],
    [4, "Brentford", "BRE"],
    [5, "Brighton", "BHA"],
    [6, "Chelsea", "CHE"],
    [7, "Coventry City", "COV"],
    [8, "Crystal Palace", "CRY"],
    [9, "Everton", "EVE"],
    [10, "Fulham", "FUL"],
    [11, "Hull City", "HUL"],
    [12, "Ipswich Town", "IPS"],
    [13, "Leeds", "LEE"],
    [14, "Liverpool", "LIV"],
    [15, "Man City", "MCI"],
    [16, "Man Utd", "MUN"],
    [17, "Newcastle", "NEW"],
    [18, "Nott'm Forest", "NFO"],
    [19, "Spurs", "TOT"],
    [20, "Sunderland", "SUN"],
  ].map(([id, name, short_name]) => ({ id, name, short_name }));

  // The main game names some clubs differently and uses its own ids. Both the
  // matching short name and a differing full name must resolve.
  const mainTeams = draftTeams.map((t, i) => ({
    id: 500 + i,
    short_name: t.short_name,
    name: { "Coventry City": "Coventry", "Hull City": "Hull", "Ipswich Town": "Ipswich" }[t.name] || t.name,
  }));

  const fixtures = mainTeams.map((t, i) => ({
    event: 1,
    team_h: t.id,
    team_a: mainTeams[(i + 1) % mainTeams.length].id,
    team_h_difficulty: 3,
    team_a_difficulty: 3,
  }));
  const index = indexFixtureTeams(buildFixtureContext(mainTeams, fixtures).teams);

  for (const team of draftTeams) {
    const hit = findFixtureTeam(index, team);
    assert.ok(hit, `no fixture join for ${team.name} (${team.short_name})`);
    assert.equal(hit.shortName, team.short_name);
  }

  // The join must also survive a main game that only differs by full name,
  // which is what the alias table is for.
  const noShortNames = mainTeams.map((t) => ({ id: t.id, name: t.name, short_name: "" }));
  const nameOnly = indexFixtureTeams(buildFixtureContext(noShortNames, fixtures).teams);
  for (const team of draftTeams) {
    assert.ok(findFixtureTeam(nameOnly, team), `no name-only join for ${team.name}`);
  }
});

test("team names normalise across punctuation, accents and known aliases", () => {
  assert.equal(normaliseTeamName("Nott'm Forest"), normaliseTeamName("Nottingham Forest"));
  assert.equal(normaliseTeamName("Man Utd"), normaliseTeamName("Manchester United"));
  assert.equal(normaliseTeamName("Spurs"), normaliseTeamName("Tottenham"));
  assert.equal(normaliseTeamName("Wolves"), normaliseTeamName("Wolverhampton Wanderers"));
  assert.equal(normaliseTeamName("Brighton"), normaliseTeamName("Brighton & Hove Albion"));
  assert.equal(normaliseTeamName(null), "");
  assert.notEqual(normaliseTeamName("Arsenal"), normaliseTeamName("Aston Villa"));
});
