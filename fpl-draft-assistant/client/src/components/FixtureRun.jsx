import React from "react";

// Shared rendering for a team's opening fixtures: one chip per gameweek,
// colour-coded by difficulty. Chips are plain elements rather than images, so
// there is nothing to shrink or stretch on a narrow screen.

export const GW_COUNT = 6;

/** Difficulty 1 (easiest) to 5 (hardest), used for the chip colour class. */
export function difficultyClass(difficulty) {
  const value = Math.round(Number(difficulty));
  if (!Number.isFinite(value)) return "fdr-none";
  return `fdr-${Math.min(5, Math.max(1, value))}`;
}

export function averageLabel(average) {
  return average === null || average === undefined ? "n/a" : Number(average).toFixed(1);
}

function chipTitle(fixtures, event) {
  if (!fixtures.length) return `GW${event}: no fixture`;
  return `GW${event}: ${fixtures
    .map((f) => `${f.home ? "vs" : "at"} ${f.opponentName || f.opponent} (difficulty ${f.difficulty})`)
    .join(", ")}`;
}

/**
 * @param {object} props
 * @param {Array} props.run  per-gameweek fixtures from the fixture context
 * @param {boolean} props.labelled  show the opponent's short name in the chip
 */
export default function FixtureRun({ run, labelled = false, className = "" }) {
  if (!run || !run.length) {
    return <span className="pmeta">Fixtures not available</span>;
  }
  return (
    <span className={`fdr-run ${labelled ? "fdr-run-labelled" : ""} ${className}`.trim()}>
      {run.map((gw) => {
        const fixtures = gw.fixtures || [];
        const hardest = fixtures.length
          ? Math.max(...fixtures.map((f) => Number(f.difficulty) || 3))
          : null;
        return (
          <span
            key={gw.event}
            className={`fdr-chip ${difficultyClass(hardest)}`}
            title={chipTitle(fixtures, gw.event)}
          >
            {labelled ? (
              <>
                <span className="fdr-gw">GW{gw.event}</span>
                <span className="fdr-opp">
                  {fixtures.length
                    ? fixtures.map((f) => (f.home ? f.opponent : f.opponent.toLowerCase())).join(" ")
                    : "blank"}
                </span>
              </>
            ) : (
              <span className="fdr-value">{fixtures.length ? hardest : "-"}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
