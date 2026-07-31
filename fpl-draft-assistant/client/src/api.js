async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const fetchBootstrap = () => getJson("/api/bootstrap");
export const fetchLeague = (id) => getJson(`/api/league/${id}`);
export const fetchChoices = (id) => getJson(`/api/league/${id}/choices`);

export async function sendChat(messages, context) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
  return data.reply;
}
