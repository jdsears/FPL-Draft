// Mobile checks for the draft board, fixtures grid, best available and chat.
//
// Takes screenshots at one desktop and three phone widths, then checks each
// view for horizontal page scroll, touch targets under 44px and text under
// 12px. Run it against a server that is already up:
//
//   npm start &
//   npm run check:mobile
//
// Environment: APP_URL (default http://127.0.0.1:3000), SHOT_DIR (default
// ./screenshots), CHROMIUM_PATH to reuse a browser already on the machine.

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
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("table.board tbody tr");

  const views = [
    ["board", async () => {}],
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
        await page.getByRole("tab", { name: "Fixtures" }).click();
        // The tab shows a note instead of a grid when fixtures are unavailable.
        await page.waitForSelector(".fixtures, .card");
      },
    ],
    [
      "best-available",
      async () => {
        await page.getByRole("tab", { name: "Best available" }).click();
        await page.waitForSelector(".best-grid");
      },
    ],
    [
      "cheat-sheet",
      async () => {
        await page.getByRole("tab", { name: "Cheat sheet" }).click();
        await page.waitForSelector(".cheat, .card");
      },
    ],
    [
      "chat",
      async () => {
        await page.getByRole("tab", { name: "AI assistant" }).click();
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
    await setup();
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
