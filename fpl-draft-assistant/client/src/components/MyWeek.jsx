import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMyWeek, sendChat } from "../api.js";
import FixtureRun from "./FixtureRun.jsx";

// The weekly decision. Captains are disabled in this league, so the only lever
// each gameweek is which eleven of the fifteen start, and the only thing that
// matters is whether that eleven beats the one manager you are drawn against.

const ORDER = ["GKP", "DEF", "MID", "FWD"];
const POSITION_NAMES = { GKP: "Goalkeeper", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
const OUTFIELD_LABELS = ["First sub", "Second sub", "Third sub"];

/** Name each bench slot. The goalkeeper's slot is locked, the rest are ordered. */
function benchLabels(bench) {
  let outfield = 0;
  return bench.map((player) => {
    if (player.position === "GKP") return { player, note: "Reserve GK" };
    const note = OUTFIELD_LABELS[outfield] || "Sub";
    outfield += 1;
    return { player, note };
  });
}

/** The deadline, and how long is left, in one line. */
export function deadlineLine(deadline) {
  const when = new Date(deadline?.at);
  if (!deadline?.at || Number.isNaN(when.getTime())) return "";
  const stamp = when.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const hours = Number(deadline.hoursAway);
  if (!Number.isFinite(hours)) return `Deadline ${stamp}.`;
  if (hours < 0) return `The deadline passed on ${stamp}, so this eleven is locked in.`;
  if (hours < 1) return `Deadline ${stamp}, under an hour away.`;
  if (hours < 24) return `Deadline ${stamp}, ${Math.round(hours)} hours away.`;
  const days = Math.round(hours / 24);
  return `Deadline ${stamp}, ${days} ${days === 1 ? "day" : "days"} away.`;
}

const WARNING_TITLES = {
  unavailable: "Not available",
  suspended: "Suspended",
  doubt: "Fitness doubt",
  blank: "No fixture",
  short: "Squad incomplete",
};

function PlayerLine({ player, run, note, expanded, onToggle }) {
  const season = player.season || {};
  const flagged = player.status && player.status !== "a";
  return (
    <>
      <button
        type="button"
        className={`week-row ${expanded ? "week-row-open" : ""} ${flagged ? "week-row-flag" : ""}`.trim()}
        aria-expanded={expanded}
        onClick={() => onToggle(player.id)}
      >
        {note && <span className="week-slot">{note}</span>}
        <span className="week-main">
          <span className="pname">
            {player.name}
            <span className="row-caret" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          </span>
          <span className="pmeta">
            <span className={`pos pos-${player.position}`}>{player.position}</span> {player.teamShort}
            {season.fixtures === 0 ? " · blank" : season.fixtures > season.gameweeks ? " · double" : ""}
          </span>
        </span>
        <span className="week-run">
          <FixtureRun run={run} />
        </span>
        <span className="week-points">{Number(season.perGameweek || 0).toFixed(1)}</span>
      </button>
      {expanded && <p className="week-summary">{season.summary || "No projection available."}</p>}
    </>
  );
}

function Scoreline({ lineup, opponent, myName, opponentName }) {
  if (!opponent) return null;
  const mine = lineup?.expected || 0;
  const theirs = opponent.expected || 0;
  const margin = Math.round((mine - theirs) * 10) / 10;
  const verdict =
    Math.abs(margin) < 3
      ? "Too close to call, so every starting choice counts"
      : margin > 0
        ? `Projected to win by about ${Math.abs(margin).toFixed(1)}`
        : `Projected to lose by about ${Math.abs(margin).toFixed(1)}`;
  return (
    <div className="card week-score">
      <div className="week-score-line">
        <span className="week-score-team">{myName}</span>
        <span className="week-score-value">{mine.toFixed(1)}</span>
        <span className="week-score-sep">vs</span>
        <span className="week-score-value">{theirs.toFixed(1)}</span>
        <span className="week-score-team">{opponentName}</span>
      </div>
      <p className="pmeta">{verdict}. Projections are expected points, not a prediction of the result.</p>
    </div>
  );
}

export default function MyWeek({
  elements,
  opponent,
  myName,
  nextEvent,
  leagueConnected,
  leagueId,
  myEntryId,
  corrections,
  onLoaded,
  notes,
  onNotes,
  onForgetNote,
  chatContext,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [scoutSaid, setScoutSaid] = useState("");
  const [scoutError, setScoutError] = useState("");

  // Stable primitive keys so the fetch does not re-run on every render of the
  // parent, which re-derives these arrays each time picks are polled.
  const mineKey = useMemo(() => elements.slice().sort((a, b) => a - b).join(","), [elements]);
  const theirsKey = useMemo(
    () => (opponent?.elements || []).slice().sort((a, b) => a - b).join(","),
    [opponent]
  );

  const load = useCallback(() => {
    // With a league connected the server reads the squads itself, which is the
    // only way to see waiver moves. Marked players are the fallback.
    if (!mineKey && !(leagueId && myEntryId)) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    fetchMyWeek({
      leagueId: leagueId || null,
      myEntryId: myEntryId || null,
      opponentEntryId: opponent?.entryId || null,
      elements: mineKey ? mineKey.split(",").map(Number) : [],
      opponentElements: theirsKey ? theirsKey.split(",").map(Number) : [],
      corrections,
      notes,
    })
      .then((d) => {
        setData(d);
        // The parent records this week's projection, which can only be done
        // before the gameweek is played.
        onLoaded?.(d);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [mineKey, theirsKey, leagueId, myEntryId, opponent, corrections, onLoaded, notes]);

  useEffect(load, [load]);

  const toggle = useCallback((id) => setExpanded((c) => (c === id ? null : id)), []);

  // Checking the team news is Nova's job, not the user's. She searches, records
  // what she finds, and the recorded notes feed straight back into the eleven.
  const scout = useCallback(async () => {
    if (scouting) return;
    setScouting(true);
    setScoutError("");
    setScoutSaid("");
    const event = data?.nextEvent || nextEvent;
    const ask =
      `Check the latest team news for gameweek ${event}, for my eleven and my bench, and for my opponent's ` +
      "likely eleven. Search for injuries, suspensions, illness, expected line-ups and anything a manager has " +
      "said this week. Record everything you find with record_intel so it reaches the projections. Then reply " +
      "in at most three short lines, saying only what changes who I should start.";
    try {
      const result = await sendChat([{ role: "user", content: ask }], chatContext);
      setScoutSaid(result.reply || "Nothing new found.");
      if (result.notes?.length) onNotes?.(result.notes);
      else load();
    } catch (e) {
      setScoutError(String(e.message || e));
    } finally {
      setScouting(false);
    }
  }, [scouting, data, nextEvent, chatContext, onNotes, load]);

  // The runs shown here are the gameweeks ahead, not the opening six the draft
  // board uses, so they come from this response rather than the bootstrap.
  const runs = useMemo(() => {
    const map = {};
    for (const team of data?.fixtures?.teams || []) map[team.shortName] = team.run;
    return map;
  }, [data]);
  const runFor = useCallback((player) => runs[player.fixtureTeam] || null, [runs]);

  if (!elements.length && !(leagueId && myEntryId)) {
    return (
      <section className="week">
        <div className="card">
          <h3>Your squad is not set</h3>
          <p className="pmeta">
            Connect your league so picks sync automatically, or mark your fifteen with Mine on the draft
            board. This tab then picks your best legal eleven each gameweek.
          </p>
        </div>
      </section>
    );
  }

  const lineup = data?.lineup;
  const event = data?.nextEvent || nextEvent;
  const warnings = lineup?.warnings || [];
  const startersByPosition = ORDER.map((pos) => [pos, (lineup?.starters || []).filter((p) => p.position === pos)]);

  return (
    <section className="week">
      <div className="card week-head">
        <div>
          <h3>Gameweek {event || "next"}</h3>
          <p className="pmeta">
            {lineup?.playable
              ? `Best legal eleven, ${lineup.label}, projected ${lineup.expected.toFixed(1)} points`
              : loading
                ? "Working out your best eleven"
                : "Not enough of your squad is known to field a legal eleven"}
          </p>
        </div>
        <button className="chip subtle" onClick={load} disabled={loading}>
          {loading ? "Updating" : "Refresh"}
        </button>
      </div>

      {data?.deadline && <p className="pmeta week-deadline">{deadlineLine(data.deadline)}</p>}
      {data?.corrections && (
        <p className="pmeta">
          These projections have been corrected using how past gameweeks actually turned out. The Season tab
          shows by how much.
        </p>
      )}

      {error && <div className="banner error">Could not project this week: {error}</div>}
      {data?.source === "sample" && (
        <p className="pmeta">These are demo numbers, because live FPL data is unreachable.</p>
      )}
      {data && !data.fixturesAvailable && (
        <p className="pmeta">
          Fixtures are unavailable, so every player is projected on a neutral run rather than who they face.
        </p>
      )}
      {data?.unknown > 0 && (
        <p className="pmeta">
          {data.unknown} of your marked players are not in the current player list, so they are left out.
        </p>
      )}

      <Scoreline
        lineup={lineup}
        opponent={data?.opponent}
        myName={myName || "Your team"}
        opponentName={opponent?.name || "Opponent"}
      />

      {!opponent && (
        <p className="pmeta">
          {leagueConnected
            ? "No head-to-head fixture found for this gameweek, so this is your eleven on its own."
            : "Connect your league on the League tab to see who you play and how your eleven compares."}
        </p>
      )}

      <div className="card week-news">
        <div className="week-head">
          <div>
            <h3>Team news</h3>
            <p className="pmeta">
              {notes?.length
                ? `${notes.length} note${notes.length === 1 ? "" : "s"} on file, already in the numbers below.`
                : "Nothing on file. Nova can go and look, or tell her anything you have heard."}
            </p>
          </div>
          <button className="chip active" onClick={scout} disabled={scouting}>
            {scouting ? "Checking" : "Check the news"}
          </button>
        </div>
        {scoutError && <div className="banner error">Could not check the news: {scoutError}</div>}
        {scoutSaid && <p className="week-summary">{scoutSaid}</p>}
        {notes?.map((note) => (
          <div key={note.id} className={`week-row sos-row ${note.kind === "out" || note.kind === "suspended" ? "sos-hard" : ""}`.trim()}>
            <span className="week-main">
              <span className="pname">
                <span className={`pos pos-${note.position}`}>{note.position}</span> {note.playerName}
                <span className="pmeta"> {note.teamShort}</span>
              </span>
              <span className="pmeta">
                {note.label}
                {note.detail ? `: ${note.detail}` : ""} · {note.confidence} confidence ·{" "}
                {note.source === "search" ? "Nova found this" : "you said this"}
                {note.sourceUrl ? (
                  <>
                    {" "}
                    <a href={note.sourceUrl} target="_blank" rel="noreferrer noopener">
                      source
                    </a>
                  </>
                ) : null}
                {" "}· until gameweek {note.expiresAfterEvent}
              </span>
            </span>
            <button className="mark gone" onClick={() => onForgetNote?.(note.id)} title="Forget this note">
              ×
            </button>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="card week-warnings">
          <h3>Check before you confirm</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${w.id || i}`}>
                <span className={`week-tag week-tag-${w.kind}`}>{WARNING_TITLES[w.kind] || w.kind}</span>
                {w.name ? <b>{w.name}</b> : null} {w.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lineup?.playable && (
        <div className="card week-lineup">
          <h3>Start these eleven</h3>
          {startersByPosition.map(([pos, group]) =>
            group.length ? (
              <div key={pos} className="week-block">
                <div className="week-block-head">
                  {POSITION_NAMES[pos]} <span className="pmeta">{group.length}</span>
                </div>
                {group.map((p) => (
                  <PlayerLine
                    key={p.id}
                    player={p}
                    run={runFor(p)}
                    expanded={expanded === p.id}
                    onToggle={toggle}
                  />
                ))}
              </div>
            ) : null
          )}
        </div>
      )}

      {lineup && lineup.bench.length > 0 && (
        <div className="card week-bench">
          <h3>Bench</h3>
          <p className="pmeta">
            Order matters only when a starter does not play. The reserve goalkeeper is locked to the first
            bench slot and can only replace your goalkeeper.
          </p>
          {benchLabels(lineup.bench).map(({ player, note }) => (
            <PlayerLine
              key={player.id}
              player={player}
              run={runFor(player)}
              note={note}
              expanded={expanded === player.id}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {data?.opponent?.playable && (
        <div className="card week-rival">
          <div className="week-head">
            <div>
              <h3>{opponent?.name || "Opponent"}</h3>
              <p className="pmeta">
                Their likely eleven, {data.opponent.label}, projected {data.opponent.expected.toFixed(1)}
                {opponent?.record ? `. ${opponent.record}` : ""}. Their squad is taken from the draft, so any
                waiver moves since are not reflected.
              </p>
            </div>
            <button className="chip subtle" onClick={() => setShowOpponent((v) => !v)} aria-expanded={showOpponent}>
              {showOpponent ? "Hide" : "Show"}
            </button>
          </div>
          {showOpponent &&
            ORDER.map((pos) => {
              const group = data.opponent.starters.filter((p) => p.position === pos);
              return group.length ? (
                <div key={pos} className="week-block">
                  <div className="week-block-head">{POSITION_NAMES[pos]}</div>
                  {group.map((p) => (
                    <PlayerLine
                      key={p.id}
                      player={p}
                      run={runFor(p)}
                      expanded={expanded === p.id}
                      onToggle={toggle}
                    />
                  ))}
                </div>
              ) : null;
            })}
        </div>
      )}
    </section>
  );
}
