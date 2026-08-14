// Reading the league.
//
// A head-to-head league is not won by scoring the most points, it is won by
// beating the manager in front of you. So the two things worth knowing are how
// strong each squad is from here, and who you still have to play.
//
// Everything in here works in league_entry ids, which is what the matches and
// standings feeds use. The entry_id that identifies a manager's picks is a
// different number, so the caller does that mapping once and passes squads in
// already keyed by league_entry.

const FORM_MATCHES = 5;

const round1 = (value) => Math.round(value * 10) / 10;
const num = (value) => Number(value) || 0;

/** Did this match actually happen, or is it still to come? */
function isPlayed(match) {
  return Boolean(match?.finished || match?.started);
}

function sidesOf(match) {
  return [
    { id: match.league_entry_1, points: num(match.league_entry_1_points) },
    { id: match.league_entry_2, points: num(match.league_entry_2_points) },
  ];
}

/**
 * A manager's record and recent form from the match list, oldest result first.
 * Computed from the scores rather than the winner field, which is not always
 * populated on older matches.
 */
export function managerRecord(matches, entryId, options = {}) {
  const formMatches = options.formMatches || FORM_MATCHES;
  const played = (matches || [])
    .filter((m) => isPlayed(m) && sidesOf(m).some((s) => s.id === entryId))
    .sort((a, b) => num(a.event) - num(b.event));

  const results = [];
  let pointsFor = 0;
  let pointsAgainst = 0;
  let won = 0;
  let drawn = 0;
  let lost = 0;

  for (const match of played) {
    const [a, b] = sidesOf(match);
    const me = a.id === entryId ? a : b;
    const them = a.id === entryId ? b : a;
    pointsFor += me.points;
    pointsAgainst += them.points;
    if (me.points > them.points) {
      won += 1;
      results.push({ event: num(match.event), result: "W", scored: me.points, conceded: them.points });
    } else if (me.points < them.points) {
      lost += 1;
      results.push({ event: num(match.event), result: "L", scored: me.points, conceded: them.points });
    } else {
      drawn += 1;
      results.push({ event: num(match.event), result: "D", scored: me.points, conceded: them.points });
    }
  }

  const recent = results.slice(-formMatches);
  return {
    played: played.length,
    won,
    drawn,
    lost,
    pointsFor,
    pointsAgainst,
    results,
    form: recent,
    // Points a gameweek recently, which is the fairest read on a squad that has
    // been reshaped since the draft.
    recentAverage: recent.length ? round1(recent.reduce((sum, r) => sum + r.scored, 0) / recent.length) : null,
    average: played.length ? round1(pointsFor / played.length) : null,
  };
}

/** The matches a manager has still to play, soonest first. */
export function remainingFixtures(matches, entryId, fromEvent = 1) {
  return (matches || [])
    .filter((m) => !isPlayed(m) && num(m.event) >= fromEvent && sidesOf(m).some((s) => s.id === entryId))
    .sort((a, b) => num(a.event) - num(b.event))
    .map((m) => {
      const [a, b] = sidesOf(m);
      return { event: num(m.event), opponentId: a.id === entryId ? b.id : a.id };
    });
}

/**
 * Build the whole picture: a table ordered as the league orders it, the user's
 * remaining fixtures with the strength of each opponent, and how that run
 * compares with the league as a whole.
 *
 * @param {object} input
 *   entries    league_entries from the league details feed
 *   standings  standings rows, used for the official rank and league points
 *   matches    every match, played and unplayed
 *   strengths  { [league_entry id]: projected points a gameweek } where known
 *   myEntryId  the user's league_entry id
 *   fromEvent  the next gameweek
 *   upcoming   how many of the user's remaining fixtures to detail
 */
export function buildSeasonOverview(input = {}) {
  const entries = input.entries || [];
  const matches = input.matches || [];
  const standings = input.standings || [];
  const strengths = input.strengths || {};
  const upcoming = input.upcoming || 5;

  const nameOf = (id) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return `Entry ${id}`;
    return entry.entry_name || `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim() || `Entry ${id}`;
  };
  const standingOf = (id) => standings.find((s) => s.league_entry === id) || null;

  const table = entries.map((entry) => {
    const record = managerRecord(matches, entry.id, input);
    const standing = standingOf(entry.id);
    const strength = strengths[entry.id];
    return {
      entryId: entry.id,
      name: nameOf(entry.id),
      manager: `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim(),
      mine: entry.id === input.myEntryId,
      // Before a ball is kicked the feed carries a null rank, so treat any
      // missing or zero rank as unranked rather than as first place.
      rank: standing && num(standing.rank) > 0 ? num(standing.rank) : null,
      waiverPick: num(entry.waiver_pick) || null,
      leaguePoints: standing ? num(standing.total) : record.won * 3 + record.drawn,
      // The standings feed is authoritative on totals, so prefer it and fall
      // back to the match list only when it is missing.
      pointsFor: standing && standing.points_for !== undefined ? num(standing.points_for) : record.pointsFor,
      pointsAgainst:
        standing && standing.points_against !== undefined ? num(standing.points_against) : record.pointsAgainst,
      ...record,
      strength: Number.isFinite(Number(strength)) ? round1(Number(strength)) : null,
    };
  });

  // Before the first gameweek every row is identical zeros, so ordering by
  // results says nothing. Projected squad strength is the only real ranking
  // available, and it is the one worth seeing.
  const anyPlayed = table.some((row) => row.played > 0);
  table.sort((a, b) => {
    if (!anyPlayed) return (b.strength ?? -Infinity) - (a.strength ?? -Infinity);
    if (a.rank && b.rank) return a.rank - b.rank;
    if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
    return b.pointsFor - a.pointsFor;
  });

  const known = table.filter((row) => row.strength !== null);
  const leagueAverageStrength = known.length
    ? round1(known.reduce((sum, row) => sum + row.strength, 0) / known.length)
    : null;

  const byId = new Map(table.map((row) => [row.entryId, row]));
  const schedule = remainingFixtures(matches, input.myEntryId, input.fromEvent || 1)
    .slice(0, upcoming)
    .map((fixture) => {
      const rival = byId.get(fixture.opponentId) || null;
      return {
        event: fixture.event,
        opponentId: fixture.opponentId,
        opponentName: rival ? rival.name : nameOf(fixture.opponentId),
        opponentStrength: rival ? rival.strength : null,
        opponentRank: rival ? rival.rank : null,
        opponentAverage: rival ? rival.recentAverage : null,
      };
    });

  const rated = schedule.filter((f) => f.opponentStrength !== null);
  const averageOpponentStrength = rated.length
    ? round1(rated.reduce((sum, f) => sum + f.opponentStrength, 0) / rated.length)
    : null;

  return {
    table,
    schedule,
    leagueAverageStrength,
    strengthOfSchedule: {
      average: averageOpponentStrength,
      leagueAverage: leagueAverageStrength,
      // Positive means a harder run than the league average opponent.
      versusAverage:
        averageOpponentStrength !== null && leagueAverageStrength !== null
          ? round1(averageOpponentStrength - leagueAverageStrength)
          : null,
      hardest: rated.length ? rated.reduce((a, b) => (b.opponentStrength > a.opponentStrength ? b : a)) : null,
      easiest: rated.length ? rated.reduce((a, b) => (b.opponentStrength < a.opponentStrength ? b : a)) : null,
    },
  };
}
