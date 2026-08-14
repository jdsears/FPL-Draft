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
export const fetchMyWeek = (elements, opponentElements) =>
  postJson("/api/my-week", { elements, opponentElements });

/** Unowned players ranked for the gameweeks ahead, plus the swaps worth making. */
export const fetchFreeAgents = (body) => postJson("/api/free-agents", body);

export async function sendChat(messages, context) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
  return { reply: data.reply, sources: Array.isArray(data.sources) ? data.sources : [] };
}
