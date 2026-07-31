import React, { useEffect, useRef, useState } from "react";
import { sendChat } from "../api.js";
import Avatar from "./Avatar.jsx";

const SUGGESTIONS = [
  "Who should I take with my next pick?",
  "Best strategy for a 10-team snake draft?",
  "When should I draft my goalkeepers?",
  "Rate my team so far",
];

export default function Chat({ context }) {
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
      const reply = await sendChat(next, context);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
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
          <div className="pmeta">Your draft-day strategist</div>
        </div>
      </div>
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Ask Nova about picks, strategy, or your squad. She can see the current best
              available players, your roster, and recent picks.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg-row ${m.role}`}>
            {m.role === "assistant" && <Avatar size={28} />}
            <div className={`msg ${m.role}`}>{m.content}</div>
          </div>
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
