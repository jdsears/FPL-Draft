import React from "react";

const ORDER = ["GKP", "DEF", "MID", "FWD"];

export default function Roster({ myRoster, limits, onMark }) {
  return (
    <section className="roster">
      {ORDER.map((pos) => {
        const mine = myRoster.filter((p) => p.position === pos);
        const slots = limits[pos];
        return (
          <div key={pos} className="roster-block">
            <div className="best-head">
              <span className={`pos pos-${pos}`}>{pos}</span>
              <span className="best-count">
                {mine.length}/{slots}
              </span>
            </div>
            {mine.map((p) => (
              <div key={p.id} className="best-card">
                <div className="best-main">
                  <div className="pname">{p.name}</div>
                  <div className="pmeta">
                    {p.teamShort} · {p.projectedPoints} pts
                  </div>
                </div>
                <button className="mark gone" onClick={() => onMark(p.id, null)} title="Remove">
                  ×
                </button>
              </div>
            ))}
            {Array.from({ length: Math.max(0, slots - mine.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="best-card empty">
                <div className="pmeta">Open slot</div>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
