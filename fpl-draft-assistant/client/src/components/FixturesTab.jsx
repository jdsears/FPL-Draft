import React, { useMemo, useState } from "react";
import FixtureRun, { averageLabel, difficultyClass } from "./FixtureRun.jsx";

const SORTS = [
  ["easiest", "Easiest run"],
  ["hardest", "Hardest run"],
  ["team", "Team A-Z"],
];

const LEGEND = [1, 2, 3, 4, 5];

function cellFixtures(team, event) {
  const gw = team.run.find((g) => g.event === event);
  return gw ? gw.fixtures || [] : [];
}

/**
 * Opening-fixture difficulty for all 20 clubs. A 20x6 matrix on a wide screen,
 * one card per club below 760px so the colour coding survives without
 * shrinking the text.
 */
export default function FixturesTab({ fixtures, fixturesSource }) {
  const [sort, setSort] = useState("easiest");

  const teams = fixtures?.teams || [];
  const gameweeks = fixtures?.gameweeks || [];

  const sorted = useMemo(() => {
    const list = [...teams];
    const avg = (t) => (t.average === null || t.average === undefined ? 99 : t.average);
    if (sort === "team") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "hardest") list.sort((a, b) => avg(b) - avg(a) || a.name.localeCompare(b.name));
    else list.sort((a, b) => avg(a) - avg(b) || a.name.localeCompare(b.name));
    return list;
  }, [teams, sort]);

  if (!teams.length) {
    return (
      <section className="card">
        <h3>Opening fixtures</h3>
        <p className="pmeta">
          Fixture difficulty is not available at the moment, so the draft board is ranking on last
          season's points and the FPL draft rank alone. It will appear once the fixture feed is
          reachable again.
        </p>
      </section>
    );
  }

  return (
    <section className="fixtures">
      <div className="controls">
        <div className="pos-filter">
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              className={`chip ${sort === key ? "active" : ""}`}
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="fdr-legend">
          Easier
          {LEGEND.map((d) => (
            <span key={d} className={`fdr-chip ${difficultyClass(d)}`} title={`Difficulty ${d}`}>
              <span className="fdr-value">{d}</span>
            </span>
          ))}
          Harder
        </span>
      </div>

      <p className="board-hint">
        Average difficulty of gameweeks {gameweeks[0]} to {gameweeks[gameweeks.length - 1]}. Lower is
        kinder, which is where to look for defences in the middle rounds. Home fixtures are in
        capitals, away fixtures in lower case.
        {fixturesSource === "sample" ? " Showing demo fixtures." : ""}
      </p>

      {/* Wide screens: the full matrix, inside the contained scroller. */}
      <div className="table-wrap fixtures-matrix">
        <table className="board fixtures-grid">
          <thead>
            <tr>
              <th>Team</th>
              {gameweeks.map((gw) => (
                <th key={gw} className="num">
                  GW{gw}
                </th>
              ))}
              <th className="num">Avg</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((team) => (
              <tr key={team.shortName}>
                <td>
                  <span className="pname">{team.shortName}</span>
                  <span className="pmeta fixtures-team-name">{team.name}</span>
                </td>
                {gameweeks.map((gw) => {
                  const list = cellFixtures(team, gw);
                  const hardest = list.length
                    ? Math.max(...list.map((f) => Number(f.difficulty) || 3))
                    : null;
                  return (
                    <td key={gw} className="fixtures-cell">
                      <span
                        className={`fdr-chip fdr-cell ${difficultyClass(hardest)}`}
                        title={
                          list.length
                            ? list
                                .map((f) => `${f.home ? "vs" : "at"} ${f.opponentName || f.opponent}`)
                                .join(", ")
                            : "No fixture"
                        }
                      >
                        <span className="fdr-opp">
                          {list.length
                            ? list.map((f) => (f.home ? f.opponent : f.opponent.toLowerCase())).join(" ")
                            : "blank"}
                        </span>
                      </span>
                    </td>
                  );
                })}
                <td className="num strong">{averageLabel(team.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: one card per club, same colours, no matrix. */}
      <div className="fixtures-cards">
        {sorted.map((team) => (
          <div key={team.shortName} className="fixtures-card">
            <div className="best-head">
              <span className="pname">
                {team.shortName}
                <span className="pmeta fixtures-team-name">{team.name}</span>
              </span>
              <span className="best-count">Avg {averageLabel(team.average)}</span>
            </div>
            <FixtureRun run={team.run} labelled />
          </div>
        ))}
      </div>
    </section>
  );
}
