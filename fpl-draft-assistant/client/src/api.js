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

export async function sendChat(messages, context, options = {}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context, thorough: options.thorough === true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
  return {
    reply: data.reply,
    sources: Array.isArray(data.sources) ? data.sources : [],
    // Team news Nova recorded during the turn, for the caller to store.
    notes: Array.isArray(data.notes) ? data.notes : [],
    rejected: Array.isArray(data.rejected) ? data.rejected : [],
  };
}
