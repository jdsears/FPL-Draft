import test from "node:test";
import assert from "node:assert/strict";

import { parseInline, parseBlocks } from "../client/src/markdown.js";

test("bold, italics and code are lifted out, everything else stays literal", () => {
  assert.deepEqual(parseInline("Start **Isak** up front"), [
    { t: "text", s: "Start " },
    { t: "b", s: "Isak" },
    { t: "text", s: " up front" },
  ]);
  assert.deepEqual(parseInline("*maybe* `4-3-3`"), [
    { t: "i", s: "maybe" },
    { t: "text", s: " " },
    { t: "code", s: "4-3-3" },
  ]);
  // Multiplication is not emphasis.
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", s: "2 * 3 * 4" }]);
});

test("paragraphs, bullets and numbered lists come apart correctly", () => {
  const blocks = parseBlocks(
    "Two things this week.\n\n- **Isak** starts\n- Marmoush does not\n\n1. claim Dubravka\n2) hold the rest"
  );
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].t, "p");
  assert.equal(blocks[1].t, "ul");
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(blocks[1].items[0][0], { t: "b", s: "Isak" });
  assert.equal(blocks[2].t, "ol");
  assert.equal(blocks[2].items.length, 2);
});

test("a mixed block stays a paragraph, with its line breaks kept", () => {
  const blocks = parseBlocks("First line\n- not really a list\nlast line");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].t, "p");
  assert.equal(blocks[0].lines.length, 3);
});

test("anything unrecognised survives as literal text", () => {
  const runs = parseInline("**unclosed bold and <script>alert(1)</script>");
  assert.equal(runs.every((run) => run.t === "text"), true);
  assert.equal(runs.map((r) => r.s).join(""), "**unclosed bold and <script>alert(1)</script>");
  assert.deepEqual(parseBlocks(""), []);
  assert.deepEqual(parseBlocks(null), []);
});
