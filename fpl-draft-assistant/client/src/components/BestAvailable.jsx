import React from "react";

const ORDER = ["MID", "FWD", "DEF", "GKP"];

export default function BestAvailable({ available, myRoster, limits, onMark }) {
  const counts = Object.fromEntries(ORDER.map((p) => [p, myRoster.filter((r) => r.position === p).length]));

  return (
    <section className="best-grid">
      {ORDER.map((pos) => {
        const top = available.filter((p) => p.position === pos).slice(0, 6);
        const full = counts[pos] >= limits[pos];
        return (
          <div key={pos} className={`best-col ${full ? "col-full" : ""}`}>
            <div className="best-head">
              <span className={`pos pos-${pos}`}>{pos}</span>
              <span className="best-count">
                {counts[pos]}/{limits[pos]} filled {full ? "· full" : ""}
              </span>
            </div>
            {top.map((p, i) => (
              <div key={p.id} className={`best-card ${i === 0 ? "top-pick" : ""}`}>
                <div className="best-rank">#{p.rank}</div>
                <div className="best-main">
                  <div className="pname">{p.name}</div>
                  <div className="pmeta">
                    {p.teamShort} · {p.projectedPoints} pts · VORP {p.vorp}
                  </div>
                </div>
                <button className="mark mine" onClick={() => onMark(p.id, "me")} title="Draft to my team">
                  +
                </button>
              </div>
            ))}
            {top.length === 0 && <div className="pmeta pad">No one left</div>}
          </div>
        );
      })}
    </section>
  );
}
