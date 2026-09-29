// Nova's web search tool, and the pieces of a response that come from it.
//
// web_search_20260318 lets Claude filter search results in code before
// they reach its context ("dynamic filtering"), so a news sweep across two
// squads spends far fewer tokens on pages that turn out to be irrelevant.
// Searches cost the same ($10 per 1,000); the code that does the filtering
// is not charged beyond its tokens.
//
// Filtering needs a model that can call tools from code (Claude 4.6 and
// later). On an older model the new tool returns 400, so an ANTHROPIC_MODEL
// override to one of those keeps the basic tool.
//
// Search results stay in the response in full (the default), because the
// sources shown under a reply are read from those result blocks.

const DYNAMIC_FILTERING_MODELS = /^claude-(?:(?:opus|sonnet)-(?:4-[6-9]|[5-9])|fable|mythos)/;

export function supportsDynamicFiltering(model) {
  return DYNAMIC_FILTERING_MODELS.test(String(model || ""));
}

export function webSearchTool(model, maxUses) {
  return {
    type: supportsDynamicFiltering(model) ? "web_search_20260318" : "web_search_20250305",
    name: "web_search",
    max_uses: maxUses,
  };
}

// Searches Claude actually ran. With filtering, the code runs are
// server_tool_use blocks too, and are not searches.
export function countSearches(content) {
  return (content || []).filter((b) => b?.type === "server_tool_use" && b.name === "web_search").length;
}

// Filtering runs in a code execution container. A follow-up request in the
// same exchange (after a pause, or after returning Nova's notes) passes its
// id back so the same container carries on.
export function containerId(response, previous) {
  return response?.container?.id || previous;
}
