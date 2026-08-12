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

export default function SyncStatus({ syncedAt, error, picks, onSyncNow }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = syncedAt !== null && now - syncedAt > STALE_AFTER_MS;
  const failing = Boolean(error) || stale;
  const picksLabel = `${picks} ${picks === 1 ? "pick" : "picks"} made`;

  // The raw error is a URL-bearing string that reads badly and cannot wrap, so
  // it goes in the tooltip and the bar carries plain English.
  let message;
  if (!syncedAt && !error) {
    message = "Connecting to your draft, waiting for the first update";
  } else if (!syncedAt) {
    message = "Not syncing, picks are not arriving. Mark them by hand with Mine and Gone";
  } else if (failing) {
    message = `Picks may have stopped arriving, last update ${ago(now - syncedAt)}. ${picksLabel}`;
  } else {
    message = `Picks in sync, updated ${ago(now - syncedAt)}. ${picksLabel}`;
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
