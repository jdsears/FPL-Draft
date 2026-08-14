import React, { useEffect, useRef, useState } from "react";
import { sendChat } from "../api.js";
import Avatar from "./Avatar.jsx";

const DRAFT_SUGGESTIONS = [
  "Who should I take with my next pick?",
  "Any transfer or injury news I should know before drafting?",
  "Best strategy for a 10-team snake draft?",
  "When should I draft my goalkeepers?",
  "Rate my team so far",
];

const SEASON_SUGGESTIONS = [
  "Check the team news for my eleven",
  "Would you change my line-up this week?",
  "Is there anyone worth claiming?",
  "How do I beat my opponent this week?",
  "Who is a risk to be rotated?",
];

function sourceLabel(source) {
  if (source.title) return source.title;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

/**
 * Team news Nova recorded during a turn. Shown so it is obvious that something
 * changed rather than just being said, since these adjust the projections.
 */
function Recorded({ notes, rejected }) {
  if (!notes?.length && !rejected?.length) return null;
  return (
    <div className="recorded">
      {notes?.map((note) => (
        <span key={note.id} className="recorded-note">
          <span className={`pos pos-${note.position}`}>{note.position}</span>
          <b>{note.playerName}</b> {note.label.toLowerCase()}
          <span className="pmeta"> noted, projections updated</span>
        </span>
      ))}
      {rejected?.map((r, i) => (
        <span key={`r-${i}`} className="recorded-note recorded-failed">
          {r.error}
        </span>
      ))}
    </div>
  );
}

/** Citations from Nova's web searches, shown under her reply. */
function Sources({ sources }) {
  if (!sources || !sources.length) return null;
  return (
    <div className="sources">
      <span className="sources-label">Sources</span>
      {sources.map((s) => (
        <a key={s.url} className="source-link" href={s.url} target="_blank" rel="noreferrer noopener">
          {sourceLabel(s)}
        </a>
      ))}
    </div>
  );
}

export default function Chat({ context, onNotes }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setError("");
    setInput("");
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setBusy(true);
    try {
      const { reply, sources, notes, rejected } = await sendChat(next, context);
      setMessages((m) => [...m, { role: "assistant", content: reply, sources, notes, rejected }]);
      // Anything she recorded has to reach the store, or it changes nothing.
      if (notes?.length) onNotes?.(notes);
    } catch (e) {
      setError(String(e.message || e));
      setMessages(messages);
      setInput(content);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <div className="chat-head">
        <Avatar size={44} />
        <div>
          <div className="pname">Nova</div>
          <div className="pmeta">
            {context?.gameweek ? `Your gameweek ${context.gameweek} strategist` : "Your draft-day strategist"}
          </div>
        </div>
      </div>
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              {context?.gameweek
                ? "Ask Nova about this week. She can see the eleven the app picked, your opponent, and the claims it rates, and she will go and check the team news herself. Tell her anything you have heard and she will write it down, which changes the projections."
                : "Ask Nova about picks, strategy, or your squad. She can see the current best available players, your roster, and recent picks."}
            </p>
            <div className="suggestions">
              {(context?.gameweek ? SEASON_SUGGESTIONS : DRAFT_SUGGESTIONS).map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            <div className={`msg-row ${m.role}`}>
              {m.role === "assistant" && <Avatar size={28} />}
              <div className={`msg ${m.role}`}>{m.content}</div>
            </div>
            {m.role === "assistant" && <Recorded notes={m.notes} rejected={m.rejected} />}
            {m.role === "assistant" && <Sources sources={m.sources} />}
          </React.Fragment>
        ))}
        {busy && (
          <div className="msg-row assistant">
            <Avatar size={28} />
            <div className="msg assistant thinking">Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <div className="banner error">{error}</div>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="search"
          placeholder="Ask Nova…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="chip active" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
