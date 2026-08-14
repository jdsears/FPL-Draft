import test from "node:test";
import assert from "node:assert/strict";

import { suggestTrades, evaluateSwap, MIN_TRADE_GAIN, EASY_ASK_COST } from "../lib/trades.js";

let nextId = 1;

function player(position, perGameweek, name) {
  return {
    id: nextId++,
    name: name || `${position}${perGameweek}`,
    position,
    status: "a",
    news: "",
    season: { perGameweek, fixtures: 5, playProbability: 1, appearances: 10 },
  };
}

/** A legal fifteen: 2 GKP, 5 DEF, 5 MID, 3 FWD. */
function squad({ gkp, def, mid, fwd }, tag = "") {
  return [
    ...gkp.map((v, i) => player("GKP", v, `${tag}GK${i}-${v}`)),
    ...def.map((v, i) => player("DEF", v, `${tag}DF${i}-${v}`)),
    ...mid.map((v, i) => player("MID", v, `${tag}MD${i}-${v}`)),
    ...fwd.map((v, i) => player("FWD", v, `${tag}FW${i}-${v}`)),
  ];
}

const find = (list, name) => list.find((p) => p.name === name);

test("a swap is only valued position for position, and only for players held", () => {
  const mine = squad({ gkp: [4, 3], def: [5, 5, 4, 4, 3], mid: [8, 7, 6, 5, 4], fwd: [6, 5, 4] }, "a");
  const theirs = squad({ gkp: [4, 3], def: [5, 5, 4, 4, 3], mid: [8, 7, 6, 5, 4], fwd: [6, 5, 4] }, "b");

  assert.equal(
    evaluateSwap(mine, theirs, find(mine, "aMD0-8"), find(theirs, "bFW0-6")),
    null,
    "a midfielder for a forward would leave both squads illegal"
  );
  assert.equal(evaluateSwap(mine, theirs, find(theirs, "bMD0-8"), find(theirs, "bMD1-7")), null, "not my player");
  assert.equal(evaluateSwap(mine, theirs, find(mine, "aMD0-8"), find(mine, "aMD1-7")), null, "not their player");
  assert.equal(evaluateSwap(mine, theirs, null, find(theirs, "bMD0-8")), null);

  const legal = evaluateSwap(mine, theirs, find(mine, "aMD4-4"), find(theirs, "bMD0-8"));
  assert.ok(legal);
  assert.equal(legal.position, "MID");
});

// The property that decides what this model can honestly claim. If their spare
// beats my worst starter and mine beats theirs, the inequalities contradict, so
// no like-for-like swap can improve both elevens. This checks it exhaustively
// rather than trusting the algebra.
test("no like-for-like swap improves both elevens", () => {
  const pairs = [
    [
      { gkp: [9, 8], def: [8, 7, 7, 6, 2], mid: [9, 8, 8, 7, 1], fwd: [8, 3, 2] },
      { gkp: [7, 2], def: [9, 6, 5, 5, 4], mid: [4, 4, 3, 3, 9], fwd: [9, 9, 1] },
    ],
    [
      { gkp: [3, 3], def: [9, 9, 9, 9, 9], mid: [1, 1, 1, 1, 1], fwd: [5, 5, 5] },
      { gkp: [8, 1], def: [1, 1, 1, 1, 1], mid: [9, 9, 9, 9, 9], fwd: [2, 2, 2] },
    ],
    [
      { gkp: [5, 5], def: [6, 6, 6, 6, 6], mid: [6, 6, 6, 6, 6], fwd: [6, 6, 6] },
      { gkp: [4, 9], def: [7, 2, 2, 2, 2], mid: [8, 8, 1, 1, 1], fwd: [9, 1, 1] },
    ],
  ];

  let checked = 0;
  for (const [a, b] of pairs) {
    const mine = squad(a, "a");
    const theirs = squad(b, "b");
    for (const mp of mine) {
      for (const tp of theirs) {
        const swap = evaluateSwap(mine, theirs, mp, tp);
        if (!swap) continue;
        checked += 1;
        assert.ok(
          !(swap.myGain > 1e-9 && swap.theirGain > 1e-9),
          `${swap.in.name} for ${swap.out.name} claims to help both sides: ${swap.myGain} and ${swap.theirGain}`
        );
      }
    }
  }
  assert.equal(checked, 3 * (4 + 25 + 25 + 9), "every legal pairing was checked");
});

test("swaps are ranked by what they are worth to me", () => {
  const mine = squad({ gkp: [2, 1], def: [2, 2, 2, 1, 1], mid: [2, 2, 2, 1, 1], fwd: [2, 1, 1] }, "a");
  const theirs = squad({ gkp: [9, 8], def: [9, 9, 8, 8, 7], mid: [9, 9, 8, 8, 7], fwd: [9, 8, 8] }, "b");

  const result = suggestTrades(mine, theirs);
  assert.equal(result.playable, true);
  assert.ok(result.best.length > 0);
  const gains = result.best.map((s) => s.myGain);
  assert.deepEqual(gains, gains.slice().sort((a, b) => b - a));
  for (const swap of result.best) {
    assert.ok(swap.myGain >= MIN_TRADE_GAIN);
    assert.equal(swap.in.position, swap.out.position);
    assert.equal(swap.theirCost, -swap.theirGain);
  }
});

test("the swaps that barely cost the rival are pulled out as the ones to ask for", () => {
  // Their spare keeper is better than mine, and a benched keeper scores nothing
  // for either of us, so this is the cheapest kind of ask.
  const mine = squad({ gkp: [3, 1], def: [6, 6, 5, 5, 4], mid: [8, 7, 7, 6, 5], fwd: [7, 6, 5] }, "a");
  const theirs = squad({ gkp: [9, 8], def: [6, 6, 5, 5, 4], mid: [8, 7, 7, 6, 5], fwd: [7, 6, 5] }, "b");

  const result = suggestTrades(mine, theirs);
  const ask = result.easyAsks.find((s) => s.position === "GKP");
  assert.ok(ask, "trading for their reserve keeper should be an easy ask");
  assert.ok(ask.myGain > 0, "my own keeper improves");
  assert.ok(ask.theirCost < EASY_ASK_COST, "and their eleven does not change");
  assert.match(ask.summary, /costs their eleven nothing|costs them only/);
  for (const swap of result.easyAsks) assert.equal(swap.easyAsk, true);
});

test("each target is listed once, sending whoever costs them least", () => {
  // My fourth and fifth midfielders are both out of my eleven, so acquiring
  // their best midfielder is worth the same whichever of the two I send. Only
  // one version of that deal is worth showing.
  const mine = squad({ gkp: [5, 1], def: [6, 6, 5, 1, 1], mid: [9, 8, 7, 1, 1], fwd: [7, 7, 6] }, "a");
  const theirs = squad({ gkp: [5, 1], def: [6, 6, 5, 4, 4], mid: [9, 9, 8, 8, 7], fwd: [7, 7, 6] }, "b");

  const result = suggestTrades(mine, theirs, { limit: 20 });
  const targets = result.best.map((s) => s.in.id);
  assert.equal(new Set(targets).size, targets.length, "no target appears twice");
  for (const swap of result.easyAsks) assert.ok(result.best.some((s) => s.in.id === swap.in.id));
});

test("two identical squads have nothing worth trading", () => {
  const shape = { gkp: [4, 3], def: [5, 5, 4, 4, 3], mid: [8, 7, 6, 5, 4], fwd: [6, 5, 4] };
  const result = suggestTrades(squad(shape, "a"), squad(shape, "b"));
  assert.equal(result.myEleven, result.theirEleven);
  assert.deepEqual(result.easyAsks, [], "every gain for me costs them the same");
  // Upgrades for me exist, but each one takes exactly as much from them.
  for (const swap of result.best) assert.ok(swap.theirCost >= swap.myGain - 1e-9);
});

test("value is the change in the eleven, not the change in the player", () => {
  // A 3-4-3 leaves the fifth midfielder out, so swapping him for another
  // benched midfielder changes nothing at all.
  const mine = squad({ gkp: [5, 1], def: [6, 6, 5, 1, 1], mid: [9, 8, 7, 6, 1], fwd: [7, 7, 6] }, "a");
  const theirs = squad({ gkp: [5, 1], def: [6, 6, 5, 1, 1], mid: [9, 8, 7, 6, 2], fwd: [7, 7, 6] }, "b");

  const swap = evaluateSwap(mine, theirs, find(mine, "aMD4-1"), find(theirs, "bMD4-2"));
  assert.ok(swap);
  assert.equal(swap.myFormation, "3-4-3");
  assert.equal(swap.startedForMe, false, "my fifth midfielder is not in my eleven");
  assert.equal(swap.startsForMe, false, "and neither is his replacement");
  assert.equal(swap.myGain, 0, "swapping two benched players changes nothing");
  assert.match(swap.summary, /the gain is in depth rather than in your eleven/);
});

test("the reason reads as plain English throughout", () => {
  const mine = squad({ gkp: [2, 1], def: [2, 2, 2, 1, 1], mid: [2, 2, 2, 1, 1], fwd: [2, 1, 1] }, "a");
  const theirs = squad({ gkp: [9, 8], def: [9, 9, 8, 8, 7], mid: [9, 9, 8, 8, 7], fwd: [9, 8, 8] }, "b");
  const result = suggestTrades(mine, theirs);

  for (const swap of result.best) {
    assert.match(swap.summary, /^\S+ for \S+ is worth [\d.]+ a gameweek to you/);
    assert.ok(swap.summary.endsWith("."));
    assert.ok(!swap.summary.includes("—"), "no em dashes");
    assert.ok(!swap.summary.includes("!"), "no exclamation marks");
  }
});

test("a squad that cannot field an eleven is reported rather than valued", () => {
  const short = [player("GKP", 4), player("DEF", 4), player("MID", 4)];
  const full = squad({ gkp: [4, 3], def: [5, 5, 4, 4, 3], mid: [8, 7, 6, 5, 4], fwd: [6, 5, 4] });

  const result = suggestTrades(short, full);
  assert.equal(result.playable, false);
  assert.deepEqual(result.best, []);
  assert.deepEqual(result.easyAsks, []);
  assert.equal(result.considered, 0);

  assert.equal(suggestTrades(full, short).playable, false);
});

test("every legal pairing is considered and the list is capped", () => {
  const shape = { gkp: [4, 3], def: [5, 5, 4, 4, 3], mid: [8, 7, 6, 5, 4], fwd: [6, 5, 4] };
  const result = suggestTrades(squad(shape, "a"), squad(shape, "b"));
  // 2x2 goalkeepers, 5x5 defenders, 5x5 midfielders, 3x3 forwards.
  assert.equal(result.considered, 4 + 25 + 25 + 9);

  const weak = squad({ gkp: [2, 1], def: [2, 2, 2, 1, 1], mid: [2, 2, 2, 1, 1], fwd: [2, 1, 1] }, "a");
  const strong = squad({ gkp: [9, 8], def: [9, 9, 8, 8, 7], mid: [9, 9, 8, 8, 7], fwd: [9, 8, 8] }, "b");
  assert.equal(suggestTrades(weak, strong, { limit: 3 }).best.length, 3);
});

test("empty and malformed squads do not throw", () => {
  for (const input of [undefined, null, [], [null]]) {
    const result = suggestTrades(input, input);
    assert.equal(result.playable, false);
    assert.deepEqual(result.best, []);
  }
});
