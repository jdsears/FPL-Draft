import test from "node:test";
import assert from "node:assert/strict";

import { buildWaiverBoard, SHORTLIST_PER_POSITION, MIN_GAIN } from "../lib/waivers.js";

let nextId = 1;

function player(position, perGameweek, extra = {}) {
  return {
    id: extra.id || nextId++,
    name: extra.name || `${position}${perGameweek}`,
    position,
    status: "a",
    news: "",
    ...extra,
    season: {
      perGameweek,
      fixtures: 5,
      playProbability: 1,
      appearances: 10,
      ...(extra.season || {}),
    },
  };
}

test("the shortlist is unowned players only, best first", () => {
  const held = player("MID", 9, { name: "Held" });
  const free = [player("MID", 8, { name: "Free8" }), player("MID", 6, { name: "Free6" })];
  const owned = player("MID", 7, { name: "Rival" });

  const board = buildWaiverBoard([held, owned, ...free], {
    owned: [owned.id],
    mine: [held.id],
  });

  assert.deepEqual(board.freeAgents.MID.map((p) => p.name), ["Free8", "Free6"]);
  assert.equal(board.availableCount, 2);
  assert.equal(board.squadKnown, true);
});

test("the shortlist is capped per position and the cap is sane", () => {
  assert.ok(SHORTLIST_PER_POSITION >= 5 && SHORTLIST_PER_POSITION <= 15);
  const pool = Array.from({ length: 30 }, (_, i) => player("DEF", 30 - i));
  const board = buildWaiverBoard(pool, { perPosition: 4 });
  assert.equal(board.freeAgents.DEF.length, 4);
  assert.equal(board.freeAgents.DEF[0].season.perGameweek, 30);
  assert.equal(board.freeAgents.MID.length, 0);
});

test("a claim is only suggested when it beats the worst player you hold", () => {
  const squad = [player("MID", 8, { name: "Good" }), player("MID", 2, { name: "Weak" })];
  const board = buildWaiverBoard([...squad, player("MID", 5, { name: "Better" })], {
    mine: squad.map((p) => p.id),
  });

  assert.equal(board.upgrades.length, 1);
  const [upgrade] = board.upgrades;
  assert.equal(upgrade.out.name, "Weak", "you drop the worst, not the first");
  assert.equal(upgrade.in.name, "Better");
  assert.equal(upgrade.gain, 3);
  assert.equal(upgrade.position, "MID");
  assert.match(upgrade.summary, /Better is projected 3 more a gameweek than Weak/);
});

test("no swap is suggested when your squad is already stronger", () => {
  const squad = [player("FWD", 8), player("FWD", 7)];
  const board = buildWaiverBoard([...squad, player("FWD", 6)], { mine: squad.map((p) => p.id) });
  assert.deepEqual(board.upgrades, []);
});

test("a marginal gain is left alone", () => {
  assert.ok(MIN_GAIN > 0 && MIN_GAIN < 1);
  const held = player("DEF", 4);
  const board = buildWaiverBoard([held, player("DEF", 4 + MIN_GAIN / 2)], { mine: [held.id] });
  assert.deepEqual(board.upgrades, [], "churn for nothing costs you waiver priority");

  const worthwhile = buildWaiverBoard([held, player("DEF", 4 + MIN_GAIN)], { mine: [held.id] });
  assert.equal(worthwhile.upgrades.length, 1);
});

test("every swap keeps the squad legal by staying in position", () => {
  const squad = [
    player("GKP", 2, { name: "MyGK" }),
    player("DEF", 2, { name: "MyDEF" }),
    player("MID", 2, { name: "MyMID" }),
    player("FWD", 2, { name: "MyFWD" }),
  ];
  const board = buildWaiverBoard(
    [...squad, player("GKP", 5), player("DEF", 6), player("MID", 9), player("FWD", 7)],
    { mine: squad.map((p) => p.id) }
  );
  assert.equal(board.upgrades.length, 4);
  for (const u of board.upgrades) {
    assert.equal(u.in.position, u.out.position);
    assert.equal(u.position, u.out.position);
  }
  // Ordered by what the swap is worth, so the biggest win is at the top.
  assert.deepEqual(board.upgrades.map((u) => u.position), ["MID", "FWD", "DEF", "GKP"]);
});

test("the reason names the real problem with the player being dropped", () => {
  const injured = player("MID", 1, { name: "Crocked", status: "i", news: "Knee" });
  const benchwarmer = player("DEF", 1, {
    name: "Warmer",
    season: { perGameweek: 1, playProbability: 0.3, fixtures: 5, appearances: 10 },
  });
  const blank = player("FWD", 1, { name: "Idle", season: { perGameweek: 1, fixtures: 0, appearances: 10 } });

  const board = buildWaiverBoard(
    [injured, benchwarmer, blank, player("MID", 5), player("DEF", 5), player("FWD", 5)],
    { mine: [injured.id, benchwarmer.id, blank.id] }
  );

  const reason = (pos) => board.upgrades.find((u) => u.position === pos).summary;
  assert.match(reason("MID"), /Crocked is not available to play/);
  assert.match(reason("DEF"), /Warmer is not a regular starter/);
  assert.match(reason("FWD"), /Idle has no fixture in the window/);
  for (const u of board.upgrades) {
    assert.ok(u.summary.endsWith("."));
    assert.ok(!u.summary.includes("—"), "no em dashes");
    assert.ok(!u.summary.includes("!"), "no exclamation marks");
  }
});

test("a thin projection and a flagged arrival are both called out", () => {
  const held = player("MID", 1, { name: "Held" });
  const board = buildWaiverBoard(
    [held, player("MID", 6, { name: "Newcomer", status: "d", season: { perGameweek: 6, appearances: 1, fixtures: 5 } })],
    { mine: [held.id] }
  );
  const [upgrade] = board.upgrades;
  assert.match(upgrade.summary, /Newcomer has barely played/);
});

test("a flagged newcomer is flagged even with a full record", () => {
  const held = player("DEF", 1, { name: "Held" });
  const board = buildWaiverBoard(
    [held, player("DEF", 6, { name: "Risky", status: "s" })],
    { mine: [held.id] }
  );
  assert.match(board.upgrades[0].summary, /Risky is flagged too/);
});

test("an unknown squad still ranks the free agents", () => {
  const board = buildWaiverBoard([player("MID", 5), player("MID", 3)], {});
  assert.equal(board.squadKnown, false);
  assert.deepEqual(board.upgrades, []);
  assert.equal(board.freeAgents.MID.length, 2);
});

test("empty and malformed input does not throw", () => {
  for (const input of [undefined, null, [], [null]]) {
    const board = buildWaiverBoard(input, { owned: undefined, mine: undefined });
    assert.deepEqual(board.upgrades, []);
    assert.equal(board.availableCount, 0);
    assert.deepEqual(Object.keys(board.freeAgents), ["GKP", "DEF", "MID", "FWD"]);
  }
  // Sets and plain arrays are both accepted for ownership.
  const held = player("MID", 4);
  const asSet = buildWaiverBoard([held, player("MID", 9)], { mine: new Set([held.id]) });
  assert.equal(asSet.upgrades.length, 1);
});
