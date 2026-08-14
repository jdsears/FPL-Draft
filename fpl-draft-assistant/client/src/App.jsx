import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBootstrap, fetchLeague, fetchChoices, fetchLearning, syncState } from "./api.js";
import { scopeFor, readLog, readLogMap, replaceLogMap, recordProjection } from "./learning.js";
import { readNotes, readDeleted, addNotes, removeNote, pruneExpired, replaceState } from "./notes.js";
import DraftBoard from "./components/DraftBoard.jsx";
import BestAvailable from "./components/BestAvailable.jsx";
import Roster from "./components/Roster.jsx";
import Chat from "./components/Chat.jsx";
import LeaguePanel from "./components/LeaguePanel.jsx";
import FixturesTab from "./components/FixturesTab.jsx";
import CheatSheet from "./components/CheatSheet.jsx";
import SyncStatus from "./components/SyncStatus.jsx";
import MyWeek from "./components/MyWeek.jsx";
import FreeAgents from "./components/FreeAgents.jsx";
import SeasonView from "./components/SeasonView.jsx";
import Trades from "./components/Trades.jsx";
import Learning from "./components/Learning.jsx";

const SQUAD_LIMITS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const POLL_MS = 10000;

/**
 * Which tabs to show. Best available and the cheat sheet exist to get you
 * through a draft evening, so once the draft is done they are clutter, and the
 * board becomes a player reference rather than something you pick from. Eleven
 * tabs is too many to scan on a phone.
 */
function tabsFor(seasonMode, rosterSize) {
  const season = [
    ["week", "My week"],
    ["season", "Season"],
    ["agents", "Free agents"],
    ["trades", "Trades"],
    ["chat", "Nova"],
    ["roster", `Squad ${rosterSize}/15`],
    ["fixtures", "Fixtures"],
    ["board", "Players"],
    ["league", "League"],
  ];
  const draft = [
    ["board", "Draft board"],
    ["best", "Best available"],
    ["chat", "Nova"],
    ["fixtures", "Fixtures"],
    ["roster", `Squad ${rosterSize}/15`],
    ["league", "League"],
    ["cheat", "Cheat sheet"],
    ["week", "My week"],
  ];
  return seasonMode ? season : draft;
}

/** A deadline as something readable, with how long is left. */
function deadlineInWords(deadline) {
  if (!deadline?.at) return null;
  const when = new Date(deadline.at);
  if (Number.isNaN(when.getTime())) return null;
  const stamp = when.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const hours = Number(deadline.hoursAway);
  if (!Number.isFinite(hours)) return stamp;
  if (hours < 0) return `${stamp}, which has passed`;
  if (hours < 1) return `${stamp}, in under an hour`;
  if (hours < 24) return `${stamp}, in ${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return `${stamp}, in ${days} ${days === 1 ? "day" : "days"}`;
}

function ordinal(n) {
  const value = Number(n) || 0;
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] || "th"}`;
}

// A link can carry the league setup, because localStorage does not follow the
// user between devices: a phone that has never been told the league would
// otherwise sit in draft mode looking out of date.
function setupFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return { league: params.get("league") || "", entry: Number(params.get("entry")) || null };
  } catch {
    return { league: "", entry: null };
  }
}
const FROM_URL = setupFromUrl();

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
  const [historyAvailable, setHistoryAvailable] = useState(true);
  const [departedExcluded, setDepartedExcluded] = useState(0);
  const [currentEvent, setCurrentEvent] = useState(0);

  const [leagueId, setLeagueId] = useState(() => FROM_URL.league || load("fplda.leagueId", ""));
  const [league, setLeague] = useState(null);
  const [leagueError, setLeagueError] = useState("");
  const [myEntryId, setMyEntryId] = useState(() => FROM_URL.entry || load("fplda.myEntryId", null));

  // element id -> { entryId | "me" | "gone" } ; live picks + manual marks
  const [manualMarks, setManualMarks] = useState(() => load("fplda.manualMarks", {}));
  const [livePicks, setLivePicks] = useState({});
  // Null until the user picks one, so the landing tab can follow whether the
  // draft is still to come.
  const [chosenTab, setTab] = useState(null);

  // What past gameweeks say about the projections, and what the weekly views
  // concluded, so Nova can reason from the app's own answers.
  const [learning, setLearning] = useState(null);
  const [learningError, setLearningError] = useState("");
  const [logVersion, setLogVersion] = useState(0);
  const [week, setWeek] = useState(null);
  const [agents, setAgents] = useState(null);
  // Team news Nova has recorded, which adjusts projections until it expires.
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    fetchBootstrap()
      .then((d) => {
        setPlayers(d.players || []);
        setDataSource(d.source || "");
        setFixtures(d.fixtures || null);
        setFixturesSource(d.fixturesSource || "");
        setHistoryAvailable(d.historyAvailable !== false);
        setDepartedExcluded(Number(d.departedExcluded) || 0);
        setCurrentEvent(Number(d.currentEvent) || 0);
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
    // A setup link is remembered and then tidied off the address bar, so the
    // next visit works without it and the URL can be bookmarked clean.
    if (FROM_URL.league) {
      save("fplda.leagueId", FROM_URL.league);
      if (FROM_URL.entry) save("fplda.myEntryId", FROM_URL.entry);
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll live draft picks while a league is connected, and record whether the
  // poll is actually succeeding so the interface can say so.
  const pollRef = useRef(null);
  const pollNowRef = useRef(null);
  const [sync, setSync] = useState({ at: null, error: "", picks: 0 });

  useEffect(() => {
    if (!leagueId || !league) {
      pollNowRef.current = null;
      return undefined;
    }
    const poll = () =>
      fetchChoices(leagueId)
        .then((d) => {
          const picks = {};
          for (const c of d.choices || []) {
            if (c.element) picks[c.element] = { entryId: c.entry, pick: c.index, round: c.round };
          }
          setLivePicks(picks);
          setSync({ at: Date.now(), error: "", picks: Object.keys(picks).length });
        })
        .catch((e) => setSync((s) => ({ ...s, error: String(e.message || e) })));
    pollNowRef.current = poll;
    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(pollRef.current);
      pollNowRef.current = null;
    };
  }, [leagueId, league]);

  const syncNow = useCallback(() => pollNowRef.current?.(), []);

  // Held in a ref so recording a projection does not re-run every time the
  // opponent object is rebuilt by a pick poll.
  const opponentRef = useRef(null);

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
  const myElements = useMemo(() => myRoster.map((p) => p.id), [myRoster]);
  // Everything anyone has taken, which is the fallback when the league's own
  // ownership feed cannot be read.
  const ownedElements = useMemo(
    () => Object.keys(draftedBy).map(Number).filter(Number.isFinite),
    [draftedBy]
  );

  // ---- Head to head ----
  const nextEvent = currentEvent + 1;
  // The draft can be finished well before gameweek 1, and once it is, the app
  // is a season tool rather than a draft tool. The league says so itself, so do
  // not wait for a gameweek to be played before switching the framing.
  const seasonMode = currentEvent > 0 || league?.league?.draft_status === "post";
  const myLeagueEntry = useMemo(
    () => entries.find((e) => e.entry_id === myEntryId || e.id === myEntryId) || null,
    [entries, myEntryId]
  );
  const squadsByEntry = useMemo(() => {
    const map = {};
    for (const [element, pick] of Object.entries(livePicks)) {
      if (!pick.entryId) continue;
      if (!map[pick.entryId]) map[pick.entryId] = [];
      map[pick.entryId].push(Number(element));
    }
    return map;
  }, [livePicks]);

  const opponent = useMemo(() => {
    if (!league || !myLeagueEntry) return null;
    const mine = myLeagueEntry.id;
    const match = (league.matches || []).find(
      (m) => m.event === nextEvent && (m.league_entry_1 === mine || m.league_entry_2 === mine)
    );
    if (!match) return null;
    const otherId = match.league_entry_1 === mine ? match.league_entry_2 : match.league_entry_1;
    const entry = entries.find((e) => e.id === otherId);
    if (!entry) return null;
    const standing = (league.standings || []).find((s) => s.league_entry === otherId);
    return {
      name: entry.entry_name || `${entry.player_first_name} ${entry.player_last_name}`.trim(),
      // The ownership feed keys squads by entry_id, so the server needs that
      // rather than the league_entry id the matches feed gave us.
      entryId: entry.entry_id,
      elements: squadsByEntry[entry.entry_id] || [],
      // Before a gameweek is scored the feed carries null ranks and zero
      // totals, which read as "Ranked 0th on 0 points". Say nothing instead.
      record:
        standing && Number(standing.rank) > 0
          ? `Ranked ${ordinal(standing.rank)} on ${standing.total} league points with ${standing.points_for} scored`
          : "",
    };
  }, [league, myLeagueEntry, entries, nextEvent, squadsByEntry]);

  opponentRef.current = opponent?.name || null;

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
    // Prefer the live squad the server read from the league, which includes
    // waivers and trades; the draft picks are only the fallback.
    const liveOpponent = week?.opponent ? [...week.opponent.starters, ...week.opponent.bench] : null;
    const opponentSquad = liveOpponent
      ? liveOpponent.map((p) => `${p.name} (${p.position})`)
      : (opponent?.elements || [])
          .map((id) => players.find((p) => p.id === id))
          .filter(Boolean)
          .map((p) => `${p.name} (${p.position})`);
    return {
      myRoster: myRoster.map((p) => `${p.name} (${p.position})`),
      bestAvailable: best,
      recentPicks: recent,
      dataSource,
      // Once the draft is done the questions change, so tell Nova where we are.
      gameweek: seasonMode ? nextEvent : null,
      opponent: opponent?.name || null,
      opponentSquad,
      // The app's own conclusions, so she reasons from them rather than
      // rederiving them from a player list.
      lineup: week?.lineup?.playable
        ? week.lineup.starters
            .map((p) => `${p.name} (${p.position}, ${Number(p.season?.perGameweek || 0).toFixed(1)})`)
            .join(", ")
        : null,
      bench: week?.lineup?.bench?.length
        ? week.lineup.bench.map((p) => `${p.name} (${p.position})`).join(", ")
        : null,
      projection: week?.lineup?.playable
        ? `your eleven ${week.lineup.expected.toFixed(1)} in ${week.lineup.label}` +
          (week.opponent ? `, theirs ${week.opponent.expected.toFixed(1)}` : "")
        : null,
      warnings: (week?.lineup?.warnings || []).map((w) => `${w.name || "squad"}: ${w.detail}`),
      claims: (agents?.upgrades || []).map((u) => u.summary),
      deadline: week?.deadline ? deadlineInWords(week.deadline) : null,
      learning: learning?.summary || [],
      // So she neither repeats a note nor contradicts one silently.
      notes,
    };
  }, [
    available,
    myRoster,
    livePicks,
    players,
    entryName,
    dataSource,
    seasonMode,
    nextEvent,
    opponent,
    week,
    agents,
    learning,
    notes,
  ]);

  // The draft is one evening; the season is every week, so once the draft is
  // done the week leads. A tab that disappears with the draft falls back rather
  // than leaving a blank page.
  const tabs = tabsFor(seasonMode, myRoster.length);
  const tab = chosenTab && tabs.some(([key]) => key === chosenTab) ? chosenTab : tabs[0][0];

  // ---- Learning ----
  const logScope = scopeFor(leagueId, myEntryId);
  const corrections = learning?.corrections || null;

  const loadLearning = useCallback(() => {
    if (!leagueId || !myEntryId) {
      setLearning(null);
      return;
    }
    setLearningError("");
    fetchLearning({ leagueId, myEntryId, log: readLog(scopeFor(leagueId, myEntryId)) })
      .then(setLearning)
      .catch((e) => setLearningError(String(e.message || e)));
  }, [leagueId, myEntryId]);

  useEffect(loadLearning, [loadLearning, logVersion]);

  // The projection for a gameweek has to be written down before it is played,
  // because afterwards the inputs have moved on and it cannot be recovered.
  // ---- Cross-device sync ----
  // Notes and the projection log live in this browser, which made a phone and a
  // laptop drift. Every mutation and every return to the tab pushes this
  // device's copy to the server and stores the union it hands back, so the
  // devices meet in the middle within one round trip.
  const syncBusy = useRef(false);
  const requestSync = useCallback(() => {
    if (!leagueId || !myEntryId || syncBusy.current) return;
    syncBusy.current = true;
    const scope = scopeFor(leagueId, myEntryId);
    const pushedNotes = readNotes(scope);
    const pushedDeleted = readDeleted(scope);
    const pushedLog = readLogMap(scope);
    syncState({ leagueId, myEntryId, notes: pushedNotes, deleted: pushedDeleted, log: pushedLog })
      .then((merged) => {
        // Adopt the union only when it differs from what was pushed, or every
        // round trip would dirty state and trigger the next one.
        const ids = (list) => (list || []).map((n) => n.id).sort().join(",");
        if (ids(merged.notes) !== ids(pushedNotes) || ids(merged.deleted) !== ids(pushedDeleted)) {
          setNotes(replaceState(scope, merged.notes, merged.deleted));
        }
        if (JSON.stringify(merged.log) !== JSON.stringify(pushedLog)) {
          replaceLogMap(scope, merged.log);
          setLogVersion((v) => v + 1);
        }
      })
      .catch(() => {})
      .finally(() => {
        syncBusy.current = false;
      });
  }, [leagueId, myEntryId]);

  useEffect(() => {
    requestSync();
    const onVisible = () => {
      if (document.visibilityState === "visible") requestSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [requestSync]);


  const onWeek = useCallback(
    (data) => {
      setWeek(data);
      if (!data?.lineup?.playable || !data.nextEvent) return;
      const changed = recordProjection(logScope, {
        event: data.nextEvent,
        projected: data.lineup.expected,
        opponentProjected: data.opponent ? data.opponent.expected : null,
        opponentName: opponentRef.current,
        players: data.lineup.starters.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          projected: p.season?.perGameweek,
        })),
      });
      if (changed) requestSync();
    },
    [logScope, requestSync]
  );

  const onRestored = useCallback(() => setLogVersion((v) => v + 1), []);

  // ---- Team news notes ----
  // Read once the gameweek is known, so anything that has expired is swept away
  // rather than sitting there quietly suppressing a player.
  useEffect(() => {
    const live = pruneExpired(logScope, nextEvent);
    // Hand back the same array when nothing changed, so the views that depend on
    // it do not refetch for no reason.
    setNotes((prev) =>
      prev.length === live.length && prev.every((note, i) => note.id === live[i].id) ? prev : live
    );
  }, [logScope, nextEvent, currentEvent]);

  const onNotes = useCallback(
    (incoming) => {
      if (!incoming?.length) return;
      setNotes(addNotes(logScope, incoming));
      requestSync();
    },
    [logScope, requestSync]
  );

  const onForgetNote = useCallback(
    (id) => {
      setNotes(removeNote(logScope, id));
      requestSync();
    },
    [logScope, requestSync]
  );

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

      <div className="tab-strip">
      <nav className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
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
      </div>

      {leagueId && league && (
        <SyncStatus
          syncedAt={sync.at}
          error={sync.error}
          picks={sync.picks}
          onSyncNow={syncNow}
          inSeason={seasonMode}
        />
      )}

      {loadError && <div className="banner error">Could not load player data: {loadError}</div>}

      <main className="content">
        {tab === "week" && (
          <MyWeek
            elements={myElements}
            opponent={opponent}
            myName={myLeagueEntry?.entry_name || "Your team"}
            nextEvent={nextEvent}
            leagueConnected={Boolean(league)}
            leagueId={leagueId}
            myEntryId={myEntryId}
            corrections={corrections}
            onLoaded={onWeek}
            notes={notes}
            onForgetNote={onForgetNote}
            onNotes={onNotes}
            chatContext={chatContext}
            agents={agents}
          />
        )}
        {tab === "season" && (
          <SeasonView
            leagueId={leagueId}
            myLeagueEntryId={myLeagueEntry?.id || null}
            squadsByEntryId={squadsByEntry}
            corrections={corrections}
            notes={notes}
            learning={learning}
            learningError={learningError}
            onRestored={onRestored}
          />
        )}
        {tab === "agents" && (
          <FreeAgents
            leagueId={leagueId}
            myEntryId={myEntryId}
            myElements={myElements}
            ownedElements={ownedElements}
            corrections={corrections}
            onLoaded={setAgents}
            notes={notes}
            onNotes={onNotes}
            chatContext={chatContext}
          />
        )}
        {tab === "trades" && (
          <Trades
            leagueId={leagueId}
            myEntryId={myEntryId}
            myElements={myElements}
            corrections={corrections}
            notes={notes}
          />
        )}
        {tab === "board" && (
          <DraftBoard
            players={players}
            draftedBy={draftedBy}
            onMark={markPlayer}
            onReset={resetMarks}
            fixturesByTeam={fixturesByTeam}
            fixturesAvailable={fixturesAvailable}
            historyAvailable={historyAvailable}
            departedExcluded={departedExcluded}
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
        {tab === "cheat" && <CheatSheet players={players} fixturesAvailable={fixturesAvailable} />}
        {tab === "chat" && <Chat context={chatContext} onNotes={onNotes} />}
      </main>
    </div>
  );
}
