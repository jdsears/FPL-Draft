import React from "react";
import { clubKit } from "../clubs.js";

// The eleven, laid out the way the official site lays it out: a shirt, the name
// under it, the fixture under that, and the bench along the bottom of the grass.
// Copying that format is deliberate. It is the arrangement the user already
// reads every week, so the app's answer can be compared with the real team sheet
// without translating between two different pictures.
//
// What the official site does not have is a reason. So each shirt also carries
// the projected points, and a dot when there is something to check, and tapping
// one opens the explanation.

const LINES = ["GKP", "DEF", "MID", "FWD"];
const BENCH_LABELS = ["GK", "1", "2", "3"];

/** A generic jersey in the club's colours. No club artwork, just colours. */
function Kit({ shortName, keeper }) {
  const kit = clubKit(shortName);
  // A goalkeeper is in something different from the outfield, as they are in
  // life, so the eye can find them.
  const body = keeper ? "#2f2b3a" : kit.body;
  const trim = keeper ? "#c9f7dd" : kit.trim;
  const clip = `kit-${String(shortName || "none").toLowerCase()}${keeper ? "-gk" : ""}`;
  return (
    <svg className="kit" viewBox="0 0 40 34" width="40" height="34" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d="M10.5 3.6 Q14.5 8 20 8 Q25.5 8 29.5 3.6 L34.4 6.8 L31.4 31 Q20 33.2 8.6 31 L5.6 6.8 Z" />
        </clipPath>
      </defs>
      <path d="M10.5 3.4 L5.4 6.6 L0.9 12.6 L4.9 18.4 L9.6 14.2 Z" fill={trim} />
      <path d="M29.5 3.4 L34.6 6.6 L39.1 12.6 L35.1 18.4 L30.4 14.2 Z" fill={trim} />
      <path
        d="M10.5 3.6 Q14.5 8 20 8 Q25.5 8 29.5 3.6 L34.4 6.8 L31.4 31 Q20 33.2 8.6 31 L5.6 6.8 Z"
        fill={body}
      />
      {!keeper && kit.pattern === "stripes" && (
        <g clipPath={`url(#${clip})`}>
          {[8.5, 17.5, 26.5].map((x) => (
            <rect key={x} x={x} y="0" width="5" height="34" fill={kit.second || kit.trim} />
          ))}
        </g>
      )}
      {!keeper && kit.pattern === "halves" && (
        <g clipPath={`url(#${clip})`}>
          <rect x="20" y="0" width="20" height="34" fill={kit.second || kit.trim} />
        </g>
      )}
      <path d="M15.6 3.9 Q20 8.6 24.4 3.9 L22.3 2.7 Q20 5.4 17.7 2.7 Z" fill={trim} />
    </svg>
  );
}

/** This week's opponents, as the official site writes them: BRE (A). */
function fixtureLabel(run) {
  const fixtures = (run || []).flatMap((week) => week.fixtures || []);
  if (!fixtures.length) return { text: "No fixture", difficulty: null, blank: true };
  return {
    text: fixtures.map((f) => `${f.opponent} (${f.home ? "H" : "A"})`).join(" · "),
    // With two fixtures the harder one is the honest headline.
    difficulty: Math.max(...fixtures.map((f) => Number(f.difficulty) || 3)),
    double: fixtures.length > 1,
  };
}

/** The one thing about this player that should stop you, if anything. */
function alarm(player) {
  const status = String(player.status || "a").toLowerCase();
  const kind = (player.notes || [])[0]?.kind;
  if (["i", "u", "n"].includes(status) || kind === "out") return "out";
  if (status === "s" || kind === "suspended") return "out";
  if (player.season?.fixtures === 0) return "out";
  if (status === "d" || ["doubt", "benched", "rotation"].includes(kind)) return "doubt";
  if (player.season?.intelShift === "up") return "good";
  return null;
}

function PlayerCard({ player, run, slot, expanded, onToggle }) {
  const fixture = fixtureLabel(run);
  const flag = alarm(player);
  const points = Number(player.season?.perGameweek || 0);
  return (
    <button
      type="button"
      className={`player ${expanded ? "player-open" : ""}`.trim()}
      onClick={() => onToggle(player.id)}
      aria-expanded={expanded}
    >
      {slot && <span className="player-slot">{slot}</span>}
      <span className="player-kit">
        <Kit shortName={player.teamShort} keeper={player.position === "GKP"} />
        {flag && <span className={`player-dot dot-${flag}`} aria-hidden="true" />}
        {/* Worn like a squad number, at the hem. Above the shirt it collided
            with the line in front; inside the name pill it ate the name. */}
        <span className="player-points">{points.toFixed(1)}</span>
      </span>
      <span className="player-name">{player.name}</span>
      <span
        className={`player-fixture ${fixture.blank ? "fixture-blank" : `fdr-${fixture.difficulty}`} ${
          fixture.double ? "fixture-double" : ""
        }`.trim()}
      >
        {fixture.text}
      </span>
    </button>
  );
}

/**
 * @param {object} props
 *   starters  the eleven, grouped into lines here
 *   bench     the four substitutes, in the order they would come on
 *   runFor    (player) => the fixture run for that player's club
 */
export default function Pitch({ starters, bench, label, expanded, onToggle, runFor, children }) {
  const lines = LINES.map((pos) => [pos, (starters || []).filter((p) => p.position === pos)]).filter(
    ([, line]) => line.length > 0
  );
  const substitutes = bench || [];

  return (
    <div className="pitch-wrap">
      <div className="pitch" role="group" aria-label={`Starting eleven, ${label || "no formation"}`}>
        <div className="pitch-markings" aria-hidden="true">
          <span className="pitch-box" />
          <span className="pitch-six" />
          <span className="pitch-spot" />
          <span className="pitch-arc" />
          <span className="pitch-halfway" />
          <span className="pitch-circle" />
        </div>
        {label && <span className="pitch-shape">{label}</span>}

        <div className="pitch-eleven">
          {lines.map(([pos, line]) => (
            <div key={pos} className="pitch-line">
              {line.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  run={runFor?.(player)}
                  expanded={expanded === player.id}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ))}
        </div>

        {substitutes.length > 0 && (
          <div className="pitch-bench">
            {substitutes.map((player, i) => (
              <PlayerCard
                key={player.id}
                player={player}
                run={runFor?.(player)}
                slot={player.position === "GKP" ? BENCH_LABELS[0] : BENCH_LABELS[Math.max(1, i)] || "4"}
                expanded={expanded === player.id}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
