import React from "react";
import { parseBlocks } from "../markdown.js";

// Nova's words, rendered rather than printed. The parsing lives in
// ../markdown.js where it can be tested without a browser.

function Inline({ runs }) {
  return runs.map((run, i) => {
    if (run.t === "b") return <strong key={i}>{run.s}</strong>;
    if (run.t === "i") return <em key={i}>{run.s}</em>;
    if (run.t === "code") return <code key={i}>{run.s}</code>;
    return <React.Fragment key={i}>{run.s}</React.Fragment>;
  });
}

export default function Markdown({ text }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="md">
      {blocks.map((block, i) => {
        if (block.t === "ul" || block.t === "ol") {
          const List = block.t === "ul" ? "ul" : "ol";
          return (
            <List key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline runs={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                <Inline runs={line} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
