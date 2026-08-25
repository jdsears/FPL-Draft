async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const fetchBootstrap = () => getJson("/api/bootstrap");
export const fetchLeague = (id) => getJson(`/api/league/${id}`);
export const fetchChoices = (id) => getJson(`/api/league/${id}/choices`);

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** The best legal eleven for a squad, and the opponent's, for one gameweek. */
export const fetchMyWeek = (body) => postJson("/api/my-week", body);

/** Unowned players ranked for the gameweeks ahead, plus the swaps worth making. */
export const fetchFreeAgents = (body) => postJson("/api/free-agents", body);

/** The league table, every squad's strength, and the run of opponents left. */
export const fetchSeasonOverview = (body) => postJson("/api/season-overview", body);

/** How past projections actually turned out, and the corrections that follow. */
export const fetchLearning = (body) => postJson("/api/learning", body);

/** Every one-for-one swap with every rival, valued both ways. */
export const fetchTrades = (body) => postJson("/api/trades", body);

/** The last stretch of conversation with Nova, kept server-side per squad. */
export const fetchChatHistory = (leagueId, myEntryId) =>
  getJson(`/api/chat-history?leagueId=${encodeURIComponent(leagueId)}&myEntryId=${myEntryId}`);

/** Push this device's notes and log, get back the union across devices. */
export const syncState = (body) => postJson("/api/sync", body);

function normaliseChat(data) {
  return {
    reply: data.reply,
    sources: Array.isArray(data.sources) ? data.sources : [],
    // Team news Nova recorded during the turn, for the caller to store.
    notes: Array.isArray(data.notes) ? data.notes : [],
    rejected: Array.isArray(data.rejected) ? data.rejected : [],
  };
}

export async function sendChat(messages, context, options = {}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context, thorough: options.thorough === true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
  return normaliseChat(data);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The same exchange, run as a server-side job and polled for. Long work must
 * not hang on one held-open request, because a phone browser kills those: iOS
 * Safari gives up around a minute, and a locked screen sooner. A poll survives
 * both, and if the phone spends the sweep in a pocket the finished result is
 * still waiting server-side when it comes back.
 */
export async function sendChatJob(messages, context, options = {}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context, thorough: options.thorough === true, background: true }),
  });
  const started = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(started.error || `Chat failed (${res.status})`);

  const deadline = Date.now() + 6 * 60 * 1000;
  let misses = 0;
  while (Date.now() < deadline) {
    await sleep(2500);
    let poll;
    try {
      poll = await fetch(`/api/chat-job/${started.jobId}`);
    } catch {
      // One dropped poll is a tunnel or a lock screen; a run of them is real.
      if (++misses >= 8) throw new Error("Lost contact while Nova was working. Try again.");
      continue;
    }
    misses = 0;
    const job = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(job.error || `The job could not be read (${poll.status}).`);
    if (job.status === "failed") throw new Error(job.error || "Nova could not finish the job.");
    if (job.status === "done") return normaliseChat(job.result || {});
    options.onProgress?.(job.progress || {});
  }
  throw new Error("Nova is taking longer than expected. Give it a minute and try again.");
}
