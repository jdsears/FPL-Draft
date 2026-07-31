import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBootstrap, fetchLeague, fetchChoices } from "./api.js";
import DraftBoard from "./components/DraftBoard.jsx";
import BestAvailable from "./components/BestAvailable.jsx";
import Roster from "./components/Roster.jsx";
import Chat from "./components/Chat.jsx";
import LeaguePanel from "./components/LeaguePanel.jsx";
import FixturesTab from "./components/FixturesTab.jsx";

const SQUAD_LIMITS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const POLL_MS = 10000;

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function App() {
  const [players, setPlayers] = useState([]);
  const [dataSource, setDataSource] = useState("");
  const [loadError, setLoadError] = useState("");
  const [fixtures, setFixtures] = useState(null);
  const [fixturesSource, setFixturesSource] = useState("");

  const [leagueId, setLeagueId] = useState(() => load("fplda.leagueId", ""));
  const [league, setLeague] = useState(null);
  const [leagueError, setLeagueError] = useState("");
  const [myEntryId, setMyEntryId] = useState(() => load("fplda.myEntryId", null));

  // element id -> { entryId | "me" | "gone" } ; live picks + manual marks
  const [manualMarks, setManualMarks] = useState(() => load("fplda.manualMarks", {}));
  const [livePicks, setLivePicks] = useState({});
  const [tab, setTab] = useState("board");

  useEffect(() => {
    fetchBootstrap()
      .then((d) => {
        setPlayers(d.players || []);
        setDataSource(d.source || "");
        setFixtures(d.fixtures || null);
        setFixturesSource(d.fixturesSource || "");
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  const loadLeague = useCallback((id) => {
    if (!id) return;
    setLeagueError("");
    fetchLeague(id)
      .then(setLeague)
      .catch((e) => {
        setLeague(null);
        setLeagueError(String(e.message || e));
      });
  }, []);

  useEffect(() => {
    if (leagueId) loadLeague(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll live draft picks while a league is connected.
  const pollRef = useRef(null);
  useEffect(() => {
    if (!leagueId || !league) return undefined;
    const poll = () =>
      fetchChoices(leagueId)
        .then((d) => {
          const picks = {};
          for (const c of d.choices || []) {
            if (c.element) picks[c.element] = { entryId: c.entry, pick: c.index, round: c.round };
          }
          setLivePicks(picks);
        })
        .catch(() => {});
    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [leagueId, league]);

  const entries = league?.league_entries || [];
  const entryName = useCallback(
    (entryId) => {
      const e = entries.find((x) => x.entry_id === entryId || x.id === entryId);
      return e ? e.entry_name || `${e.player_first_name} ${e.player_last_name}` : null;
    },
    [entries]
  );

  // Merge live picks with manual marks (manual wins only when no live pick).
  const draftedBy = useMemo(() => {
    const map = {};
    for (const [el, mark] of Object.entries(manualMarks)) map[el] = { label: mark === "me" ? "You" : "Taken", mine: mark === "me" };
    for (const [el, p] of Object.entries(livePicks)) {
      const mine = myEntryId && (p.entryId === myEntryId);
      map[el] = { label: mine ? "You" : entryName(p.entryId) || "Taken", mine };
    }
    return map;
  }, [manualMarks, livePicks, myEntryId, entryName]);

  const markPlayer = useCallback(
    (id, mark) => {
      setManualMarks((prev) => {
        const next = { ...prev };
        if (mark === null) delete next[id];
        else next[id] = mark;
        save("fplda.manualMarks", next);
        return next;
      });
    },
    []
  );

  const resetMarks = useCallback(() => {
    setManualMarks({});
    save("fplda.manualMarks", {});
  }, []);

  // Fixture runs keyed by the main-game short name each player was joined to,
  // so the board and cards can look them up without re-matching names.
  const fixturesByTeam = useMemo(() => {
    const map = {};
    for (const team of fixtures?.teams || []) map[team.shortName] = team.run;
    return map;
  }, [fixtures]);
  const fixturesAvailable = (fixtures?.teams || []).length > 0;

  const available = useMemo(() => players.filter((p) => !draftedBy[p.id]), [players, draftedBy]);
  const myRoster = useMemo(
    () => players.filter((p) => draftedBy[p.id]?.mine),
    [players, draftedBy]
  );

  const chatContext = useMemo(() => {
    const best = ["GKP", "DEF", "MID", "FWD"]
      .map((pos) => {
        const top = available.filter((p) => p.position === pos).slice(0, 5);
        return top
          .map(
            (p) =>
              `${p.name} (${p.teamShort}, ${pos}, ${p.projectedPoints} pts, VORP ${p.vorp}, GW1-6 difficulty ${
                p.fixtureAverage ?? "unknown"
              })`
          )
          .join(", ");
      })
      .map((s, i) => `${["GKP", "DEF", "MID", "FWD"][i]}: ${s || "none left"}`)
      .join("\n");
    const recent = Object.entries(livePicks)
      .sort((a, b) => b[1].pick - a[1].pick)
      .slice(0, 8)
      .map(([el, p]) => {
        const pl = players.find((x) => x.id === Number(el));
        return pl ? `${pl.name} to ${entryName(p.entryId) || "a rival"}` : null;
      })
      .filter(Boolean);
    return {
      myRoster: myRoster.map((p) => `${p.name} (${p.position})`),
      bestAvailable: best,
      recentPicks: recent,
      dataSource,
    };
  }, [available, myRoster, livePicks, players, entryName, dataSource]);

  const onSetLeague = (id) => {
    setLeagueId(id);
    save("fplda.leagueId", id);
    loadLeague(id);
  };
  const onSetEntry = (id) => {
    setMyEntryId(id);
    save("fplda.myEntryId", id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">FPL</span>
          <span className="brand-name">Draft Assistant</span>
        </div>
        {dataSource === "sample" && <span className="pill pill-warn">Demo data</span>}
        {dataSource === "live" && <span className="pill pill-ok">Live FPL data</span>}
      </header>

      <nav className="tabs" role="tablist">
        {[
          ["board", "Draft board"],
          ["best", "Best available"],
          ["fixtures", "Fixtures"],
          ["roster", `My team (${myRoster.length}/15)`],
          ["league", "League"],
          ["chat", "AI assistant"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loadError && <div className="banner error">Could not load player data: {loadError}</div>}

      <main className="content">
        {tab === "board" && (
          <DraftBoard
            players={players}
            draftedBy={draftedBy}
            onMark={markPlayer}
            onReset={resetMarks}
            fixturesByTeam={fixturesByTeam}
            fixturesAvailable={fixturesAvailable}
          />
        )}
        {tab === "best" && (
          <BestAvailable available={available} myRoster={myRoster} limits={SQUAD_LIMITS} onMark={markPlayer} />
        )}
        {tab === "fixtures" && <FixturesTab fixtures={fixtures} fixturesSource={fixturesSource} />}
        {tab === "roster" && <Roster myRoster={myRoster} limits={SQUAD_LIMITS} onMark={markPlayer} />}
        {tab === "league" && (
          <LeaguePanel
            leagueId={leagueId}
            league={league}
            leagueError={leagueError}
            myEntryId={myEntryId}
            onSetLeague={onSetLeague}
            onSetEntry={onSetEntry}
          />
        )}
        {tab === "chat" && <Chat context={chatContext} />}
      </main>
    </div>
  );
}
