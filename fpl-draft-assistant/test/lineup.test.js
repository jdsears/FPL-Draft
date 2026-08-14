import test from "node:test";
import assert from "node:assert/strict";

import { pickLineup, legalFormations, SQUAD_RULES } from "../lib/lineup.js";

let nextId = 1;

/** A squad member carrying only what the optimiser reads. */
function player(position, perGameweek, extra = {}) {
  return {
    id: nextId++,
    name: extra.name || `${position}${perGameweek}`,
    position,
    status: "a",
    news: "",
    ...extra,
    season: { perGameweek, fixtures: 5, ...(extra.season || {}) },
  };
}

/** Fifteen players, each position ordered strongest first. */
function squadOf({ gkp, def, mid, fwd }) {
  return [
    ...gkp.map((v) => player("GKP", v)),
    ...def.map((v) => player("DEF", v)),
    ...mid.map((v) => player("MID", v)),
    ...fwd.map((v) => player("FWD", v)),
  ];
}

const names = (list) => list.map((p) => p.name);

test("every formation is legal and the obvious ones are all there", () => {
  const formations = legalFormations();
  assert.ok(formations.length > 0);
  for (const f of formations) {
    assert.equal(f.GKP + f.DEF + f.MID + f.FWD, SQUAD_RULES.play);
    assert.equal(f.GKP, 1);
    assert.ok(f.DEF >= SQUAD_RULES.minPlay.DEF && f.DEF <= SQUAD_RULES.maxPlay.DEF);
    assert.ok(f.MID >= SQUAD_RULES.minPlay.MID && f.MID <= SQUAD_RULES.maxPlay.MID);
    assert.ok(f.FWD >= SQUAD_RULES.minPlay.FWD && f.FWD <= SQUAD_RULES.maxPlay.FWD);
  }
  const labels = formations.map((f) => `${f.DEF}-${f.MID}-${f.FWD}`);
  for (const shape of ["3-5-2", "3-4-3", "4-4-2", "4-5-1", "5-4-1", "5-3-2"]) {
    assert.ok(labels.includes(shape), `expected ${shape} to be legal`);
  }
  assert.ok(!labels.includes("2-5-3"), "two at the back is not legal");
  assert.equal(new Set(labels).size, labels.length, "no duplicates");
});

test("the shape follows where the points are", () => {
  // Strong midfield, weak attack: the fifth midfielder beats the third forward.
  const midHeavy = pickLineup(
    squadOf({ gkp: [4, 3], def: [5, 5, 4, 2, 2], mid: [8, 7, 7, 6, 6], fwd: [5, 4, 1] })
  );
  assert.equal(midHeavy.label, "3-5-2");

  // Same squad with two elite forwards instead: the shape shifts to suit them.
  const attacking = pickLineup(
    squadOf({ gkp: [4, 3], def: [5, 5, 4, 2, 2], mid: [8, 7, 7, 6, 6], fwd: [9, 9, 8] })
  );
  assert.equal(attacking.label, "3-4-3");

  // And with a strong back five it goes the other way.
  const defensive = pickLineup(
    squadOf({ gkp: [4, 3], def: [8, 8, 7, 7, 7], mid: [6, 5, 5, 4, 4], fwd: [5, 2, 1] })
  );
  assert.equal(defensive.label, "5-4-1");
});

test("the eleven picked is exactly the best legal eleven", () => {
  const squad = squadOf({ gkp: [4, 3], def: [6, 6, 5, 3, 2], mid: [9, 8, 7, 5, 4], fwd: [7, 6, 2] });
  const lineup = pickLineup(squad);

  assert.equal(lineup.playable, true);
  assert.equal(lineup.starters.length, SQUAD_RULES.play);
  assert.equal(lineup.bench.length, SQUAD_RULES.size - SQUAD_RULES.play);

  // Check the enumeration against a brute-force search over every combination
  // of eleven from the fifteen, which is only 1365 hands.
  let bestBrute = 0;
  const combine = (start, chosen) => {
    if (chosen.length === SQUAD_RULES.play) {
      const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      for (const p of chosen) counts[p.position]++;
      const legal = ["GKP", "DEF", "MID", "FWD"].every(
        (pos) => counts[pos] >= SQUAD_RULES.minPlay[pos] && counts[pos] <= SQUAD_RULES.maxPlay[pos]
      );
      if (legal) {
        const total = chosen.reduce((sum, p) => sum + p.season.perGameweek, 0);
        if (total > bestBrute) bestBrute = total;
      }
      return;
    }
    for (let i = start; i < squad.length; i++) combine(i + 1, chosen.concat(squad[i]));
  };
  combine(0, []);

  assert.equal(lineup.expected, Math.round(bestBrute * 10) / 10);
  // No player appears in both the eleven and the bench.
  const startingIds = new Set(lineup.starters.map((p) => p.id));
  assert.ok(lineup.bench.every((p) => !startingIds.has(p.id)));
});

test("formations the squad cannot fill are skipped", () => {
  // Three defenders only, so every back four and back five is unavailable.
  const lineup = pickLineup(squadOf({ gkp: [4], def: [6, 5, 4], mid: [8, 7, 7, 6, 5], fwd: [7, 6, 4] }));
  assert.equal(lineup.playable, true);
  assert.equal(lineup.formation.DEF, 3);
  assert.equal(lineup.starters.filter((p) => p.position === "DEF").length, 3);
  assert.equal(lineup.label, "3-5-2");
});

test("a squad that cannot field a legal eleven says so", () => {
  const lineup = pickLineup(squadOf({ gkp: [4], def: [6, 5], mid: [8, 7], fwd: [7] }));
  assert.equal(lineup.playable, false);
  assert.equal(lineup.starters.length, 0);
  assert.equal(lineup.expected, 0);
  assert.equal(lineup.label, "");
  // Everyone falls back to the bench, best first, so the view still lists them.
  assert.deepEqual(names(lineup.bench), ["MID8", "MID7", "FWD7", "DEF6", "DEF5", "GKP4"]);
  const short = lineup.warnings.filter((w) => w.kind === "short");
  assert.deepEqual(
    short.map((w) => w.detail),
    ["Only 2 DEF in the squad, and 3 must start"]
  );
});

test("the reserve goalkeeper takes the locked bench slot", () => {
  // The spare keeper outscores two of the benched outfielders, but bench order
  // is not a ranking: slot 12 is goalkeeper only, so they cannot come on for
  // an outfielder.
  const lineup = pickLineup(squadOf({ gkp: [5, 4], def: [6, 6, 5, 3, 1], mid: [9, 8, 7, 6, 2], fwd: [7, 6, 3] }));
  assert.equal(lineup.bench[0].position, "GKP");
  assert.equal(lineup.bench[0].name, "GKP4");
  const outfield = lineup.bench.slice(1);
  assert.ok(outfield.every((p) => p.position !== "GKP"));
  for (let i = 1; i < outfield.length; i++) {
    assert.ok(
      outfield[i - 1].season.perGameweek >= outfield[i].season.perGameweek,
      "outfield substitutes come on best first"
    );
  }
});

test("flagged and blank starters are called out without being dropped", () => {
  const squad = squadOf({ gkp: [5, 1], def: [6, 6, 5, 1, 1], mid: [9, 8, 7, 1, 1], fwd: [7, 6, 1] });
  squad.find((p) => p.name === "MID9").status = "i";
  squad.find((p) => p.name === "MID9").news = "Knee injury, out until March";
  squad.find((p) => p.name === "DEF6").status = "d";
  squad.find((p) => p.name === "FWD7").status = "s";
  squad.find((p) => p.name === "GKP5").season.fixtures = 0;

  const lineup = pickLineup(squad);
  const kinds = lineup.warnings.map((w) => w.kind);
  assert.ok(kinds.includes("unavailable"));
  assert.ok(kinds.includes("suspended"));
  assert.ok(kinds.includes("doubt"));
  assert.ok(kinds.includes("blank"));
  assert.ok(!kinds.includes("short"));

  const injured = lineup.warnings.find((w) => w.kind === "unavailable");
  assert.equal(injured.name, "MID9");
  assert.equal(injured.detail, "Knee injury, out until March");
  assert.equal(
    lineup.warnings.find((w) => w.kind === "suspended").detail,
    "Suspended",
    "a suspension with no news still reads as one"
  );

  // The model has already discounted them, so the optimiser still starts them
  // if they are the best available. The warning is there to be overridden.
  assert.ok(names(lineup.starters).includes("MID9"));
  assert.equal(lineup.warnings.filter((w) => w.id).every((w) => Boolean(w.name)), true);
});

test("missing and malformed squads do not throw", () => {
  for (const input of [undefined, null, [], [null, undefined]]) {
    const lineup = pickLineup(input);
    assert.equal(lineup.playable, false);
    assert.equal(lineup.starters.length, 0);
  }
  // A player with no projection is worth nothing rather than breaking the sum.
  const lineup = pickLineup(
    squadOf({ gkp: [4, 3], def: [6, 6, 5, 3, 2], mid: [9, 8, 7, 5, 4], fwd: [7, 6, 2] }).concat()
  );
  assert.ok(Number.isFinite(lineup.expected));
  const bare = pickLineup([
    ...Array.from({ length: 2 }, () => ({ id: nextId++, position: "GKP", name: "g" })),
    ...Array.from({ length: 5 }, () => ({ id: nextId++, position: "DEF", name: "d" })),
    ...Array.from({ length: 5 }, () => ({ id: nextId++, position: "MID", name: "m" })),
    ...Array.from({ length: 3 }, () => ({ id: nextId++, position: "FWD", name: "f" })),
  ]);
  assert.equal(bare.playable, true);
  assert.equal(bare.expected, 0);
  assert.equal(bare.starters.length, 11);
});
