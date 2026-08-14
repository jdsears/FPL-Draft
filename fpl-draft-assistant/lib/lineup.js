// Picking the eleven.
//
// Captains are disabled in this league, so the weekly decision is purely which
// eleven of the fifteen start. The search space is tiny: one goalkeeper plus a
// legal split of ten outfielders, so every formation can be enumerated and
// scored exactly rather than approximated.

/** Squad and formation rules, as reported by the league's own settings. */
export const SQUAD_RULES = {
  size: 15,
  play: 11,
  select: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
  minPlay: { GKP: 1, DEF: 3, MID: 2, FWD: 1 },
  maxPlay: { GKP: 1, DEF: 5, MID: 5, FWD: 3 },
};

const POSITIONS = ["GKP", "DEF", "MID", "FWD"];

/** Every legal split of the outfield ten, plus the single goalkeeper. */
export function legalFormations(rules = SQUAD_RULES) {
  const formations = [];
  for (let def = rules.minPlay.DEF; def <= rules.maxPlay.DEF; def++) {
    for (let mid = rules.minPlay.MID; mid <= rules.maxPlay.MID; mid++) {
      for (let fwd = rules.minPlay.FWD; fwd <= rules.maxPlay.FWD; fwd++) {
        if (rules.minPlay.GKP + def + mid + fwd === rules.play) {
          formations.push({ GKP: rules.minPlay.GKP, DEF: def, MID: mid, FWD: fwd });
        }
      }
    }
  }
  return formations;
}

const expectedOf = (player) => Number(player?.season?.perGameweek) || 0;
const byExpected = (a, b) => expectedOf(b) - expectedOf(a);

function warningsFor(starters, squad, rules) {
  const warnings = [];
  for (const p of starters) {
    const status = String(p.status || "a").toLowerCase();
    if (status === "i" || status === "u" || status === "n") {
      warnings.push({ id: p.id, name: p.name, kind: "unavailable", detail: p.news || "Not available" });
    } else if (status === "s") {
      warnings.push({ id: p.id, name: p.name, kind: "suspended", detail: p.news || "Suspended" });
    } else if (status === "d") {
      warnings.push({ id: p.id, name: p.name, kind: "doubt", detail: p.news || "A fitness doubt" });
    }
    if (p.season && p.season.fixtures === 0) {
      warnings.push({ id: p.id, name: p.name, kind: "blank", detail: "No fixture in the window" });
    }
  }
  for (const pos of POSITIONS) {
    const held = squad.filter((p) => p.position === pos).length;
    if (held < rules.minPlay[pos]) {
      warnings.push({
        kind: "short",
        detail: `Only ${held} ${pos} in the squad, and ${rules.minPlay[pos]} must start`,
      });
    }
  }
  return warnings;
}

/**
 * Choose the highest-scoring legal eleven from a squad.
 *
 * @param {Array} squad  players carrying a season projection
 * @returns {{formation, label, starters, bench, expected, warnings, playable}}
 */
export function pickLineup(squad, rules = SQUAD_RULES) {
  const players = (squad || []).filter(Boolean);
  const pools = Object.fromEntries(
    POSITIONS.map((pos) => [pos, players.filter((p) => p.position === pos).sort(byExpected)])
  );

  let best = null;
  for (const formation of legalFormations(rules)) {
    // A formation is only available if the squad can actually fill it.
    if (POSITIONS.some((pos) => pools[pos].length < formation[pos])) continue;
    const starters = POSITIONS.flatMap((pos) => pools[pos].slice(0, formation[pos]));
    const expected = starters.reduce((sum, p) => sum + expectedOf(p), 0);
    if (!best || expected > best.expected) best = { formation, starters, expected };
  }

  if (!best) {
    return {
      formation: null,
      label: "",
      starters: [],
      bench: players.slice().sort(byExpected),
      expected: 0,
      warnings: warningsFor([], players, rules),
      playable: false,
    };
  }

  const startingIds = new Set(best.starters.map((p) => p.id));
  const substitutes = players.filter((p) => !startingIds.has(p.id));
  // The reserve goalkeeper sits in the locked bench slot; the outfielders are
  // ordered by expectation, which is the order they come on in.
  const bench = [
    ...substitutes.filter((p) => p.position === "GKP").sort(byExpected),
    ...substitutes.filter((p) => p.position !== "GKP").sort(byExpected),
  ];

  const { DEF, MID, FWD } = best.formation;
  return {
    formation: best.formation,
    label: `${DEF}-${MID}-${FWD}`,
    starters: POSITIONS.flatMap((pos) => best.starters.filter((p) => p.position === pos)),
    bench,
    expected: Math.round(best.expected * 10) / 10,
    warnings: warningsFor(best.starters, players, rules),
    playable: true,
  };
}
