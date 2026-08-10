import React, { useMemo, useState } from "react";
import { averageLabel } from "./FixtureRun.jsx";

// A paper backup for draft night: the same board, ordered the same way, laid
// out to print on a couple of sheets. Deliberately renders from the live data
// the app already has, so it cannot drift from the board.

const ORDER = ["GKP", "DEF", "MID", "FWD"];
const LIMITS = [100, 150, 250];
const FIRST_ROUNDS = 30;

/** Short, colour-free flags, because this gets printed in black and white. */
function flagFor(player) {
  const status = String(player.status || "a").toLowerCase();
  const chance = Number(player.chanceOfPlaying);
  const hasChance = Number.isFinite(chance) && player.chanceOfPlaying !== null;
  if (status === "i") return "OUT";
  if (status === "s") return "SUSP";
  if (status === "u" || status === "n") return "N/A";
  if (status === "d") return hasChance ? `${chance}%` : "DOUBT";
  return player.news ? "*" : "";
}

export default function CheatSheet({ players, fixturesAvailable }) {
  const [limit, setLimit] = useState(150);

  const shortlist = useMemo(() => players.slice(0, limit), [players, limit]);
  const byPosition = useMemo(
    () => ORDER.map((pos) => [pos, shortlist.filter((p) => p.position === pos)]),
    [shortlist]
  );
  const flagged = useMemo(() => shortlist.filter((p) => flagFor(p) && p.news), [shortlist]);

  if (!players.length) {
    return (
      <section className="card">
        <h3>Cheat sheet</h3>
        <p className="pmeta">The player board has not loaded yet.</p>
      </section>
    );
  }

  return (
    <section className="cheat">
      <div className="controls cheat-controls">
        <div className="pos-filter">
          {LIMITS.map((n) => (
            <button
              key={n}
              className={`chip ${limit === n ? "active" : ""}`}
              onClick={() => setLimit(n)}
              aria-pressed={limit === n}
            >
              Top {n}
            </button>
          ))}
        </div>
        <button className="chip" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="board-hint cheat-controls">
        Ordered by value over replacement, exactly as the draft board is. Print this before the draft
        so you have it on paper if the wifi goes. Flags: OUT injured, SUSP suspended, a percentage is
        the chance of playing, an asterisk means there is news worth reading.
      </p>

      <header className="cheat-head">
        <h2>Draft cheat sheet</h2>
        <p>
          Top {limit} by value over replacement. 10 teams, 15 rounds, 2 GKP, 5 DEF, 5 MID, 3 FWD.
          {fixturesAvailable ? " GW is the average difficulty of gameweeks 1 to 6." : ""}
        </p>
      </header>

      <div className="cheat-first">
        <h3>First {FIRST_ROUNDS} off the board</h3>
        <ol className="cheat-first-list">
          {players.slice(0, FIRST_ROUNDS).map((p) => (
            <li key={p.id}>
              <span className="cheat-name">{p.name}</span>{" "}
              <span className="cheat-meta">
                {p.teamShort} {p.position}
                {flagFor(p) ? ` ${flagFor(p)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="cheat-grid">
        {byPosition.map(([pos, list]) => (
          <div key={pos} className="cheat-col">
            <h3>
              <span className={`pos pos-${pos}`}>{pos}</span>
              <span className="cheat-count">{list.length} in the top {limit}</span>
            </h3>
            <table className="cheat-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <th className="num">VORP</th>
                  {fixturesAvailable && <th className="num">GW</th>}
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{p.rank}</td>
                    <td>
                      <span className="cheat-name">{p.name}</span>{" "}
                      <span className="cheat-meta">{p.teamShort}</span>
                    </td>
                    <td className="num">{p.vorp}</td>
                    {fixturesAvailable && <td className="num">{averageLabel(p.fixtureAverage)}</td>}
                    <td className="cheat-flag">{flagFor(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <div className="cheat-notes">
          <h3>Fitness and availability notes</h3>
          <ul>
            {flagged.map((p) => (
              <li key={p.id}>
                <span className="cheat-name">{p.name}</span>{" "}
                <span className="cheat-meta">
                  {p.teamShort} {p.position}, ranked {p.rank}
                </span>
                : {p.news}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
