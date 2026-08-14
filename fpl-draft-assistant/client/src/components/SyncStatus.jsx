import React, { useEffect, useState } from "react";

// A silently dead poll looks exactly like a draft where nobody has picked yet,
// which is the one failure you would not notice until the players you wanted
// were gone. This says out loud whether picks are still arriving.
//
// It keeps its own one-second ticker so the relative time updates without
// re-rendering the 700-row board above it.

const STALE_AFTER_MS = 45000;

function ago(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

export default function SyncStatus({ syncedAt, error, picks, onSyncNow, inSeason = false }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = syncedAt !== null && now - syncedAt > STALE_AFTER_MS;
  const failing = Boolean(error) || stale;
  // Once the draft is over the pick count is history, and the sync is really
  // about whether the league data behind every tab is current.
  const picksLabel = `${picks} ${picks === 1 ? "pick" : "picks"} made`;
  const subject = inSeason ? "League data" : "Picks";

  // The raw error is a URL-bearing string that reads badly and cannot wrap, so
  // it goes in the tooltip and the bar carries plain English.
  let message;
  if (!syncedAt && !error) {
    message = inSeason ? "Connecting to your league" : "Connecting to your draft, waiting for the first update";
  } else if (!syncedAt) {
    message = inSeason
      ? "Not syncing, so your squad and free agents may be out of date"
      : "Not syncing, picks are not arriving. Mark them by hand with Mine and Gone";
  } else if (failing) {
    message = `${subject} may have stopped updating, last update ${ago(now - syncedAt)}`;
    if (!inSeason) message += `. ${picksLabel}`;
  } else {
    message = `${subject} in sync, updated ${ago(now - syncedAt)}`;
    if (!inSeason) message += `. ${picksLabel}`;
  }

  return (
    <div className={`sync-bar ${failing || (!syncedAt && error) ? "sync-warn" : ""}`} role="status" aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-message" title={error || undefined}>
        {message}
      </span>
      <button className="chip subtle sync-now" onClick={onSyncNow}>
        Sync now
      </button>
    </div>
  );
}
