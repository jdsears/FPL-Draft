// Opening-fixture difficulty, derived from the main FPL game.
//
// The draft game does not publish fixture difficulty, so we borrow it from
// fantasy.premierleague.com. Element and team IDs differ between the two
// games, so every join here is done on team name or short name, never on id.

export const OPENING_GAMEWEEKS = 6;

// Difficulty runs 1 (easiest) to 5 (hardest); 3 is a neutral fixture.
export const NEUTRAL_DIFFICULTY = 3;

// Clubs whose names differ between data sources or seasons. Keys and values
// are already normalised (lowercase, punctuation and spaces stripped).
const NAME_ALIASES = {
  manutd: "manchesterutd",
  manchesterunited: "manchesterutd",
  mancity: "manchestercity",
  spurs: "tottenham",
  tottenhamhotspur: "tottenham",
  nottmforest: "nottinghamforest",
  nottsforest: "nottinghamforest",
  wolves: "wolverhampton",
  wolverhamptonwanderers: "wolverhampton",
  brighton: "brightonhovealbion",
  leeds: "leedsunited",
  newcastle: "newcastleunited",
  westham: "westhamunited",
  sheffieldutd: "sheffieldunited",
  lutontown: "luton",
  ipswichtown: "ipswich",
  coventrycity: "coventry",
  hullcity: "hull",
  leicestercity: "leicester",
  stokecity: "stoke",
  norwichcity: "norwich",
  cardiffcity: "cardiff",
  swanseacity: "swansea",
  birminghamcity: "birmingham",
};

export function normaliseTeamName(value) {
  const base = String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return NAME_ALIASES[base] || base;
}

function difficultyFor(fixture, isHome) {
  const raw = isHome ? fixture.team_h_difficulty : fixture.team_a_difficulty;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : NEUTRAL_DIFFICULTY;
}

/**
 * Build the serialisable opening-fixture picture for every team.
 *
 * @param {Array} mainTeams  teams array from the main-game bootstrap
 * @param {Array} fixtureList  entries from the main-game fixtures endpoint
 * @returns {{gameweeks: number[], teams: Array}} one entry per team, each with
 *   a per-gameweek fixture run and the average difficulty across the run.
 */
export function buildFixtureContext(mainTeams, fixtureList, options = {}) {
  const count = options.gameweeks || OPENING_GAMEWEEKS;
  const firstEvent = options.firstEvent || 1;
  const events = Array.from({ length: count }, (_, i) => firstEvent + i);
  const teams = Array.isArray(mainTeams) ? mainTeams : [];
  const fixtures = Array.isArray(fixtureList) ? fixtureList : [];

  const byId = new Map(teams.map((t) => [t.id, t]));
  const runs = new Map(
    teams.map((t) => [t.id, new Map(events.map((event) => [event, []]))])
  );

  for (const fixture of fixtures) {
    const event = Number(fixture.event);
    if (!events.includes(event)) continue;
    for (const isHome of [true, false]) {
      const teamId = isHome ? fixture.team_h : fixture.team_a;
      const opponentId = isHome ? fixture.team_a : fixture.team_h;
      const slots = runs.get(teamId);
      if (!slots) continue;
      const opponent = byId.get(opponentId) || {};
      slots.get(event).push({
        opponent: opponent.short_name || "?",
        opponentName: opponent.name || "Unknown",
        home: isHome,
        difficulty: difficultyFor(fixture, isHome),
      });
    }
  }

  const built = teams.map((team) => {
    const slots = runs.get(team.id);
    const run = events.map((event) => ({ event, fixtures: slots.get(event) }));
    const played = run.flatMap((gw) => gw.fixtures);
    const average = played.length
      ? Number(
          (played.reduce((sum, f) => sum + f.difficulty, 0) / played.length).toFixed(2)
        )
      : null;
    return {
      mainTeamId: team.id,
      name: team.name,
      shortName: team.short_name,
      average,
      fixtureCount: played.length,
      run,
    };
  });

  return { gameweeks: events, teams: built.filter((t) => t.fixtureCount > 0) };
}

/**
 * Index a fixture context for lookups from draft-game teams, which carry
 * different ids but the same club names and short names.
 */
export function indexFixtureTeams(fixtureTeams) {
  const index = new Map();
  for (const team of fixtureTeams || []) {
    for (const key of [normaliseTeamName(team.shortName), normaliseTeamName(team.name)]) {
      if (key && !index.has(key)) index.set(key, team);
    }
  }
  return index;
}

/** Look a draft-game team up in an indexed fixture context. */
export function findFixtureTeam(index, draftTeam) {
  if (!index || !draftTeam) return null;
  const keys = [
    normaliseTeamName(draftTeam.short_name || draftTeam.shortName),
    normaliseTeamName(draftTeam.name || draftTeam.teamName),
  ].filter(Boolean);
  for (const key of keys) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  return null;
}
