// Draft rankings built from the FPL bootstrap data.
//
// Approach: Value Over Replacement Player (VORP) for a 10-team league.
// Each squad is 15 players (2 GK, 5 DEF, 5 MID, 3 FWD), so the "replacement
// level" at each position is roughly the best player still on waivers once
// every team has filled its slots. A player's draft value is how far above
// that replacement level they score, which is why mid-tier midfielders often
// out-rank big-name forwards on a draft board.

const SQUAD_SLOTS = { 1: 2, 2: 5, 3: 5, 4: 3 }; // GK, DEF, MID, FWD per team
const POSITIONS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export function buildRankings(bootstrap, teamsInLeague = 10) {
  const elements = bootstrap.elements || [];
  const teams = new Map((bootstrap.teams || []).map((t) => [t.id, t]));

  // Projected points: last season's total is the anchor. For players who
  // missed chunks of the season, blend in points-per-game over a fuller
  // schedule so a high-PPG player who missed ten games isn't buried.
  const projected = elements.map((e) => {
    const total = Number(e.total_points) || 0;
    const ppg = parseFloat(e.points_per_game) || 0;
    const mins = Number(e.minutes) || 0;
    const startsShare = Math.min(1, mins / (38 * 70)); // rough availability
    const ppgProjection = ppg * 33; // assumes some rotation/injury
    const blend =
      mins > 900 ? Math.max(total, 0.6 * total + 0.4 * ppgProjection) : total;
    return { e, total, ppg, mins, startsShare, proj: Math.round(blend) };
  });

  // Replacement level per position = projected points of the player just
  // outside the league-wide slot count.
  const replacement = {};
  for (const [etype, slots] of Object.entries(SQUAD_SLOTS)) {
    const pool = projected
      .filter((p) => p.e.element_type === Number(etype))
      .sort((a, b) => b.proj - a.proj);
    const idx = Math.min(slots * teamsInLeague, Math.max(pool.length - 1, 0));
    replacement[etype] = pool[idx] ? pool[idx].proj : 0;
  }

  const ranked = projected
    .map((p) => {
      const e = p.e;
      const team = teams.get(e.team) || {};
      const vorp = p.proj - (replacement[e.element_type] || 0);
      return {
        id: e.id,
        code: e.code,
        name: e.web_name,
        fullName: `${e.first_name} ${e.second_name}`.trim(),
        position: POSITIONS[e.element_type] || "?",
        elementType: e.element_type,
        teamId: e.team,
        teamShort: team.short_name || "",
        teamName: team.name || "",
        lastSeasonPoints: p.total,
        ppg: p.ppg,
        minutes: p.mins,
        projectedPoints: p.proj,
        vorp,
        status: e.status,
        news: e.news || "",
        goals: e.goals_scored ?? 0,
        assists: e.assists ?? 0,
        cleanSheets: e.clean_sheets ?? 0,
        ictIndex: parseFloat(e.ict_index) || 0,
        draftRank: e.draft_rank ?? null,
      };
    })
    .filter((p) => p.lastSeasonPoints > 0 || p.minutes > 0 || p.draftRank)
    .sort((a, b) => b.vorp - a.vorp || b.projectedPoints - a.projectedPoints);

  ranked.forEach((p, i) => (p.rank = i + 1));
  return { players: ranked, replacement, teamsInLeague };
}
