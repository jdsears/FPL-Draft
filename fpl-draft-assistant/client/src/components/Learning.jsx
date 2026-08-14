import React, { useState } from "react";
import { exportLog, importLog } from "../learning.js";

// How the projections have actually turned out. A projection nobody checks is
// an opinion, so this is the part of the app that admits when it is wrong, and
// says what it has changed as a result.

function Row({ row }) {
  const tone = row.error > 2 ? "form-W" : row.error < -2 ? "form-L" : "form-D";
  const missed = Boolean(row.predicted && row.predicted !== row.result);
  return (
    <tr>
      <td className="num">{row.event}</td>
      <td className="num">{row.projected.toFixed(1)}</td>
      <td className="num strong">{row.actual}</td>
      <td className="num">
        <span className={`form-chip ${tone}`}>
          {row.error > 0 ? "+" : ""}
          {row.error.toFixed(1)}
        </span>
      </td>
      <td className="num hide-sm">
        {row.opponentProjected === null ? "n/a" : row.opponentProjected.toFixed(1)}
      </td>
      <td className="num hide-sm">{row.opponentActual}</td>
      <td>
        {/* The mis-call goes in the tooltip: spelled out it is wide enough to
            push the table off a phone screen. */}
        <span
          className={`form-chip form-${row.result} ${missed ? "form-missed" : ""}`.trim()}
          title={missed ? `The projection called this a ${row.predicted}` : undefined}
        >
          {row.result}
          {missed ? "*" : ""}
        </span>
      </td>
    </tr>
  );
}

function Backup({ onRestored }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");

  const copy = async () => {
    const data = exportLog();
    try {
      await navigator.clipboard.writeText(data);
      setMessage("Copied. Paste it somewhere safe, or into the box on your other device.");
    } catch {
      // Clipboard access is blocked in some browsers, so fall back to showing it.
      setText(data);
      setOpen(true);
      setMessage("Could not reach the clipboard, so here it is to copy by hand.");
    }
  };

  const restore = () => {
    const result = importLog(text);
    if (!result.ok) return setMessage(result.error);
    setMessage(
      result.added === 0
        ? "Nothing new in that backup, so nothing changed."
        : `Restored ${result.added} gameweek${result.added === 1 ? "" : "s"}.`
    );
    if (result.added > 0) onRestored();
  };

  return (
    <div className="learn-backup">
      <div className="controls">
        <button className="chip subtle" onClick={copy}>
          Copy backup
        </button>
        <button className="chip subtle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide restore" : "Restore a backup"}
        </button>
      </div>
      {open && (
        <>
          <textarea
            className="learn-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a backup here"
            rows={4}
          />
          <button className="chip" onClick={restore} disabled={!text.trim()}>
            Restore
          </button>
        </>
      )}
      {message && <p className="pmeta">{message}</p>}
    </div>
  );
}

export default function Learning({ learning, error, onRestored }) {
  if (error) {
    return (
      <div className="card">
        <h3>How the projections are doing</h3>
        <div className="banner error">Could not check the projections: {error}</div>
      </div>
    );
  }
  if (!learning) return null;

  const rows = learning.rows || [];
  const positions = ["GKP", "DEF", "MID", "FWD"].filter((pos) => learning.byPosition?.[pos]?.sample > 0);

  return (
    <div className="card">
      <h3>How the projections are doing</h3>
      {(learning.summary || []).map((line) => (
        <p key={line} className="pmeta">
          {line}
        </p>
      ))}

      {rows.some((r) => r.predicted && r.predicted !== r.result) && (
        <p className="pmeta">A star marks a result the projection called the wrong way.</p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="num">GW</th>
                <th className="num" title="What the app projected">Proj</th>
                <th className="num">Scored</th>
                <th className="num">Out by</th>
                <th className="num hide-sm">Them, projected</th>
                <th className="num hide-sm">Them, scored</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.event} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {positions.length > 0 && (
        <div className="week-block">
          <div className="week-block-head">By position</div>
          <ul className="learn-positions">
            {positions.map((pos) => {
              const p = learning.byPosition[pos];
              return (
                <li key={pos}>
                  <span className={`pos pos-${pos}`}>{pos}</span>
                  <span className="pmeta">
                    projected {p.projected.toFixed(1)}, scored {p.actual.toFixed(1)} across {p.sample} starts
                  </span>
                  <span className="week-points">{p.correction.toFixed(2)}</span>
                </li>
              );
            })}
          </ul>
          <p className="pmeta">
            The number on the right is what each position's projection is being multiplied by. It is pulled
            towards the overall figure, because a claim about one position needs more evidence than a claim
            about all of them.
          </p>
        </div>
      )}

      {learning.liveSource === "unavailable" && learning.sample > 0 && (
        <p className="pmeta">
          Per-player results are unavailable, so the breakdown by position is missing and every position gets
          the same overall correction.
        </p>
      )}

      <p className="pmeta">
        This record is kept in this browser, so it does not follow you to another device on its own and a
        cleared browser loses it.
      </p>
      <Backup onRestored={onRestored} />
    </div>
  );
}
