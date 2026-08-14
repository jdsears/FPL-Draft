// Mobile checks for every view the app has: the weekly lineup, the season, free
// agents, trades, the player board, fixtures and chat, plus the draft-night
// views when the draft is still to come.
//
// Takes screenshots at one desktop and three phone widths, then checks each
// view for horizontal page scroll, touch targets under 44px and text under
// 12px. Run it against a server that is already up:
//
//   npm start &
//   npm run check:mobile
//
// Environment: APP_URL (default http://127.0.0.1:3000), SHOT_DIR (default
// ./screenshots), CHROMIUM_PATH to reuse a browser already on the machine,
// LEAGUE_ID and ENTRY_ID to start with a league already connected so the
// head-to-head panel is on screen, and SEED_LOG=1 to plant a few gameweeks of
// recorded projections so the learning card has something to draw.

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://127.0.0.1:3000";
const OUT = process.env.SHOT_DIR || "screenshots";
const WIDTHS = [1280, 390, 375, 360];
const MIN_TARGET = 44;
const MIN_FONT = 12;

// Elements that predate this work and are unchanged by it. Reported as notes
// rather than failures so a real regression is not lost in the noise.
const PRE_EXISTING = ["mark", "pos", "toggle"];

fs.mkdirSync(OUT, { recursive: true });

function audit({ minTarget, minFont }) {
  const describe = (el) => String(el.className || "").split(/\s+/).filter(Boolean).join(".");
  const targets = [...document.querySelectorAll('button, a[href], input, label.toggle, [role="tab"]')]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const after = getComputedStyle(el, "::after");
      // A transparent pseudo-element is a legitimate way to grow a hit area.
      const pseudoHeight = after.content && after.content !== "none" ? parseFloat(after.height) || 0 : 0;
      const wrapper = el.closest("label, button, a[href]");
      const wrapperRect = wrapper && wrapper !== el ? wrapper.getBoundingClientRect() : null;
      return {
        kind: "target",
        selector: `${el.tagName.toLowerCase()}.${describe(el)}`,
        text: (el.textContent || el.type || "").trim().slice(0, 24),
        height: Math.round(Math.max(rect.height, pseudoHeight, wrapperRect ? wrapperRect.height : 0)),
        width: Math.round(Math.max(rect.width, wrapperRect ? wrapperRect.width : 0)),
      };
    })
    .filter((t) => t.height < minTarget || t.width < minTarget);

  const fonts = [...document.querySelectorAll("*")]
    .filter((el) => el.getClientRects().length && !el.children.length && (el.textContent || "").trim())
    .map((el) => ({
      kind: "font",
      selector: `${el.tagName.toLowerCase()}.${describe(el)}`,
      size: parseFloat(getComputedStyle(el).fontSize),
    }))
    .filter((f) => f.size < minFont);

  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    findings: [...targets, ...fonts],
  };
}

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const failures = [];
const notes = new Set();

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  if (process.env.LEAGUE_ID) {
    // The league is normally remembered from a previous visit, so seed it the
    // same way the app itself would.
    await page.addInitScript(
      ({ league, entry }) => {
        localStorage.setItem("fplda.leagueId", JSON.stringify(league));
        if (entry) localStorage.setItem("fplda.myEntryId", JSON.stringify(Number(entry)));
      },
      { league: process.env.LEAGUE_ID, entry: process.env.ENTRY_ID }
    );
  }
  if (process.env.SEED_LOG === "1") {
    // The learning card only exists once projections have been recorded, and
    // those are written before a gameweek is played, so there is no way to get
    // them retrospectively. Plant a plausible few.
    await page.addInitScript(
      ({ scope }) => {
        // Low element ids, so they exist in the bundled demo pool too.
        const players = [
          { id: 1, name: "Keeper", position: "GKP", projected: 4 },
          { id: 2, name: "Defender", position: "DEF", projected: 2.8 },
          { id: 3, name: "Midfielder", position: "MID", projected: 7.2 },
          { id: 4, name: "Forward", position: "FWD", projected: 5 },
        ];
        const events = {};
        for (let event = 1; event <= 5; event++) {
          events[event] = { event, at: "2026-08-20T00:00:00.000Z", projected: 38.2, opponentProjected: 41.3, players };
        }
        localStorage.setItem("fplda.projectionLog", JSON.stringify({ [scope]: events }));
      },
      { scope: `${process.env.LEAGUE_ID}:${process.env.ENTRY_ID}` }
    );
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".tabs");

  // The tab strip changes once the draft is done: the board is renamed and the
  // draft-night tools go away. A view whose tab is not on screen is skipped
  // rather than checked against whatever was showing before.
  const openTab = async (...names) => {
    for (const name of names) {
      const tab = page.getByRole("tab", { name, exact: true });
      if (await tab.count()) {
        await tab.click();
        return true;
      }
    }
    return false;
  };

  const views = [
    [
      "week",
      async () => {
        if (!(await openTab("My week"))) return "skip";
        // Either the eleven, or the note explaining the squad is not set yet.
        await page.waitForSelector(".week-lineup, .week .card");
      },
    ],
    [
      "week-expanded",
      async () => {
        const row = page.locator(".week-row").first();
        if (await row.count()) {
          await row.click();
          await page.waitForSelector(".week-summary");
        }
      },
    ],
    [
      "week-opponent",
      async () => {
        const show = page.locator(".week-rival button").first();
        if (await show.count()) {
          await show.click();
          await page.waitForSelector(".week-rival .week-block");
        }
      },
    ],
    [
      "season",
      async () => {
        if (!(await openTab("Season"))) return "skip";
        await page.waitForSelector(".week .card");
      },
    ],
    [
      "free-agents",
      async () => {
        if (!(await openTab("Free agents"))) return "skip";
        await page.waitForSelector(".week .card");
        await page.locator(".week-row").first().click();
        await page.waitForSelector(".week-summary");
      },
    ],
    [
      "trades",
      async () => {
        if (!(await openTab("Trades"))) return "skip";
        await page.waitForSelector(".week .card");
      },
    ],
    [
      "board",
      async () => {
        if (!(await openTab("Draft board", "Players"))) return "skip";
        await page.waitForSelector("table.board tbody tr");
      },
    ],
    [
      "board-expanded",
      async () => {
        await page.locator("table.board tbody tr").first().click();
        await page.waitForSelector(".breakdown");
      },
    ],
    [
      "fixtures",
      async () => {
        if (!(await openTab("Fixtures"))) return "skip";
        // The tab shows a note instead of a grid when fixtures are unavailable.
        await page.waitForSelector(".fixtures, .card");
      },
    ],
    [
      "best-available",
      async () => {
        if (!(await openTab("Best available"))) return "skip";
        await page.waitForSelector(".best-grid");
      },
    ],
    [
      "cheat-sheet",
      async () => {
        if (!(await openTab("Cheat sheet"))) return "skip";
        await page.waitForSelector(".cheat, .card");
      },
    ],
    [
      "chat",
      async () => {
        if (!(await openTab("Nova", "AI assistant"))) return "skip";
        await page.waitForSelector(".chat");
        await page.locator(".chat-input input").fill("Any transfer news I should know?");
        await page.locator(".chat-input button").click();
        // Either Nova answers or the app shows its friendly error, both of
        // which are worth a screenshot.
        await page.waitForSelector(".msg.assistant:not(.thinking), .chat .banner.error", {
          timeout: 30000,
        });
      },
    ],
  ];

  for (const [name, setup] of views) {
    if ((await setup()) === "skip") {
      console.log(`  skipped ${name} @ ${width}px, not available in this mode`);
      continue;
    }
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: name !== "chat" });
    const r = await page.evaluate(audit, { minTarget: MIN_TARGET, minFont: MIN_FONT });
    const label = `${name} @ ${width}px`;

    if (r.scrollWidth > r.innerWidth + 1) {
      failures.push(`${label}: page scrolls horizontally (${r.scrollWidth} > ${r.innerWidth})`);
    }
    // Many rows share a class, so report each distinct element once.
    const seen = new Set();
    for (const f of r.findings) {
      const key = `${label}|${f.selector}|${f.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const detail =
        f.kind === "target"
          ? `touch target ${f.selector} "${f.text}" is ${f.width}x${f.height}, under ${MIN_TARGET}px`
          : `text on ${f.selector} is ${f.size}px, under ${MIN_FONT}px`;
      if (PRE_EXISTING.some((cls) => f.selector.includes(`.${cls}`))) notes.add(detail);
      else failures.push(`${label}: ${detail}`);
    }
    console.log(`  checked ${label}  page width ${r.scrollWidth}/${r.innerWidth}`);
  }
  await page.close();
}

await browser.close();

if (notes.size) {
  console.log("\nPre-existing, outside this feature:");
  for (const note of notes) console.log(`  - ${note}`);
}
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of failures) console.log(`  - ${f}`);
} else {
  console.log(`\nNo horizontal scroll, no small touch targets, no text under ${MIN_FONT}px.`);
}
console.log(`Screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
