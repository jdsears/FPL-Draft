// A small reading of Markdown, for Nova's replies.
//
// She writes bold, bullets and the odd numbered list; the app was printing the
// asterisks. This parses just that dialect into a tree the component renders as
// React nodes, so there is no HTML string anywhere and nothing to inject into.
// Anything it does not recognise stays literal text, which is the safe failure.

/** Inline runs: bold, italics, code. Returns [{ t: "text"|"b"|"i"|"code", s }]. */
export function parseInline(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g);
  return parts
    .filter((part) => part !== "")
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return { t: "b", s: part.slice(2, -2) };
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return { t: "code", s: part.slice(1, -1) };
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return { t: "i", s: part.slice(1, -1) };
      }
      return { t: "text", s: part };
    });
}

/**
 * Blocks: paragraphs and lists. Returns
 * [{ t: "p", lines: [inline[]] } | { t: "ul"|"ol", items: [inline[]] }].
 */
export function parseBlocks(text) {
  const blocks = [];
  for (const raw of String(text || "").split(/\n{2,}/)) {
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullet = /^[-*•]\s+/;
    const numbered = /^\d+[.)]\s+/;
    if (lines.every((line) => bullet.test(line))) {
      blocks.push({ t: "ul", items: lines.map((line) => parseInline(line.replace(bullet, ""))) });
    } else if (lines.every((line) => numbered.test(line))) {
      blocks.push({ t: "ol", items: lines.map((line) => parseInline(line.replace(numbered, ""))) });
    } else {
      blocks.push({ t: "p", lines: lines.map(parseInline) });
    }
  }
  return blocks;
}
