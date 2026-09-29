import test from "node:test";
import assert from "node:assert/strict";

import { supportsDynamicFiltering, webSearchTool, countSearches, containerId } from "../lib/websearch.js";

test("the default model gets the filtering web search", () => {
  assert.deepEqual(webSearchTool("claude-sonnet-5-5", 3), { type: "web_search_20260318", name: "web_search", max_uses: 3 });
});

test("filtering is only asked of models that can run it", () => {
  for (const m of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-4-7", "claude-sonnet-4-6", "claude-fable-5-1"]) {
    assert.equal(supportsDynamicFiltering(m), true, m);
  }
  for (const m of ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "claude-haiku-4-5", "claude-3-7-sonnet-latest", "", undefined]) {
    assert.equal(supportsDynamicFiltering(m), false, String(m));
    assert.equal(webSearchTool(m, 8).type, "web_search_20250305", String(m));
  }
});

test("only web searches count as searches, not the code that filters them", () => {
  const content = [
    { type: "text", text: "Checking the latest news." },
    { type: "server_tool_use", name: "code_execution", id: "a" },
    { type: "server_tool_use", name: "web_search", id: "b" },
    { type: "web_search_tool_result", tool_use_id: "b", content: [] },
    { type: "server_tool_use", name: "web_search", id: "c" },
  ];
  assert.equal(countSearches(content), 2);
  assert.equal(countSearches(undefined), 0);
});

test("the container carries on through the exchange", () => {
  assert.equal(containerId({ container: { id: "cont_1" } }, undefined), "cont_1");
  assert.equal(containerId({}, "cont_1"), "cont_1");
  assert.equal(containerId(null, undefined), undefined);
});
