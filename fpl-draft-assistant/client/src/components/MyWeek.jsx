import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMyWeek, sendChat } from "../api.js";
import FixtureRun from "./FixtureRun.jsx";
import Pitch from "./Pitch.jsx";
import WeekActions from "./WeekActions.jsx";
import Markdown from "./Markdown.jsx";

// The weekly decision. Captains are disabled in this league, so the only lever
// each gameweek is which eleven of the fifteen start, and the only thing that
// matters is whether that eleven beats the one manager you are drawn against.

const ORDER = ["GKP", "DEF", "MID", "FWD"];
const POSITION_NAMES = { GKP: "Goalkeeper", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
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
  agents,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [scoutSaid, setScoutSaid] = useState("");
  const [scoutError, setScoutError] = useState("");
  const [tip, setTip] = useState("");

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
  // The same plumbing carries anything the user has heard themselves, typed
  // straight into the card, because news that has to be walked to another tab
  // mostly never arrives.
  const askNova = useCallback(
    async (ask) => {
      if (scouting) return;
      setScouting(true);
      setScoutError("");
      setScoutSaid("");
      try {
        const result = await sendChat([{ role: "user", content: ask }], chatContext, { thorough: true });
        setScoutSaid(result.reply || "Nothing new found.");
        if (result.notes?.length) onNotes?.(result.notes);
        else load();
      } catch (e) {
        setScoutError(String(e.message || e));
      } finally {
        setScouting(false);
      }
    },
    [scouting, chatContext, onNotes, load]
  );

  // The sweep names every player on both sides, grouped by club, because one
  // search of a club's press conference round-up covers several players at
  // once, where one search per player would burn the budget on the first few.
  const scout = useCallback(() => {
    const event = data?.nextEvent || nextEvent;
    const mine = [...(data?.lineup?.starters || []), ...(data?.lineup?.bench || [])];
    const theirs = [...(data?.opponent?.starters || []), ...(data?.opponent?.bench || [])];
    const byClub = new Map();
    for (const player of [...mine, ...theirs]) {
      const club = player.teamName || player.teamShort || "unknown";
      if (!byClub.has(club)) byClub.set(club, new Set());
      byClub.get(club).add(player.name);
    }
    const clubs = [...byClub.entries()]
      .map(([club, names]) => `${club}: ${[...names].join(", ")}`)
      .join("; ");
    return askNova(
      `Do a full team news sweep for gameweek ${event}. The players that matter, by club, covering my squad` +
        `${theirs.length ? " and my opponent's" : ""}: ${clubs || "my squad"}. ` +
        "Work club by club, searching each club's latest press conference, injury and predicted line-up news " +
        "rather than one search per player, since a round-up covers several of these at once. Record everything " +
        "factual with record_intel, one note per player, including confirmed starters. Then reply in at most " +
        "four short lines, saying only what changes who I should start."
    );
  }, [askNova, data, nextEvent]);

  const tell = useCallback(
    (event) => {
      event.preventDefault();
      const heard = tip.trim();
      if (!heard) return;
      setTip("");
      return askNova(
        `${heard}\n\nI heard this myself. Record every factual claim in it with record_intel, one note per ` +
          "player, then confirm in one line what changed. If a name is ambiguous, ask me which player."
      );
    },
    [tip, askNova]
  );

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
  const footnotes = [];
  if (data?.source === "sample") footnotes.push("These are demo numbers, because live FPL data is unreachable.");
  if (data && !data.fixturesAvailable) {
    footnotes.push("Fixtures are unavailable, so everyone is projected on a neutral run.");
  }
  if (data?.unknown > 0) {
    footnotes.push(`${data.unknown} marked player${data.unknown === 1 ? " is" : "s are"} not in the current player list, so they are left out.`);
  }
  if (data?.corrections) {
    footnotes.push("Projections are corrected using how past gameweeks turned out; the Season tab shows by how much.");
  }
  if (data?.window === 1) footnotes.push("Numbers are for this gameweek alone, not an average.");

  const expandedPlayer = expanded
    ? [...(lineup?.starters || []), ...(lineup?.bench || [])].find((p) => p.id === expanded)
    : null;

  return (
    <section className="week">
      <div className="card week-hero">
        <div className="hero-top">
          <div>
            <span className="hero-eyebrow">Gameweek {event || "next"}</span>
            <h2 className="hero-title">
              {lineup?.playable
                ? `Start these eleven in ${lineup.label}`
                : loading
                  ? "Working out your best eleven"
                  : "Not enough of your squad is known"}
            </h2>
          </div>
          <button className="chip subtle" onClick={load} disabled={loading}>
            {loading ? "Updating" : "Refresh"}
          </button>
        </div>

        {data?.opponent ? (
          <div className="scoreboard">
            <div className="scoreboard-side">
              <span className="scoreboard-team">{myName || "Your team"}</span>
              <span className={`scoreboard-value ${lineup && lineup.expected >= data.opponent.expected ? "lead" : ""}`.trim()}>
                {lineup ? lineup.expected.toFixed(1) : "0.0"}
              </span>
            </div>
            <span className="scoreboard-sep">projected</span>
            <div className="scoreboard-side scoreboard-them">
              <span className="scoreboard-team">{opponent?.name || "Opponent"}</span>
              <span className={`scoreboard-value ${lineup && data.opponent.expected > lineup.expected ? "lead" : ""}`.trim()}>
                {data.opponent.expected.toFixed(1)}
              </span>
            </div>
          </div>
        ) : (
          lineup?.playable && (
            <div className="scoreboard scoreboard-solo">
              <div className="scoreboard-side">
                <span className="scoreboard-team">Projected this gameweek</span>
                <span className="scoreboard-value">{lineup.expected.toFixed(1)}</span>
              </div>
            </div>
          )
        )}

        <WeekActions week={data} agents={agents} notes={notes} />
      </div>

      {error && <div className="banner error">Could not project this week: {error}</div>}

      {/* Everything that qualifies the numbers, in one place rather than
          scattered between the cards that use them. */}
      {(footnotes.length > 0 || !opponent) && (
        <p className="pmeta week-footnotes">
          {!opponent
            ? leagueConnected
              ? "No head-to-head fixture this gameweek, so this is your eleven on its own. "
              : "Connect your league on the League tab to see who you play. "
            : ""}
          {footnotes.join(" ")}
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
        <form className="tell-nova" onSubmit={tell}>
          <input
            className="search"
            placeholder="Heard something? Type it and Nova writes it down"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            disabled={scouting}
          />
          <button className="chip" type="submit" disabled={scouting || !tip.trim()}>
            Tell Nova
          </button>
        </form>
        {scoutError && <div className="banner error">Could not check the news: {scoutError}</div>}
        {scoutSaid && (
          <div className="week-summary">
            <Markdown text={scoutSaid} />
          </div>
        )}
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
                    <a className="note-source" href={note.sourceUrl} target="_blank" rel="noreferrer noopener">
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

      {lineup?.playable && (
        <div className="card week-lineup">
          <Pitch
            starters={lineup.starters}
            bench={lineup.bench}
            label={lineup.label}
            expanded={expanded}
            onToggle={toggle}
            runFor={runFor}
          >
            {expandedPlayer && (
              <div className="pitch-detail">
                <div className="pitch-detail-head">
                  <span className={`pos pos-${expandedPlayer.position}`}>{expandedPlayer.position}</span>
                  <b>{expandedPlayer.name}</b>
                  <span className="pmeta">{expandedPlayer.teamName || expandedPlayer.teamShort}</span>
                  <FixtureRun run={runFor(expandedPlayer)} labelled />
                </div>
                <p className="pmeta">{expandedPlayer.season?.summary}</p>
                {(expandedPlayer.notes || []).map((note) => (
                  <p key={note.id} className="pmeta pitch-detail-note">
                    {note.label}
                    {note.detail ? `: ${note.detail}` : ""} ({note.source === "search" ? "Nova found this" : "you said this"})
                  </p>
                ))}
              </div>
            )}
          </Pitch>
          <p className="pmeta pitch-hint">
            Tap a player for the reasoning. A dot marks somebody worth checking. On the bench, the reserve
            goalkeeper is locked to the first slot and can only replace your goalkeeper; the outfielders come on
            in the order shown, and only if a starter does not play.
          </p>
        </div>
      )}


      {data?.opponent?.playable && (
        <div className="card week-rival">
          <div className="week-head">
            <div>
              <h3>{opponent?.name || "Opponent"}</h3>
              <p className="pmeta">
                Their likely eleven, {data.opponent.label}, projected {data.opponent.expected.toFixed(1)}
                {opponent?.record ? `. ${opponent.record}` : ""}.{" "}
                {data.opponentSquadSource === "league"
                  ? "Their squad is read live from the league, so waivers and trades are included."
                  : "Their squad is from the draft, because the live ownership feed could not be read."}
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
