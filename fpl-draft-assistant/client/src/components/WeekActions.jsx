import React from "react";
import { buildActions } from "../weekActions.js";

// The short list, rendered. The decisions about what belongs on it and in what
// order live in ../weekActions.js.

export default function WeekActions({ week, agents, notes }) {
  const actions = buildActions({ week, agents, notes });
  if (!actions.length) return null;
  return (
    <ul className="actions">
      {actions.map((action) => (
        <li key={action.title} className={`action action-${action.tone}`}>
          <span className="action-dot" aria-hidden="true" />
          <span className="action-body">
            <span className="action-title">{action.title}</span>
            {action.detail && <span className="action-detail">{action.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
