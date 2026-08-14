import React, { useState } from "react";

/** The address of this deployment with the league setup baked in. */
function setupLink(leagueId, myEntryId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?league=${encodeURIComponent(leagueId)}${myEntryId ? `&entry=${myEntryId}` : ""}`;
}

/** One tap to put the setup link on the clipboard, for sending to a phone. */
function ShareSetup({ leagueId, myEntryId }) {
  const [message, setMessage] = useState("");
  if (!leagueId) return null;
  const link = setupLink(leagueId, myEntryId);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Copied. Open it on your phone and that browser is set up too.");
    } catch {
      setMessage(link);
    }
  };
  return (
    <div className="setup-share">
      <p className="pmeta">
        This connection lives in this browser only, so a phone or another laptop starts unconnected. Send
        yourself this link and opening it sets the device up in one tap.
      </p>
      <button className="chip subtle" onClick={copy}>
        Copy setup link
      </button>
      {message && <p className="pmeta setup-link">{message}</p>}
    </div>
  );
}

export default function LeaguePanel({ leagueId, league, leagueError, myEntryId, onSetLeague, onSetEntry }) {
  const [draftId, setDraftId] = useState(leagueId || "");
  const entries = league?.league_entries || [];
  const standings = league?.standings || [];

  return (
    <section className="league">
      <div className="card">
        <h3>Connect your league</h3>
        <p className="pmeta">
          Find your league ID in the URL when viewing your league on draft.premierleague.com, e.g.
          draft.premierleague.com/league/<b>12345</b>/status
        </p>
        <form
          className="league-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSetLeague(draftId.trim());
          }}
        >
          <input
            className="search"
            inputMode="numeric"
            placeholder="League ID"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
          />
          <button className="chip active" type="submit">
            Connect
          </button>
        </form>
        {leagueError && <div className="banner error">{leagueError}</div>}
        {league && (
          <p className="pmeta">
            Connected to <b>{league.league?.name}</b>. Draft picks will sync automatically while the draft runs.
          </p>
        )}
        {league && <ShareSetup leagueId={leagueId} myEntryId={myEntryId} />}
      </div>

      {entries.length > 0 && (
        <div className="card">
          <h3>Which team is yours?</h3>
          <div className="entry-list">
            {entries.map((e) => (
              <button
                key={e.entry_id || e.id}
                className={`chip ${myEntryId === (e.entry_id || e.id) ? "active" : ""}`}
                onClick={() => onSetEntry(e.entry_id || e.id)}
              >
                {e.entry_name} ({e.player_first_name} {e.player_last_name})
              </button>
            ))}
          </div>
        </div>
      )}

      {standings.length > 0 && (
        <div className="card">
          <h3>Standings</h3>
          <div className="table-wrap">
            <table className="board">
              <thead>
                <tr>
                  <th className="num">Pos</th>
                  <th>Team</th>
                  <th className="num">W</th>
                  <th className="num">D</th>
                  <th className="num">L</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => {
                  const e = entries.find((x) => x.id === s.league_entry);
                  return (
                    <tr key={s.league_entry}>
                      <td className="num">{s.rank}</td>
                      <td>{e ? e.entry_name : s.league_entry}</td>
                      <td className="num">{s.matches_won}</td>
                      <td className="num">{s.matches_drawn}</td>
                      <td className="num">{s.matches_lost}</td>
                      <td className="num strong">{s.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
