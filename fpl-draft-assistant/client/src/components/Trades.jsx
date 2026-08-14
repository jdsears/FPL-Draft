import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTrades } from "../api.js";

// Trades, against every rival at once. Each swap is valued by re-picking both
// elevens, which is the only honest way to price it: a player who never reaches
// your eleven is worth nothing to you.
//
// One consequence shapes this whole view. Squads stay at 2 GKP, 5 DEF, 5 MID and
// 3 FWD, so trades are position for position, and under one projection model a
// like-for-like swap cannot improve both sides. So there is no "both win" list
// to show. What matters is which swaps gain the most and cost the other manager
// least, because those are the ones with a chance of being accepted.

function Swap({ swap }) {
  return (
    <div className={`week-row sos-row ${swap.easyAsk ? "sos-easy" : ""}`.trim()}>
      <span className="week-main">
        <span className="pname">
          <span className={`pos pos-${swap.position}`}>{swap.position}</span> {swap.in.name} for {swap.out.name}
        </span>
        <span className="pmeta">{swap.summary}</span>
      </span>
      <span className="week-points">
        +{swap.myGain.toFixed(1)}
        <span className="trade-cost">{swap.theirCost > 0 ? `-${swap.theirCost.toFixed(1)} them` : "free"}</span>
      </span>
    </div>
  );
}

function Rival({ rival, open, onToggle }) {
  const asks = rival.easyAsks || [];
  const best = (rival.best || []).filter((s) => !asks.some((a) => a.in.id === s.in.id && a.out.id === s.out.id));
  const headline = rival.best?.[0];

  return (
    <div className="card">
      <div className="week-head">
        <div>
          <h3>{rival.name}</h3>
          <p className="pmeta">
            Their eleven is projected {rival.theirEleven.toFixed(1)} in {rival.theirFormation || "no legal shape"}.
            {headline
              ? ` Best on offer is ${headline.myGain.toFixed(1)} a gameweek to you.`
              : " Nothing here improves your eleven."}
          </p>
        </div>
        {headline && (
          <button className="chip subtle" onClick={() => onToggle(rival.entryId)} aria-expanded={open}>
            {open ? "Hide" : "Show"}
          </button>
        )}
      </div>

      {open && (
        <>
          {asks.length > 0 && (
            <div className="week-block">
              <div className="week-block-head">Worth asking</div>
              {asks.map((swap) => (
                <Swap key={`${swap.out.id}-${swap.in.id}`} swap={swap} />
              ))}
            </div>
          )}
          {best.length > 0 && (
            <div className="week-block">
              <div className="week-block-head">Bigger gains, harder sell</div>
              {best.map((swap) => (
                <Swap key={`${swap.out.id}-${swap.in.id}`} swap={swap} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Trades({ leagueId, myEntryId, myElements, corrections, notes }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);

  const mineKey = useMemo(() => myElements.slice().sort((a, b) => a - b).join(","), [myElements]);

  const load = useCallback(() => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    fetchTrades({
      leagueId,
      myEntryId: myEntryId || null,
      elements: mineKey ? mineKey.split(",").map(Number) : [],
      corrections,
      notes,
    })
      .then((d) => {
        setData(d);
        // The rival with the biggest gain on offer is the one to look at first.
        setOpen(d.rivals?.[0]?.entryId ?? null);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [leagueId, myEntryId, mineKey, corrections, notes]);

  useEffect(load, [load]);

  const toggle = useCallback((id) => setOpen((c) => (c === id ? null : id)), []);

  if (!leagueId) {
    return (
      <section className="week">
        <div className="card">
          <h3>No league connected</h3>
          <p className="pmeta">
            Add your league ID on the League tab. This view then values every possible swap with every rival,
            both ways.
          </p>
        </div>
      </section>
    );
  }

  const rivals = data?.rivals || [];
  const anything = rivals.some((r) => (r.best || []).length > 0);

  return (
    <section className="week">
      <div className="card week-head">
        <div>
          <h3>Trades</h3>
          <p className="pmeta">
            {loading || !data
              ? "Valuing every swap with every rival"
              : `Your eleven is projected ${data.myEleven === null ? "n/a" : data.myEleven.toFixed(1)} a gameweek${
                  data.myFormation ? ` in ${data.myFormation}` : ""
                }. Every swap below is valued by re-picking both elevens for gameweek ${data.nextEvent} onwards.`}
          </p>
        </div>
        <button className="chip subtle" onClick={load} disabled={loading}>
          {loading ? "Updating" : "Refresh"}
        </button>
      </div>

      {error && <div className="banner error">Could not value trades: {error}</div>}
      {data && !data.tradesAllowed && (
        <p className="pmeta">This league has trades switched off, so these are for interest only.</p>
      )}
      {data && !data.squadKnown && (
        <p className="pmeta">
          Your squad is not known yet, so there is nothing to trade from. Tap your team on the League tab.
        </p>
      )}
      {data?.squadKnown && (
        <p className="pmeta">
          Squads have to stay at 2 GKP, 5 DEF, 5 MID and 3 FWD, so every trade is position for position. On one
          set of projections that makes a swap zero sum: whatever it gains you it takes from them. So the deals
          worth asking for are the ones that cost the other manager least, marked in green, usually because the
          player leaving their squad was not in their eleven anyway.
        </p>
      )}
      {data && data.squadKnown && !anything && !loading && (
        <p className="pmeta">Nothing any rival holds would improve your eleven, so hold what you have.</p>
      )}

      {rivals.map((rival) => (
        <Rival key={rival.entryId} rival={rival} open={open === rival.entryId} onToggle={toggle} />
      ))}
    </section>
  );
}
