import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSeasonOverview } from "../api.js";
import Learning from "./Learning.jsx";

// The league, read as a season rather than a draft. A head-to-head league is
// not won by scoring the most points, it is won by beating the manager in front
// of you, so the two questions here are how strong every squad is from here and
// who is left to play.

function FormRun({ form }) {
  if (!form || !form.length) return <span className="pmeta">No games yet</span>;
  return (
    <span className="form-run">
      {form.map((f) => (
        <span
          key={f.event}
          className={`form-chip form-${f.result}`}
          title={`GW${f.event}: ${f.scored} to ${f.conceded}`}
        >
          {f.result}
        </span>
      ))}
    </span>
  );
}

function ordinal(n) {
  const value = Number(n) || 0;
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] || "th"}`;
}

function scheduleTone(strength, average) {
  if (strength === null || average === null) return "";
  const gap = strength - average;
  if (gap >= 3) return "sos-hard";
  if (gap <= -3) return "sos-easy";
  return "";
}

export default function SeasonView({
  leagueId,
  myLeagueEntryId,
  squadsByEntryId,
  corrections,
  learning,
  learningError,
  onRestored,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const squadsKey = useMemo(() => JSON.stringify(squadsByEntryId || {}), [squadsByEntryId]);

  const load = useCallback(() => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    fetchSeasonOverview({
      leagueId,
      myEntryId: myLeagueEntryId || null,
      squadsByEntryId: JSON.parse(squadsKey),
      corrections,
    })
      .then(setData)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [leagueId, myLeagueEntryId, squadsKey, corrections]);

  useEffect(load, [load]);

  if (!leagueId) {
    return (
      <section className="week">
        <div className="card">
          <h3>No league connected</h3>
          <p className="pmeta">
            Add your league ID on the League tab. This view then shows the table, how strong every squad is from
            here, and the run of opponents you have left.
          </p>
        </div>
      </section>
    );
  }

  const sos = data?.strengthOfSchedule;
  const table = data?.table || [];
  const nothingPlayed = table.length > 0 && table.every((row) => row.played === 0);

  return (
    <section className="week">
      <div className="card week-head">
        <div>
          <h3>{data?.leagueName || "Your league"}</h3>
          <p className="pmeta">
            {loading || !data
              ? "Reading the league"
              : nothingPlayed
                ? `Nothing played yet, so this is the draft judged on projections. Strength is the points a squad's best eleven is expected to score in gameweek ${data.nextEvent}.`
                : `After gameweek ${data.currentEvent}. Strength is the points a squad's best eleven is expected to score in a gameweek.`}
          </p>
        </div>
        <button className="chip subtle" onClick={load} disabled={loading}>
          {loading ? "Updating" : "Refresh"}
        </button>
      </div>

      {error && <div className="banner error">Could not read the league: {error}</div>}

      <Learning learning={learning} error={learningError} onRestored={onRestored} />
      {data?.ownershipSource === "unavailable" && (
        <p className="pmeta">
          Squad ownership could not be read, so strength is unavailable and this shows results only.
          {data.ownershipError ? ` (${data.ownershipError})` : ""}
        </p>
      )}
      {data?.ownershipSource === "picks" && (
        <p className="pmeta">
          Squads are taken from the draft rather than the live league feed, so strength does not reflect waiver
          moves since.
        </p>
      )}
      {data?.nextDraft && (
        <p className="pmeta">
          This league drafts again in gameweek {data.nextDraft.event}
          {data.nextDraft.at ? ` on ${new Date(data.nextDraft.at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}` : ""}
          , so squads only have to last until then.
        </p>
      )}
      {!myLeagueEntryId && data && (
        <p className="pmeta">Tap your own team on the League tab to see your remaining run of opponents.</p>
      )}

      {table.length > 0 && (
        <div className="card">
          <h3>{nothingPlayed ? "Squads, strongest first" : "Table"}</h3>
          <div className="table-wrap">
            <table className="board">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Team</th>
                  <th className="num">Pts</th>
                  <th className="num">Strength</th>
                  <th className="hide-sm">Form</th>
                  <th className="num hide-sm">For</th>
                  <th className="num hide-sm">Against</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row, i) => (
                  <tr key={row.entryId} className={row.mine ? "row-mine" : ""}>
                    <td className="num">{row.rank || i + 1}</td>
                    <td className="team-cell">
                      <span className="pname">{row.name}</span>
                      <span className="pmeta">
                        {row.manager} · {row.won}W {row.drawn}D {row.lost}L
                      </span>
                      {/* The form column is hidden on a phone, so it moves here. */}
                      <span className="show-sm form-inline">
                        <FormRun form={row.form} />
                      </span>
                    </td>
                    <td className="num strong">{row.leaguePoints}</td>
                    <td className="num">{row.strength === null ? "n/a" : row.strength.toFixed(1)}</td>
                    <td className="hide-sm">
                      <FormRun form={row.form} />
                    </td>
                    <td className="num hide-sm">{row.pointsFor}</td>
                    <td className="num hide-sm">{row.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pmeta">
            {nothingPlayed
              ? "There are no results to order by yet, so this is ordered by projected strength. It is a read on the draft, not a prediction of the table."
              : "Recent form is the last five results, oldest first. Hold a result to see the score."}
          </p>
        </div>
      )}

      {data?.schedule?.length > 0 && (
        <div className="card">
          <h3>Your next {data.schedule.length} opponents</h3>
          {data.schedule.map((fixture) => (
            <div
              key={`${fixture.event}-${fixture.opponentId}`}
              className={`week-row sos-row ${scheduleTone(fixture.opponentStrength, sos?.leagueAverage ?? null)}`.trim()}
            >
              <span className="week-slot">GW{fixture.event}</span>
              <span className="week-main">
                <span className="pname">{fixture.opponentName}</span>
                <span className="pmeta">
                  {fixture.opponentRank ? `${ordinal(fixture.opponentRank)} in the table` : "Not yet ranked"}
                  {fixture.opponentAverage !== null ? ` · averaging ${fixture.opponentAverage} a gameweek` : ""}
                </span>
              </span>
              <span className="week-points">
                {fixture.opponentStrength === null ? "n/a" : fixture.opponentStrength.toFixed(1)}
              </span>
            </div>
          ))}
          {sos?.average !== null && sos?.versusAverage !== null && (
            <p className="pmeta">
              Your opponents average {sos.average.toFixed(1)} a gameweek against a league average of{" "}
              {sos.leagueAverage.toFixed(1)}, so this run is{" "}
              {Math.abs(sos.versusAverage) < 1
                ? "about as hard as anyone else's"
                : sos.versusAverage > 0
                  ? `harder than average by ${sos.versusAverage.toFixed(1)} a gameweek`
                  : `kinder than average by ${Math.abs(sos.versusAverage).toFixed(1)} a gameweek`}
              . The hardest is {sos.hardest.opponentName} in gameweek {sos.hardest.event}.
            </p>
          )}
        </div>
      )}
      {data && myLeagueEntryId && data.schedule.length === 0 && (
        <p className="pmeta">No fixtures left to play in the league's schedule.</p>
      )}
    </section>
  );
}
