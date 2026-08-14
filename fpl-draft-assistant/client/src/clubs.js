// Club colours, for drawing a shirt.
//
// Generic coloured jerseys, not reproductions of anybody's kit: a body colour, a
// trim colour and a pattern, which is enough to recognise a side at a glance
// without shipping club artwork. Keyed by the short name the FPL feeds use, with
// a neutral fallback so a promoted club nobody has listed still gets a shirt.

const CLUBS = {
  ARS: { body: "#ef2233", trim: "#ffffff" },
  AVL: { body: "#95bfe5", trim: "#670e36", pattern: "halves", second: "#670e36" },
  BOU: { body: "#d71920", trim: "#000000", pattern: "stripes", second: "#000000" },
  BRE: { body: "#e30613", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  BHA: { body: "#0057b8", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  BUR: { body: "#6c1d45", trim: "#99d6ea" },
  CHE: { body: "#1c3fbb", trim: "#ffffff" },
  CRY: { body: "#1b458f", trim: "#c4122e", pattern: "stripes", second: "#c4122e" },
  EVE: { body: "#274488", trim: "#ffffff" },
  FUL: { body: "#ffffff", trim: "#000000" },
  IPS: { body: "#3a64a3", trim: "#ffffff" },
  LEE: { body: "#ffffff", trim: "#1d428a" },
  LEI: { body: "#0053a0", trim: "#fdbe11" },
  LIV: { body: "#c8102e", trim: "#00b2a9" },
  MCI: { body: "#6cabdd", trim: "#ffffff" },
  MUN: { body: "#d5122a", trim: "#000000" },
  NEW: { body: "#000000", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  NFO: { body: "#dd0000", trim: "#ffffff" },
  SOU: { body: "#d71920", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  SUN: { body: "#eb172b", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  TOT: { body: "#ffffff", trim: "#132257" },
  WHU: { body: "#7c2c3b", trim: "#1bb1e7" },
  WOL: { body: "#fdb913", trim: "#231f20" },
  COV: { body: "#78d0f3", trim: "#ffffff" },
  SHU: { body: "#e52b50", trim: "#000000", pattern: "stripes", second: "#000000" },
  MID: { body: "#d81920", trim: "#ffffff" },
  WBA: { body: "#ffffff", trim: "#122f67", pattern: "stripes", second: "#122f67" },
  NOR: { body: "#fff200", trim: "#00a650" },
  HUL: { body: "#f5971d", trim: "#000000", pattern: "stripes", second: "#000000" },
  STK: { body: "#e03a3e", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  BIR: { body: "#0000ff", trim: "#ffffff" },
  CAR: { body: "#0070b5", trim: "#ffffff" },
  SWA: { body: "#ffffff", trim: "#000000" },
  DER: { body: "#ffffff", trim: "#000000" },
  PRE: { body: "#ffffff", trim: "#00457c" },
  BLB: { body: "#009ee0", trim: "#ffffff", pattern: "halves", second: "#ffffff" },
  QPR: { body: "#0057b8", trim: "#ffffff", pattern: "stripes", second: "#ffffff" },
  WAT: { body: "#fbee23", trim: "#ed2127" },
  LUT: { body: "#f78f1e", trim: "#ffffff" },
  PLY: { body: "#007b5f", trim: "#ffffff" },
};

const FALLBACK = { body: "#8f83a8", trim: "#e9e4f2" };

/** The colours to draw a shirt in for a club's short name. */
export function clubKit(shortName) {
  return CLUBS[String(shortName || "").toUpperCase()] || FALLBACK;
}

/** Is this shirt light enough that text on it should be dark? */
export function isLightKit(shortName) {
  const kit = clubKit(shortName);
  const hex = String(kit.body).replace("#", "");
  if (hex.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Rough perceived brightness, good enough to decide black or white text.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}
