import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFreeAgents } from "../api.js";
import FixtureRun from "./FixtureRun.jsx";

// There is no transfer market in a draft league, only the players nobody owns.
// The useful question is never "who is good" but "is the best unowned player in
// this position better than the worst one I hold", because a squad has to stay
// at 2 GKP, 5 DEF, 5 MID and 3 FWD, so every claim is a same-position swap.

const ORDER = ["GKP", "DEF", "MID", "FWD"];
const POSITION_NAMES = { GKP: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };

function AgentRow({ player, run, expanded, onToggle }) {
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

export default function FreeAgents({ leagueId, myElements, ownedElements }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [pos, setPos] = useState("ALL");

  const mineKey = useMemo(() => myElements.slice().sort((a, b) => a - b).join(","), [myElements]);
  const ownedKey = useMemo(() => ownedElements.slice().sort((a, b) => a - b).join(","), [ownedElements]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetchFreeAgents({
      leagueId: leagueId || null,
      elements: mineKey ? mineKey.split(",").map(Number) : [],
      ownedElements: ownedKey ? ownedKey.split(",").map(Number) : [],
    })
      .then(setData)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [leagueId, mineKey, ownedKey]);

  useEffect(load, [load]);

  const toggle = useCallback((id) => setExpanded((c) => (c === id ? null : id)), []);
  const runs = useMemo(() => {
    const map = {};
    for (const team of data?.fixtures?.teams || []) map[team.shortName] = team.run;
    return map;
  }, [data]);
  const runFor = useCallback((player) => runs[player.fixtureTeam] || null, [runs]);

  const shown = pos === "ALL" ? ORDER : [pos];

  return (
    <section className="week">
      <div className="card week-head">
        <div>
          <h3>Free agents</h3>
          <p className="pmeta">
            {loading
              ? "Checking who is unowned"
              : data
                ? `${data.availableCount} players are unowned, ranked on expected points a gameweek over the next ${data.window}`
                : "Ranking the players nobody owns"}
          </p>
        </div>
        <button className="chip subtle" onClick={load} disabled={loading}>
          {loading ? "Updating" : "Refresh"}
        </button>
      </div>

      {error && <div className="banner error">Could not load free agents: {error}</div>}
      {data?.ownershipSource === "picks" && (
        <p className="pmeta">
          {leagueId
            ? "Ownership is taken from the draft rather than the live league feed, so any waiver moves since are not reflected."
            : "Connect your league on the League tab for live ownership. For now this uses the players marked as taken."}
          {data.ownershipError ? ` (${data.ownershipError})` : ""}
        </p>
      )}
      {data?.pendingClaims > 0 && (
        <p className="pmeta">
          {data.pendingClaims} unowned player{data.pendingClaims === 1 ? " is" : "s are"} under a pending claim, so
          they are not listed as available.
        </p>
      )}

      {data && !data.squadKnown && (
        <p className="pmeta">
          Your own squad is not known yet, so this ranks the free agents without suggesting swaps. Mark your
          fifteen on the draft board or connect your league.
        </p>
      )}

      {data?.upgrades?.length > 0 && (
        <div className="card week-warnings">
          <h3>Worth a claim</h3>
          <ul>
            {data.upgrades.map((u) => (
              <li key={u.position}>
                <span className="week-tag week-tag-gain">
                  {u.position} +{u.gain.toFixed(1)}
                </span>
                {u.summary}
              </li>
            ))}
          </ul>
          <p className="pmeta">
            A gain here is per gameweek, over the next {data.window}. Claims are same-position swaps because the
            squad has to stay at 2 GKP, 5 DEF, 5 MID and 3 FWD.
          </p>
        </div>
      )}
      {data?.squadKnown && data.upgrades.length === 0 && (
        <p className="pmeta">
          Nothing unowned improves on your squad by enough to be worth a claim, so hold your waiver priority.
        </p>
      )}

      <div className="controls">
        <div className="pos-filter">
          {["ALL", ...ORDER].map((p) => (
            <button key={p} className={`chip ${pos === p ? "active" : ""}`} onClick={() => setPos(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {shown.map((position) => {
        const list = data?.freeAgents?.[position] || [];
        return (
          <div key={position} className="card">
            <h3>{POSITION_NAMES[position]}</h3>
            {list.length === 0 ? (
              <p className="pmeta">Nobody unowned in this position.</p>
            ) : (
              list.map((p) => (
                <AgentRow
                  key={p.id}
                  player={p}
                  run={runFor(p)}
                  expanded={expanded === p.id}
                  onToggle={toggle}
                />
              ))
            )}
          </div>
        );
      })}
    </section>
  );
}
