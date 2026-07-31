import React, { useMemo, useState } from "react";

const POSITIONS = ["ALL", "GKP", "DEF", "MID", "FWD"];

export default function DraftBoard({ players, draftedBy, onMark, onReset }) {
  const [pos, setPos] = useState("ALL");
  const [query, setQuery] = useState("");
  const [hideDrafted, setHideDrafted] = useState(false);
  const [limit, setLimit] = useState(100);

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

      <div className="table-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Player</th>
              <th>Pos</th>
              <th className="num">Proj</th>
              <th className="num">VORP</th>
              <th className="num hide-sm">24/25 pts</th>
              <th className="num hide-sm">PPG</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((p) => {
              const d = draftedBy[p.id];
              return (
                <tr key={p.id} className={d ? (d.mine ? "row-mine" : "row-gone") : ""}>
                  <td className="num rank">{p.rank}</td>
                  <td>
                    <div className="pname">{p.name}</div>
                    <div className="pmeta">
                      {p.teamShort}
                      {p.news ? ` · ${p.news}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={`pos pos-${p.position}`}>{p.position}</span>
                  </td>
                  <td className="num strong">{p.projectedPoints}</td>
                  <td className="num">{p.vorp}</td>
                  <td className="num hide-sm">{p.lastSeasonPoints}</td>
                  <td className="num hide-sm">{p.ppg}</td>
                  <td>
                    {d ? (
                      <button className="mark marked" onClick={() => onMark(p.id, null)} title="Undo">
                        {d.label}
                      </button>
                    ) : (
                      <span className="mark-group">
                        <button className="mark mine" onClick={() => onMark(p.id, "me")} title="I drafted this player">
                          Mine
                        </button>
                        <button className="mark gone" onClick={() => onMark(p.id, "gone")} title="Someone else drafted them">
                          Gone
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
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
