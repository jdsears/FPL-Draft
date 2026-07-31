import React, { memo, useCallback, useMemo, useState } from "react";
import FixtureRun, { averageLabel } from "./FixtureRun.jsx";

const POSITIONS = ["ALL", "GKP", "DEF", "MID", "FWD"];

function weightLabel(weight) {
  return `${Math.round((Number(weight) || 0) * 100)}%`;
}

/** The four component scores, shown only once a row is expanded. */
function Breakdown({ player, run }) {
  const b = player.breakdown || {};
  const w = b.weights || {};
  const rows = [
    { key: "historical", label: "Last season", value: b.historical, weight: w.historical },
    { key: "draftRank", label: "FPL draft rank", value: b.draftRank, weight: w.draftRank },
    { key: "fixtures", label: "Opening fixtures", value: b.fixtures, weight: w.fixtures },
    { key: "availability", label: "Availability", value: b.availability, weight: w.availability },
  ];
  return (
    <div className="breakdown">
      <p className="breakdown-summary">{b.summary || "No ranking explanation available."}</p>
      <ul className="breakdown-list">
        {rows.map((row) => (
          <li key={row.key} className={row.value === null || row.value === undefined ? "muted" : ""}>
            <span className="breakdown-label">{row.label}</span>
            <span className="breakdown-value">
              {row.value === null || row.value === undefined ? "no signal" : row.value}
            </span>
            <span className="breakdown-weight">{weightLabel(row.weight)}</span>
          </li>
        ))}
      </ul>
      <div className="breakdown-fixtures">
        <span className="breakdown-label">
          GW1-6 {b.fixtureAverage !== null && b.fixtureAverage !== undefined
            ? `(average ${averageLabel(b.fixtureAverage)})`
            : ""}
        </span>
        <FixtureRun run={run} labelled />
      </div>
      {player.news && <p className="breakdown-news">{player.news}</p>}
    </div>
  );
}

const PlayerRow = memo(function PlayerRow({
  player,
  draftLabel,
  draftMine,
  expanded,
  run,
  showFixtures,
  columnCount,
  onMark,
  onToggle,
}) {
  const drafted = Boolean(draftLabel);
  const rowClass = drafted ? (draftMine ? "row-mine" : "row-gone") : "";
  const toggle = (event) => {
    event.stopPropagation();
    onToggle(player.id);
  };
  const mark = (event, value) => {
    // Marking a player should not also expand the row.
    event.stopPropagation();
    onMark(player.id, value);
  };
  return (
    <>
      <tr className={`row-tappable ${rowClass} ${expanded ? "row-open" : ""}`.trim()} onClick={toggle}>
        <td className="num rank">{player.rank}</td>
        <td>
          <button
            type="button"
            className="row-expand"
            aria-expanded={expanded}
            onClick={toggle}
            title="Show why this player is ranked here"
          >
            <span className="pname">
              {player.name}
              <span className="row-caret" aria-hidden="true">
                {expanded ? "▾" : "▸"}
              </span>
            </span>
            <span className="pmeta">
              {player.teamShort}
              {player.news ? ` · ${player.news}` : ""}
            </span>
          </button>
        </td>
        <td>
          <span className={`pos pos-${player.position}`}>{player.position}</span>
        </td>
        {showFixtures && (
          <td className="hide-sm">
            <FixtureRun run={run} />
          </td>
        )}
        <td className="num strong">{player.projectedPoints}</td>
        <td className="num">{player.vorp}</td>
        <td className="num hide-sm">{player.lastSeasonPoints}</td>
        <td className="num hide-sm">{player.ppg}</td>
        <td>
          {drafted ? (
            <button className="mark marked" onClick={(e) => mark(e, null)} title="Undo">
              {draftLabel}
            </button>
          ) : (
            <span className="mark-group">
              <button className="mark mine" onClick={(e) => mark(e, "me")} title="I drafted this player">
                Mine
              </button>
              <button className="mark gone" onClick={(e) => mark(e, "gone")} title="Someone else drafted them">
                Gone
              </button>
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="breakdown-row">
          <td colSpan={columnCount}>
            <Breakdown player={player} run={run} />
          </td>
        </tr>
      )}
    </>
  );
});

export default function DraftBoard({ players, draftedBy, onMark, onReset, fixturesByTeam, fixturesAvailable }) {
  const [pos, setPos] = useState("ALL");
  const [query, setQuery] = useState("");
  const [hideDrafted, setHideDrafted] = useState(false);
  const [limit, setLimit] = useState(100);
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (pos !== "ALL" && p.position !== pos) return false;
      if (hideDrafted && draftedBy[p.id]) return false;
      if (q && !(`${p.fullName} ${p.name} ${p.teamName} ${p.teamShort}`.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [players, pos, query, hideDrafted, draftedBy]);

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const toggle = useCallback((id) => setExpanded((current) => (current === id ? null : id)), []);

  return (
    <section>
      <div className="controls">
        <div className="pos-filter">
          {POSITIONS.map((p) => (
            <button key={p} className={`chip ${pos === p ? "active" : ""}`} onClick={() => setPos(p)}>
              {p}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search player or club"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="toggle">
          <input type="checkbox" checked={hideDrafted} onChange={(e) => setHideDrafted(e.target.checked)} />
          Hide drafted
        </label>
        <button className="chip subtle" onClick={onReset} title="Clear manual drafted marks">
          Reset marks
        </button>
      </div>

      <p className="board-hint">
        Tap a player to see why they are ranked there
        {fixturesAvailable ? "" : ". Opening fixtures are unavailable, so ranks use last season and FPL draft rank only"}
      </p>

      <div className="table-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Player</th>
              <th>Pos</th>
              {fixturesAvailable && <th className="hide-sm">GW1-6</th>}
              <th className="num">Proj</th>
              <th className="num">VORP</th>
              <th className="num hide-sm">25/26 pts</th>
              <th className="num hide-sm">PPG</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const d = draftedBy[p.id];
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  draftLabel={d ? d.label : ""}
                  draftMine={Boolean(d && d.mine)}
                  expanded={expanded === p.id}
                  run={fixturesByTeam ? fixturesByTeam[p.fixtureTeam] : null}
                  showFixtures={fixturesAvailable}
                  columnCount={fixturesAvailable ? 9 : 8}
                  onMark={onMark}
                  onToggle={toggle}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button className="chip more" onClick={() => setLimit((l) => l + 100)}>
          Show more ({filtered.length - limit} remaining)
        </button>
      )}
    </section>
  );
}
