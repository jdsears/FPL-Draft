import React from "react";

// The eleven, on a pitch.
//
// A list of eleven names with numbers beside them is readable but it is not
// legible: you cannot see the shape at a glance, and shape is the decision. Laid
// out in lines, a 3-4-3 looks like a 3-4-3, a thin midfield looks thin, and a
// player who should not be there stands out because of where he is standing.

const LINES = ["GKP", "DEF", "MID", "FWD"];

/** The one thing about this player that should stop you, if anything. */
function alarm(player) {
  const status = String(player.status || "a").toLowerCase();
  const note = (player.notes || [])[0];
  const noteKind = note?.kind;
  if (status === "i" || status === "u" || status === "n" || noteKind === "out") {
    return { level: "out", label: "Not available" };
  }
  if (status === "s" || noteKind === "suspended") return { level: "out", label: "Suspended" };
  if (player.season?.fixtures === 0) return { level: "out", label: "No fixture" };
  if (status === "d" || noteKind === "doubt" || noteKind === "benched" || noteKind === "rotation") {
    return { level: "doubt", label: note ? note.label : "Fitness doubt" };
  }
  if ((player.season?.intelFactor ?? 1) > 1) return { level: "good", label: note ? note.label : "Good news" };
  return null;
}

function Shirt({ player, expanded, onToggle }) {
  const season = player.season || {};
  const flag = alarm(player);
  const points = Number(season.perGameweek || 0);
  return (
    <button
      type="button"
      className={`shirt ${expanded ? "shirt-open" : ""} ${flag ? `shirt-${flag.level}` : ""}`.trim()}
      onClick={() => onToggle(player.id)}
      aria-expanded={expanded}
      title={flag ? `${player.name}: ${flag.label}` : player.name}
    >
      <span className={`shirt-badge pos-${player.position}`}>
        {player.teamShort || player.position}
        {flag && <span className={`shirt-dot dot-${flag.level}`} aria-hidden="true" />}
      </span>
      <span className="shirt-name">{player.name}</span>
      <span className="shirt-points">{points.toFixed(1)}</span>
    </button>
  );
}

/**
 * @param {object} props
 *   starters  the eleven, in any order; they are grouped into lines here
 *   expanded  id of the player whose detail is open, if any
 */
export default function Pitch({ starters, label, expanded, onToggle, children }) {
  // Keep the position with its line, so filtering out an empty line does not
  // shift the keys.
  const lines = LINES.map((pos) => [pos, (starters || []).filter((p) => p.position === pos)]).filter(
    ([, line]) => line.length > 0
  );

  return (
    <div className="pitch-wrap">
      <div className="pitch" role="group" aria-label={`Starting eleven, ${label || "no formation"}`}>
        <div className="pitch-markings" aria-hidden="true">
          <span className="pitch-circle" />
          <span className="pitch-box" />
          <span className="pitch-arc" />
        </div>
        {label && <span className="pitch-shape">{label}</span>}
        {lines.map(([pos, line]) => (
          <div key={pos} className="pitch-line">
            {line.map((player) => (
              <Shirt key={player.id} player={player} expanded={expanded === player.id} onToggle={onToggle} />
            ))}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
