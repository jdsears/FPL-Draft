import test from "node:test";
import assert from "node:assert/strict";

import { buildActions } from "../client/src/weekActions.js";

const lineup = (over = {}) => ({
  playable: true,
  label: "4-3-3",
  expected: 40,
  warnings: [],
  starters: [],
  bench: [],
  ...over,
});

const week = (over = {}) => {
  // Pull the nested pieces out before spreading, or the raw partial overwrites
  // the built lineup and every test looks like an unfieldable squad.
  const { lineup: lineupOver, opponent, ...rest } = over;
  return { ...rest, lineup: lineup(lineupOver), opponent: opponent ?? null };
};

const titles = (actions) => actions.map((a) => a.title);
const tones = (actions) => actions.map((a) => a.tone);

test("nothing to say without a lineup", () => {
  assert.deepEqual(buildActions({}), []);
  assert.deepEqual(buildActions({ week: {} }), []);
});

test("an unfieldable squad is the only thing said", () => {
  const actions = buildActions({ week: week({ lineup: { playable: false } }) });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tone, "urgent");
  assert.match(actions[0].title, /cannot field a legal eleven/);
});

test("a starter who may not play comes first, and is urgent", () => {
  const actions = buildActions({
    week: week({
      lineup: {
        warnings: [
          { kind: "doubt", name: "Raya", detail: "Knock" },
          { kind: "suspended", name: "Barnes", detail: "Red card" },
        ],
      },
      deadline: { hoursAway: 40 },
    }),
    notes: [{ id: 1 }],
  });
  assert.match(actions[0].title, /Barnes is in your eleven and may not play/);
  assert.equal(actions[0].tone, "urgent");
  assert.match(actions[1].title, /Raya is worth a second look/);
  assert.equal(actions[1].tone, "check");
});

test("several doubts are collapsed into one line", () => {
  const actions = buildActions({
    week: week({
      lineup: {
        warnings: [
          { kind: "doubt", name: "Raya", detail: "Knock" },
          { kind: "blank", name: "Hall", detail: "No fixture in the window" },
        ],
      },
    }),
    notes: [{ id: 1 }],
  });
  const line = actions.find((a) => a.tone === "check");
  assert.match(line.title, /2 of your eleven are worth a second look/);
  assert.match(line.detail, /Raya: Knock/);
  assert.match(line.detail, /Hall: No fixture/);
});

test("having no team news on file is itself worth saying", () => {
  const without = buildActions({ week: week(), notes: [] });
  assert.ok(titles(without).some((t) => /No team news on file/.test(t)));

  const withNotes = buildActions({ week: week(), notes: [{ id: 1 }] });
  assert.ok(!titles(withNotes).some((t) => /No team news on file/.test(t)));
});

test("the best claim is offered with what it is worth", () => {
  const actions = buildActions({
    week: week(),
    notes: [{ id: 1 }],
    agents: {
      upgrades: [
        { in: { name: "Semenyo" }, out: { name: "Le Fée" }, gain: 5.14, summary: "Because he starts." },
        { in: { name: "Other" }, out: { name: "Someone" }, gain: 1, summary: "Lesser." },
      ],
    },
  });
  const claim = actions.find((a) => a.tone === "gain");
  assert.equal(claim.title, "Claim Semenyo for Le Fée, worth 5.1 a gameweek");
  assert.equal(claim.detail, "Because he starts.");
  assert.equal(actions.filter((a) => /^Claim /.test(a.title)).length, 1, "only the best one");
});

test("the head-to-head verdict follows the margin", () => {
  const verdict = (mine, theirs) =>
    buildActions({
      week: week({ lineup: { expected: mine }, opponent: { expected: theirs } }),
      notes: [{ id: 1 }],
    }).find((a) => /close to call|Projected to/.test(a.title));

  assert.match(verdict(50, 40).title, /Projected to win by about 10.0/);
  assert.equal(verdict(50, 40).tone, "gain");
  assert.match(verdict(40, 50).title, /Projected to lose by about 10.0/);
  assert.equal(verdict(40, 50).tone, "check");
  assert.match(verdict(41, 40).title, /too close to call/);
  assert.equal(verdict(41, 40).tone, "calm");
  assert.match(verdict(41, 40).detail, /team news matters more than usual/);
});

test("the deadline is last, and urgent only when it is close", () => {
  const clock = (hoursAway) => {
    const actions = buildActions({ week: week({ deadline: { hoursAway } }), notes: [{ id: 1 }] });
    return actions[actions.length - 1];
  };
  assert.match(clock(80).title, /3 days until the deadline/);
  assert.equal(clock(80).tone, "calm");
  assert.match(clock(20).title, /20 hours away/);
  assert.equal(clock(20).tone, "urgent");
  assert.match(clock(1).title, /under two hours away/);
  assert.equal(clock(1).tone, "urgent");
  assert.match(clock(-5).title, /has passed/);
  assert.equal(clock(-5).tone, "calm");

  // No deadline known means no line about it, rather than a blank one.
  const none = buildActions({ week: week(), notes: [{ id: 1 }] });
  assert.ok(!titles(none).some((t) => /deadline/.test(t)));
});

test("a quiet week with everything in order says so without alarm", () => {
  const actions = buildActions({
    week: week({ opponent: { expected: 30 }, deadline: { hoursAway: 100 } }),
    notes: [{ id: 1 }],
    agents: { upgrades: [] },
  });
  assert.ok(!tones(actions).includes("urgent"));
  assert.ok(!tones(actions).includes("check"));
  for (const action of actions) {
    assert.ok(action.title.length > 0);
    assert.ok(!action.title.includes("—"), "no em dashes");
    assert.ok(!action.title.includes("!"), "no exclamation marks");
    if (action.detail) assert.ok(!action.detail.includes("—"));
  }
});
