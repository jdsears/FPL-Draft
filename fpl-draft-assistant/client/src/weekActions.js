// What to do this week, in the order it matters.
//
// Everything else in the app answers a question. This answers the only one that
// gets asked every week: is there anything I need to do before the deadline. A
// screen full of correct numbers is not the same as an answer.
//
// Kept as plain logic, away from the markup, because the order of priority is
// the substance of the feature and worth pinning down in a test.

const URGENT_HOURS = 24;

function deadlineAction(deadline) {
  const hours = Number(deadline?.hoursAway);
  if (!Number.isFinite(hours)) return null;
  if (hours < 0) return { tone: "calm", title: "The deadline has passed, so this week is settled." };
  if (hours < 2) return { tone: "urgent", title: "The deadline is under two hours away." };
  if (hours < URGENT_HOURS) return { tone: "urgent", title: `The deadline is ${Math.round(hours)} hours away.` };
  const days = Math.round(hours / 24);
  return { tone: "calm", title: `${days} ${days === 1 ? "day" : "days"} until the deadline.` };
}

/**
 * Work out the short list. The order is deliberate: things that are wrong, then
 * things to decide, then the state of the week.
 */
export function buildActions({ week, agents, notes }) {
  const actions = [];
  const lineup = week?.lineup;
  if (!lineup) return actions;

  if (!lineup.playable) {
    return [
      {
        tone: "urgent",
        title: "Your squad cannot field a legal eleven",
        detail: "Connect your league, or mark your fifteen, so the app knows who you have.",
      },
    ];
  }

  // A starter who may not play is the only thing worth interrupting anyone for.
  for (const w of lineup.warnings || []) {
    if (w.kind !== "unavailable" && w.kind !== "suspended") continue;
    actions.push({
      tone: "urgent",
      title: `${w.name} is in your eleven and may not play`,
      detail: `${w.detail}. The app has still started them because nobody on your bench beats them even after the discount, so this one is your call.`,
    });
  }

  const doubts = (lineup.warnings || []).filter((w) => w.kind === "doubt" || w.kind === "blank");
  if (doubts.length) {
    actions.push({
      tone: "check",
      title:
        doubts.length === 1
          ? `${doubts[0].name} is worth a second look`
          : `${doubts.length} of your eleven are worth a second look`,
      detail: `${doubts.map((w) => `${w.name}: ${w.detail}`).join(". ")}.`,
    });
  }

  if (!notes?.length) {
    actions.push({
      tone: "check",
      title: "No team news on file yet",
      detail:
        "Nothing here reflects a press conference. Ask Nova to check, or tell her anything you have heard and she will write it down.",
    });
  }

  const claim = agents?.upgrades?.[0];
  if (claim) {
    actions.push({
      tone: "gain",
      title: `Claim ${claim.in.name} for ${claim.out.name}, worth ${claim.gain.toFixed(1)} a gameweek`,
      detail: claim.summary,
    });
  }

  if (week.opponent) {
    const margin = lineup.expected - week.opponent.expected;
    const close = Math.abs(margin) < 3;
    actions.push({
      tone: close ? "calm" : margin > 0 ? "gain" : "check",
      title: close
        ? "This one is too close to call"
        : margin > 0
          ? `Projected to win by about ${margin.toFixed(1)}`
          : `Projected to lose by about ${Math.abs(margin).toFixed(1)}`,
      detail: close
        ? "Every starting choice counts, so the team news matters more than usual."
        : margin > 0
          ? "Hold what you have unless the news changes."
          : "You need something to go your way, so a claim or a trade is worth more than usual.",
    });
  }

  const clock = deadlineAction(week.deadline);
  if (clock) actions.push(clock);
  return actions;
}
