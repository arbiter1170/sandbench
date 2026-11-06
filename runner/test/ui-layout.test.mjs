// Browser layout checks for the chat page in real headless Chromium. It lives with the runner's
// tests because Playwright and its Chromium are the runner's (CI installs them for SB-13; locally
// run `npx playwright install chromium` in runner/). The page under test is the fixture in
// src/layout-fixture (the real Workspace shell, real styles, fixed messages), built with Vite into
// a temp folder and served from 127.0.0.1. No harness, no sign-in, no network beyond loopback.
//
// What it asserts, at phone widths and on the desktop with the side panel: the page and the
// message list never scroll sideways, every bubble holds its own content (long inline Windows
// paths, separators, links), approval cards stay inside their bubble with their buttons on
// screen, and only the preformatted tool output scrolls, inside its own panel. UX P1 adds the
// context line and its sheet. UX P2 adds the turn status line. For UX P3, a page of approval cards
// in every ending checks that each ending reads as a word plus an icon shape at full opacity and
// contrast, that cards are labelled groups, and that Approve comes before Deny, both at least
// 44 x 44 px, with nothing taking focus. UX P4 adds touch targets, primary-button contrast, reflow
// at 320 px and 200% zoom, the composer's Enter key and the soft-keyboard inset ("phone basics").
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "..", "..", "src", "layout-fixture");
// Set to a folder to also save one PNG per viewport (used for the PR's before/after pictures).
const SHOTS = process.env.SANDBENCH_LAYOUT_SHOTS || "";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

// 360 and 390 are common phone widths, 460 a wide phone; 1280 shows rail, chat and side panel.
const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 800, wide: false },
  { name: "phone-390", width: 390, height: 844, wide: false },
  { name: "phone-460", width: 460, height: 900, wide: false },
  { name: "desktop-1280", width: 1280, height: 800, wide: true },
];

let outDir;
let server;
let base;
let browser;

before(async () => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "sb-layout-"));
  const [{ build }, { default: react }] = await Promise.all([import("vite"), import("@vitejs/plugin-react")]);
  await build({ root: FIXTURE, configFile: false, envFile: false, base: "./", logLevel: "silent", plugins: [react()], build: { outDir, emptyOutDir: true } });
  server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    const file = path.join(outDir, path.normalize(decodeURIComponent(pathname.endsWith("/") ? `${pathname}index.html` : pathname)).replace(/^(\.\.[/\\])+/, ""));
    try {
      if (!file.startsWith(outDir) || !statSync(file).isFile()) throw new Error("not a file");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (/Executable doesn't exist/.test(String(error?.message))) {
      throw new Error("Chromium is not installed for Playwright. Run `npx playwright install chromium` in runner/.");
    }
    throw error;
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

// Runs in the page. Plain numbers only, so the assertions and their messages live in Node.
function measure() {
  const rect = (el) => el.getBoundingClientRect();
  const shown = (el) => el.getClientRects().length > 0;
  const scroll = document.querySelector(".scroll");
  const stage = document.querySelector(".stage");
  const composer = document.querySelector(".composer");
  const inspector = document.querySelector(".inspector");
  const msgRight = (el) => rect(el.closest(".msg")).right;
  return {
    innerWidth: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    stageRight: rect(stage).right,
    inspectorShown: Boolean(inspector) && shown(inspector),
    scroll: { clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth },
    composer: { clientWidth: composer.clientWidth, scrollWidth: composer.scrollWidth, right: rect(composer).right },
    msgs: [...document.querySelectorAll(".msg")].map((msg) => ({
      role: msg.classList.contains("user") ? "user" : "assistant",
      right: rect(msg).right,
      clientWidth: msg.clientWidth,
      scrollWidth: msg.scrollWidth,
      // Elements drawn past the bubble's right edge (not the scroll panels' own contents).
      spill: [...msg.querySelectorAll("*")]
        .filter((el) => shown(el) && !el.closest("pre") && rect(el).right > rect(msg).right + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`),
    })),
    approvals: [...document.querySelectorAll(".approval")].map((card) => {
      const pre = card.querySelector("pre");
      return {
        status: [...card.classList].find((name) => name !== "approval") ?? "",
        right: rect(card).right,
        msgRight: msgRight(card),
        // The widest code value on the card (command, address, file, ...); the card itself if none.
        command: { right: Math.max(...[...card.querySelectorAll("code")].map((code) => rect(code).right), rect(card).left) },
        buttons: [...card.querySelectorAll("button")].map((button) => ({ right: rect(button).right, shown: shown(button) })),
        pre: pre ? { right: rect(pre).right, clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, whiteSpace: getComputedStyle(pre).whiteSpace } : null,
      };
    }),
    links: [...document.querySelectorAll(".msg a")].map((link) => ({ text: link.textContent, right: rect(link).right, msgRight: msgRight(link), shown: shown(link) })),
    codeblocks: [...document.querySelectorAll(".codeblock pre")].map((pre) => ({ right: rect(pre).right, msgRight: msgRight(pre), clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth })),
    separators: [...document.querySelectorAll(".markdown p")].filter((p) => /[─═]{10,}/.test(p.textContent)).map((p) => ({ right: rect(p).right, msgRight: msgRight(p) })),
    userSelect: getComputedStyle(document.querySelector(".markdown p")).userSelect,
  };
}

async function open(viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: "load", timeout: 20_000 });
  await page.waitForSelector(".approval.pending", { timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(measure);
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, `${viewport.name}-top.png`) });
    await page.evaluate(() => document.querySelector(".approval.approved").scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(SHOTS, `${viewport.name}-card.png`) });
    await page.evaluate(() => document.querySelector(".scroll").scrollTo(0, 1e6));
    await page.screenshot({ path: path.join(SHOTS, `${viewport.name}-bottom.png`) });
  }
  await context.close();
  return { facts, errors };
}

describe("chat layout stays inside the viewport", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: nothing but tool output scrolls sideways`, async () => {
      const { facts, errors } = await open(viewport);
      assert.deepEqual(errors, [], "the fixture page threw");
      assert.equal(facts.innerWidth, viewport.width);
      assert.ok(facts.msgs.length >= 5, "the fixture's messages rendered");

      // The page, the stage, the message list and the composer are no wider than the window.
      assert.ok(facts.pageScrollWidth <= viewport.width, `page scrollWidth ${facts.pageScrollWidth} > ${viewport.width}`);
      assert.ok(facts.stageRight <= viewport.width + 0.5, `stage right ${facts.stageRight}`);
      assert.equal(facts.inspectorShown, viewport.wide, viewport.wide ? "the side panel is shown on the desktop" : "no side panel on a phone");
      assert.ok(facts.scroll.scrollWidth <= facts.scroll.clientWidth, `message list scrolls sideways: ${facts.scroll.scrollWidth} > ${facts.scroll.clientWidth}`);
      assert.ok(facts.composer.scrollWidth <= facts.composer.clientWidth, "the composer scrolls sideways");
      assert.ok(facts.composer.right <= viewport.width + 0.5, `composer right ${facts.composer.right}`);

      // Every bubble holds its content: long inline paths, separators and links wrap inside it.
      for (const [index, msg] of facts.msgs.entries()) {
        assert.ok(msg.scrollWidth <= msg.clientWidth, `message ${index} (${msg.role}) content is wider than its bubble: ${msg.scrollWidth} > ${msg.clientWidth}`);
        assert.deepEqual(msg.spill, [], `message ${index} (${msg.role}) has elements past its right edge`);
      }
      for (const separator of facts.separators) assert.ok(separator.right <= separator.msgRight + 0.5, "a separator line runs past its bubble");
      assert.equal(facts.links.length, 2, "the two source links rendered (a bare URL stays text)");
      for (const link of facts.links) {
        assert.ok(link.shown, `link ${link.text} is hidden`);
        assert.ok(link.right <= link.msgRight + 0.5, `link ${link.text} runs past its bubble`);
      }
      // Fenced code keeps its existing behaviour: it wraps, so it does not scroll.
      assert.ok(facts.codeblocks.length >= 1);
      for (const block of facts.codeblocks) {
        assert.ok(block.right <= block.msgRight + 0.5, "a code block runs past its bubble");
        assert.ok(block.scrollWidth <= block.clientWidth, "a code block scrolls sideways");
      }
      assert.notEqual(facts.userSelect, "none", "text stays selectable");

      // Approval cards: inside the bubble, controls on screen, and only the preformatted output
      // scrolls, inside its own panel, never past the card.
      assert.equal(facts.approvals.length, 2);
      for (const card of facts.approvals) {
        assert.ok(card.right <= card.msgRight + 0.5, `approval card (${card.status}) runs past its bubble`);
        assert.ok(card.command.right <= card.right + 0.5, "the approval's command runs past its card");
        for (const button of card.buttons) {
          assert.ok(button.shown, "an approval button is hidden");
          assert.ok(button.right <= Math.min(card.right, viewport.width) + 0.5, "an approval button is off screen");
        }
      }
      const done = facts.approvals.find((card) => card.status === "approved");
      const pending = facts.approvals.find((card) => card.status === "pending");
      assert.equal(pending.buttons.length, 2, "approve and deny are shown on the pending card");
      assert.ok(done.pre, "the approved card shows its output");
      assert.equal(done.pre.whiteSpace, "pre", "tool output stays preformatted");
      assert.ok(done.pre.right <= done.right + 0.5, `the output panel runs past its card: ${done.pre.right} > ${done.right}`);
      assert.ok(done.pre.scrollWidth > done.pre.clientWidth, "the wide tool output scrolls inside its own panel");
    });
  }
});

// UX P1: the context line under the chat header. In the fixture the harness is offline, which
// gives the longest connection word ("Local harness not reachable").
describe("chat context line", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: the connection word is never cut and the line is a full-width 44 px target`, async () => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(base, { waitUntil: "load", timeout: 20_000 });
      await page.waitForSelector(".chat-context", { timeout: 10_000 });
      await page.evaluate(() => document.fonts.ready);
      const line = await page.evaluate(() => {
        const button = document.querySelector(".chat-context");
        const word = button.querySelector(".ctx-conn");
        const box = button.getBoundingClientRect();
        return { height: box.height, right: box.right, text: word.textContent, cut: word.scrollWidth > word.clientWidth + 1, wordRight: word.getBoundingClientRect().right };
      });
      await context.close();
      assert.match(line.text, /Local harness not reachable/);
      assert.equal(line.cut, false, "the connection word is truncated");
      assert.ok(line.wordRight <= line.right + 0.5, "the connection word runs past the line");
      assert.ok(line.height >= 44, `the line is ${line.height}px tall`);
      assert.ok(line.right <= viewport.width + 0.5, "the line runs past the window");
    });
  }
});

describe("chat context sheet", () => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`${viewport.name}: the sheet keeps focus, Esc closes it from anywhere, focus returns to the line`, async () => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(base, { waitUntil: "load", timeout: 20_000 });
      await page.click(".chat-context");
      await page.waitForSelector(".ctx-sheet");
      const active = () => page.evaluate(() => ({ inSheet: Boolean(document.activeElement?.closest(".ctx-sheet")), cls: document.activeElement?.className || document.activeElement?.tagName }));
      assert.equal((await active()).inSheet, true, "opening the sheet moves focus into it");
      assert.equal(await page.locator(".ctx-sheet input, .ctx-sheet select, .ctx-sheet textarea").count(), 0, "the sheet has no inputs");
      // The rest of the page is inert while the sheet is open.
      assert.equal(await page.evaluate(() => document.querySelector(".chat-context").closest("[inert]") !== null), true, "the page behind is not inert");
      // A click on a row's text, then Esc: still closes, and focus goes back to the line.
      await page.click(".ctx-row dd");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".ctx-sheet").count(), 0, "Esc after a click on the text left the sheet open");
      assert.match((await active()).cls, /chat-context/);
      assert.equal(await page.evaluate(() => document.querySelector(".chat-context").closest("[inert]")), null, "the page stays inert after closing");
      // Tab never leaves the sheet, including while "Check again" is busy.
      await page.click(".chat-context");
      await page.waitForSelector(".ctx-sheet");
      await page.getByRole("button", { name: "Check again" }).focus();
      await page.keyboard.press("Enter");
      // Once the check is running (busy, or disabled if someone changes that), focus is still on the button.
      await page.waitForFunction(() => [...document.querySelectorAll(".ctx-sheet footer button")].some((node) => node.textContent === "Check again" && (node.getAttribute("aria-busy") === "true" || node.disabled)));
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Check again", "focus left the busy button");
      assert.equal((await active()).inSheet, true, "focus left the sheet while busy");
      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press("Tab");
        assert.equal((await active()).inSheet, true, `Tab ${index + 1} left the sheet`);
      }
      await page.getByText("Still not reachable").waitFor({ timeout: 5_000 });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".ctx-sheet").count(), 0);
      await context.close();
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: a group chat's line keeps the agent readable and the connection word whole`, async () => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(`${base}?scenario=channel`, { waitUntil: "load", timeout: 20_000 });
      await page.waitForSelector(".chat-context");
      await page.evaluate(() => document.fonts.ready);
      const line = await page.evaluate(() => {
        const button = document.querySelector(".chat-context");
        const shown = [...button.querySelectorAll(".ctx-agent")].find((node) => getComputedStyle(node).display !== "none");
        const word = button.querySelector(".ctx-conn");
        return { agent: shown?.textContent, agentWidth: shown?.getBoundingClientRect().width ?? 0, conn: word.textContent, cut: word.scrollWidth > word.clientWidth + 1, pageWidth: document.documentElement.scrollWidth };
      });
      await context.close();
      assert.match(line.conn, /Connected/);
      assert.equal(line.cut, false, "the connection word is truncated");
      assert.ok(line.agentWidth >= 40, `the agent text is ${line.agentWidth}px wide`);
      assert.ok(line.pageWidth <= viewport.width, "the page scrolls sideways");
      // The chat column is under 700 px at every width here, so the short form shows.
      assert.equal(line.agent, "Mixed agents");
    });
  }
});

// UX P3: one approval card per ending (src/layout-fixture, ?scenario=cards).
function measureCards() {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rgb = (text) => (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (text) => {
    const [r, g, b] = rgb(text).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const opacity = (el) => {
    let value = 1;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return value;
  };
  const text = (ids) => (ids || "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  return {
    focusInCard: Boolean(document.activeElement?.closest(".approval")),
    cards: [...document.querySelectorAll(".approval")].map((card) => {
      const box = card.getBoundingClientRect();
      const state = card.querySelector(".approval-state");
      const icon = state?.querySelector("svg");
      const bg = getComputedStyle(card).backgroundColor;
      const texts = [...card.querySelectorAll(".approval-state span, .approval-detail, .approval-scope, .approval-field dt, .approval-field dd")];
      return {
        ending: card.dataset.ending,
        role: card.getAttribute("role"),
        name: text(card.getAttribute("aria-labelledby")),
        title: card.querySelector("header strong")?.textContent,
        description: text(card.getAttribute("aria-describedby")),
        scope: card.querySelector(".approval-scope")?.textContent ?? "",
        label: state?.textContent ?? "",
        opacity: opacity(card),
        iconShown: Boolean(icon) && icon.getBoundingClientRect().width >= 10,
        minContrast: Math.min(...texts.map((el) => contrast(getComputedStyle(el).color, bg))),
        right: box.right,
        msgRight: card.closest(".msg").getBoundingClientRect().right,
        scrollWidth: card.scrollWidth,
        clientWidth: card.clientWidth,
        buttons: [...card.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return { text: button.textContent, width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right };
        }),
      };
    }),
  };
}

describe("approval cards (UX P3)", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: every ending is a labelled group with a word and a shape at full contrast; Approve first, both 44 px`, async () => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${base}?scenario=cards`, { waitUntil: "load", timeout: 20_000 });
      await page.waitForSelector(".approval.pending", { timeout: 10_000 });
      await page.evaluate(() => document.fonts.ready);
      const facts = await page.evaluate(measureCards);
      if (SHOTS) {
        await page.evaluate(() => document.querySelector(".approval.pending").scrollIntoView({ block: "start" }));
        await page.screenshot({ path: path.join(SHOTS, `${viewport.name}-cards.png`) });
      }
      await context.close();
      assert.deepEqual(errors, [], "the fixture page threw");
      assert.equal(facts.focusInCard, false, "a card took focus");
      assert.equal(facts.cards.length, 14);
      const endings = facts.cards.map((card) => card.ending);
      assert.equal(new Set(endings).size, endings.length, `two cards share an ending: ${endings.join(", ")}`);
      const labels = facts.cards.map((card) => card.label);
      assert.equal(new Set(labels).size, labels.length, `two cards share a label: ${labels.join(" | ")}`);
      for (const card of facts.cards) {
        const what = `${card.ending} card`;
        assert.equal(card.role, "group", `${what} is not a group`);
        assert.equal(card.name, card.title, `${what} is not named by its title`);
        assert.ok(card.description.includes(card.scope.trim()), `${what}'s description leaves out the scope`);
        assert.ok(card.description.includes(card.label.trim()), `${what}'s description leaves out its ending`);
        assert.equal(card.opacity, 1, `${what} is dimmed`);
        assert.ok(card.label.trim().length > 3 && card.iconShown, `${what} needs a word and an icon`);
        assert.ok(card.minContrast >= 4.5, `${what} has text at ${card.minContrast.toFixed(2)}:1`);
        assert.ok(card.right <= card.msgRight + 0.5, `${what} runs past its bubble`);
        assert.ok(card.scrollWidth <= card.clientWidth, `${what} scrolls sideways`);
      }
      const pending = facts.cards.filter((card) => card.ending === "waiting");
      assert.equal(pending.length, 1);
      const [approve, deny] = pending[0].buttons;
      assert.equal(pending[0].buttons.length, 2);
      assert.match(approve.text, /^Approve/);
      assert.equal(deny.text, "Deny");
      assert.ok(approve.top < deny.top || (approve.top === deny.top && approve.left < deny.left), "Approve is not first");
      for (const button of [approve, deny]) {
        assert.ok(button.width >= 44 && button.height >= 44, `${button.text} is ${button.width}x${button.height}`);
        assert.ok(button.right <= viewport.width + 0.5, `${button.text} is off screen`);
      }
      // Decided cards offer no buttons (a lost or reloaded card is not approvable).
      for (const card of facts.cards.filter((item) => item.ending !== "waiting")) assert.equal(card.buttons.length, 0, `${card.ending} card has buttons`);
    });
  }

  test("a click on Deny ends the waiting card as \"Denied by you\", without moving focus elsewhere", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=cards`, { waitUntil: "load", timeout: 20_000 });
    const card = page.locator(".approval.pending");
    await card.waitFor();
    const id = await card.evaluate((node) => node.getAttribute("aria-labelledby"));
    await card.getByRole("button", { name: "Deny" }).click();
    const after = page.locator(`.approval:has([id="${id}"])`);
    await after.locator(".approval-state", { hasText: "Denied by you" }).waitFor({ timeout: 5_000 });
    const facts = await after.evaluate((node) => ({ ending: node.dataset.ending, buttons: node.querySelectorAll("button").length, detail: node.querySelector(".approval-detail")?.textContent ?? "" }));
    await context.close();
    assert.equal(facts.ending, "denied-by-you");
    assert.equal(facts.buttons, 0, "the denied card still has buttons");
    assert.match(facts.detail, /^You chose Deny at /);
  });

  test("keyboard: Tab reaches Approve and then Deny, with a visible focus ring", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=cards`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForSelector(".approval.pending");
    await page.locator(".approval.pending button.primary").focus();
    const ring = () => page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { text: document.activeElement.textContent, outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    const first = await ring();
    await page.keyboard.press("Tab");
    const second = await ring();
    await context.close();
    assert.match(first.text, /^Approve/);
    assert.equal(second.text, "Deny");
    for (const item of [first, second]) {
      assert.notEqual(item.outline, "none", `${item.text} has no focus ring`);
      assert.ok(item.width >= 2, `${item.text}'s focus ring is ${item.width}px`);
    }
  });
});

// UX P2: the turn status line on every assistant message, the Couldn't start card with its
// one-time planner choice, and the busy note under the composer (fixture ?scenario=turns: a turn
// is running, so the planner choice is disabled).
describe("turn status line", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: every reply has an icon and a word, cards and actions fit, nothing scrolls sideways`, async () => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${base}?scenario=turns`, { waitUntil: "load", timeout: 20_000 });
      await page.waitForSelector(".turn-card", { timeout: 10_000 });
      await page.evaluate(() => document.fonts.ready);
      const facts = await page.evaluate(() => {
        const rect = (el) => el.getBoundingClientRect();
        const shown = (el) => el.getClientRects().length > 0;
        const scroll = document.querySelector(".scroll");
        return {
          pageScrollWidth: document.documentElement.scrollWidth,
          scroll: { clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth },
          receiving: document.body.textContent.includes("Receiving"),
          replies: [...document.querySelectorAll(".msg:not(.user)")].map((msg) => {
            const live = msg.querySelector(".turn-live");
            return {
              icon: live?.querySelector(".turn-icon")?.textContent ?? "",
              iconHidden: live?.querySelector(".turn-icon")?.getAttribute("aria-hidden") ?? "",
              text: live?.querySelector(".turn-text")?.textContent ?? "",
              role: live?.getAttribute("role") ?? "",
              // The line or card spans the bubble (a class clash once squeezed it to a dot's width).
              widthShare: (() => {
                const box = msg.querySelector(".turn-status, .turn-card");
                return box ? rect(box).width / msg.clientWidth : 0;
              })(),
              clientWidth: msg.clientWidth,
              scrollWidth: msg.scrollWidth,
              spill: [...msg.querySelectorAll("*")].filter((el) => shown(el) && !el.closest("pre") && rect(el).right > rect(msg).right + 0.5).map((el) => el.className || el.tagName),
            };
          }),
          buttons: [...document.querySelectorAll(".turn-actions button")].map((button) => ({ text: button.textContent, right: rect(button).right, height: rect(button).height, shown: shown(button), disabled: button.disabled, bubbleRight: rect(button.closest(".msg")).right })),
          chosen: document.querySelector(".turn-chosen a")?.textContent ?? "",
          busy: (() => {
            const note = document.querySelector(".busy-note");
            return { text: note?.textContent ?? "", role: note?.getAttribute("role"), live: note?.getAttribute("aria-live"), shown: note ? shown(note) && rect(note).height > 0 : false, right: note ? rect(note).right : 0 };
          })(),
        };
      });
      assert.deepEqual(errors, [], "the fixture page threw");
      assert.ok(facts.pageScrollWidth <= viewport.width, `page scrollWidth ${facts.pageScrollWidth}`);
      assert.ok(facts.scroll.scrollWidth <= facts.scroll.clientWidth, "the message list scrolls sideways");
      assert.equal(facts.receiving, false, "'Receiving' is still shown");
      assert.equal(facts.replies.length, 8);
      for (const [index, reply] of facts.replies.entries()) {
        assert.ok(reply.icon.trim().length > 0, `reply ${index} has no icon`);
        assert.equal(reply.iconHidden, "true", `reply ${index}'s icon is read out`);
        assert.ok(reply.text.trim().length > 0, `reply ${index} has no status word`);
        assert.equal(reply.role, "status", `reply ${index}'s status line is not a live region`);
        assert.ok(reply.widthShare >= 0.7, `reply ${index}'s status is ${Math.round(reply.widthShare * 100)}% of its bubble`);
        assert.ok(reply.scrollWidth <= reply.clientWidth, `reply ${index} is wider than its bubble`);
        assert.deepEqual(reply.spill, [], `reply ${index} has elements past its right edge`);
      }
      assert.deepEqual(
        facts.replies.map((reply) => reply.text.split(/ · |\. /)[0]),
        ["Couldn't start", "Couldn't start", "Finished", "Stop requested", "Failed", "Interrupted", "Start status unknown", "Working"],
      );
      const planner = facts.buttons.filter((button) => button.text === "Answer with the built-in planner this time");
      assert.equal(planner.length, 1, "the planner choice shows once, on the unclaimed Couldn't start card");
      assert.equal(planner[0].disabled, true, "the planner choice is enabled while a turn runs");
      assert.match(facts.chosen, /^Planner answer chosen at .+ ↓$/);
      for (const button of facts.buttons) {
        assert.ok(button.shown, `${button.text} is hidden`);
        assert.ok(button.right <= Math.min(button.bubbleRight, viewport.width) + 0.5, `${button.text} runs past its bubble`);
        assert.ok(button.height >= 44, `${button.text} is ${button.height}px tall`);
      }
      assert.equal(facts.busy.role, "status");
      assert.equal(facts.busy.live, "polite");
      assert.match(facts.busy.text, /North is still replying\. Your message is kept/);
      assert.ok(facts.busy.shown, "the busy note is not on screen");
      assert.ok(facts.busy.right <= viewport.width + 0.5, "the busy note runs past the window");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${viewport.name}-turns.png`), fullPage: false });
      await context.close();
    });
  }

  test("Check connection keeps focus on its button and announces the result politely", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=turns`, { waitUntil: "load", timeout: 20_000 });
    const button = page.locator(".turn-card").first().getByRole("button", { name: "Check connection" });
    await button.focus();
    await page.keyboard.press("Enter");
    await page.locator(".turn-card").first().locator(".turn-result").getByText("Still not reachable").waitFor({ timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Check connection", "focus moved");
    assert.equal(await page.locator(".turn-card").first().locator(".turn-result").getAttribute("aria-live"), "polite");
    // Ask again… only calls back; the fixture records it and nothing else happens on the page.
    await page.getByRole("button", { name: "Ask again…" }).first().click();
    assert.equal((await page.evaluate(() => window.asked ?? [])).length, 1);
    await context.close();
  });
});

// UX P2 review fixes, through the fixture's wiring of the app's own helpers (startPlannerAnswer,
// askAgainDraft, focusComposer). ?idle=1: no turn running, so the planner choice is enabled.
describe("turn status interactions", () => {
  test("two taps in one tick start one planner turn, and focus moves to 'Planner answer chosen'", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=turns&idle=1`, { waitUntil: "load", timeout: 20_000 });
    const button = page.getByRole("button", { name: "Answer with the built-in planner this time" });
    await button.focus();
    await page.evaluate(() => {
      const target = [...document.querySelectorAll("button")].find((node) => node.textContent === "Answer with the built-in planner this time");
      target.click();
      target.click();
    });
    await page.locator(".turn-card").first().locator(".turn-chosen a").waitFor({ timeout: 5_000 });
    assert.deepEqual(await page.evaluate(() => window.plannerAsks), ["List the files in the walklings-team folder"]);
    assert.equal(await button.count(), 0, "the planner choice is still offered");
    assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /^Planner answer chosen at /, "focus did not move to the chosen link");
    await context.close();
  });

  test("Ask again… fills an empty composer and focuses it; a draft being typed is kept and the note says so", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=turns&idle=1`, { waitUntil: "load", timeout: 20_000 });
    const askAgain = page.getByRole("button", { name: "Ask again…" }).first();
    await askAgain.click();
    const composer = page.locator("#composer");
    assert.equal(await composer.inputValue(), "Run the build");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "composer");
    await composer.fill("a new question");
    await askAgain.click();
    assert.equal(await composer.inputValue(), "a new question", "the draft was overwritten");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "composer");
    assert.match(await page.locator(".busy-note").textContent(), /^Your draft is kept\./);
    await context.close();
  });

  test("on a touch screen the error-details toggle and the chosen link are 44 px targets", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`${base}?scenario=turns`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForSelector(".turn-details summary");
    const heights = await page.evaluate(() => ({
      coarse: matchMedia("(pointer: coarse)").matches,
      summary: document.querySelector(".turn-details summary").getBoundingClientRect().height,
      chosen: document.querySelector(".turn-chosen a").getBoundingClientRect().height,
    }));
    assert.equal(heights.coarse, true);
    assert.ok(heights.summary >= 44, `the error-details toggle is ${heights.summary}px tall`);
    assert.ok(heights.chosen >= 44, `the chosen link is ${heights.chosen}px tall`);
    await context.close();
  });
});

// UX P4: phone basics (spec §6 P4, §11). Touch contexts emulate a phone: `(pointer: coarse)` and
// `(hover: none)` match, as on a real one. Soft keyboards, IME and real zoom stay manual (§9).
const TOUCH = { hasTouch: true, isMobile: true };
const PHONES = VIEWPORTS.filter((viewport) => !viewport.wide);
const NARROW = { name: "phone-320", width: 320, height: 640, wide: false };
// 1280 x 800 at 200% browser zoom lays out as 640 x 400 CSS px.
const ZOOM_200 = { name: "zoom-200", width: 640, height: 400, wide: false };

async function openPage(viewport, { touch = false, query = "", init = null } = {}) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, ...(touch ? TOUCH : {}) });
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}${query}`, { waitUntil: "load", timeout: 20_000 });
  await page.waitForSelector(".chat-context", { timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

// Runs in the page: every visible control under 44 x 44 CSS px, or drawn nearly invisible.
function smallTargets() {
  const controls = 'button, a[href], select, input:not([type="hidden"]), textarea, summary, [role="tab"], [tabindex]:not([tabindex="-1"])';
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : el.textContent?.trim() ? ` "${el.textContent.trim().slice(0, 24)}"` : ""}`;
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll(controls)) {
    if (el.closest(".skip, .sr-only, [hidden]")) continue;
    // Inline links inside message text are exempt (WCAG 2.5.5 "inline").
    if (el.matches(".markdown a")) continue;
    const target = (el.matches('input[type="checkbox"], input[type="radio"]') && el.closest("label")) || el;
    const box = target.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    let opacity = 1;
    let shown = true;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") shown = false;
      opacity *= Number(style.opacity);
    }
    if (!shown) continue;
    checked += 1;
    if (opacity < 0.5) bad.push(`${label(el)} is nearly invisible (opacity ${opacity})`);
    else if (box.width < 43.5 || box.height < 43.5) bad.push(`${label(el)} is ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return { checked, bad };
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Runs in the page: the computed colours of a button and of the surface it sits on.
function buttonColours(selector) {
  const rgb = (value) => {
    const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const button = document.querySelector(selector);
  let surface = button.parentElement;
  while (surface && rgb(getComputedStyle(surface).backgroundColor).alpha === 0) surface = surface.parentElement;
  const style = getComputedStyle(button);
  return {
    text: rgb(style.color),
    fill: rgb(style.backgroundColor),
    border: rgb(style.borderTopColor),
    outline: { colour: rgb(style.outlineColor), style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) },
    opacity: Number(style.opacity),
    surface: rgb(surface ? getComputedStyle(surface).backgroundColor : "rgb(0,0,0)"),
    surfaceName: surface?.className || surface?.tagName,
    focusVisible: button.matches(":focus-visible"),
  };
}

describe("phone basics (UX P4)", () => {
  for (const viewport of PHONES) {
    test(`${viewport.name}: on a coarse pointer every control in the chat, composer, dock, sheet, rail and side panel is at least 44x44 (P4-AC2, AC4)`, async () => {
      const { context, page, errors } = await openPage(viewport, { touch: true });
      const report = {};
      assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "the context has a coarse pointer");
      report.chat = await page.evaluate(smallTargets);
      // The composer's attach row.
      await page.tap('.composer-bar .icon-btn[aria-expanded="false"]');
      await page.waitForSelector(".plus-row");
      report.attach = await page.evaluate(smallTargets);
      // The "How this chat runs" sheet.
      await page.tap(".chat-context");
      await page.waitForSelector(".ctx-sheet");
      report.sheet = await page.evaluate(smallTargets);
      await page.keyboard.press("Escape");
      // The rail, through the dock. The bot menu button is shown without hover.
      await page.tap(".dock button >> nth=0");
      await page.waitForSelector(".rail .bot-link");
      report.rail = await page.evaluate(smallTargets);
      const menu = await page.evaluate(() => {
        const button = document.querySelector(".bot-menu-btn");
        const box = button.getBoundingClientRect();
        return { opacity: Number(getComputedStyle(button).opacity), width: box.width, height: box.height, right: box.right };
      });
      assert.equal(menu.opacity, 1, "the bot menu button is hidden until hover on touch");
      assert.ok(menu.right <= viewport.width + 0.5, "the bot menu button is off screen");
      await page.tap(".bot-menu-btn");
      await page.waitForSelector(".bot-menu");
      report.botMenu = await page.evaluate(smallTargets);
      await page.tap(".bot-menu-btn");
      // The side panel, each tab.
      await page.tap(".dock button >> nth=2");
      for (const tab of ["model", "customize", "work"]) {
        await page.tap(`#panel-tab-${tab}`);
        await page.waitForSelector(`#panel-${tab}`);
        report[tab] = await page.evaluate(smallTargets);
      }
      await context.close();
      assert.deepEqual(errors, [], "the fixture page threw");
      for (const [view, { checked, bad }] of Object.entries(report)) {
        assert.ok(checked > 0, `no controls measured in ${view}`);
        assert.deepEqual(bad, [], `${view}: controls under 44x44 on a coarse pointer`);
      }
    });
  }

  test("phone-390: on a coarse pointer the pending card's buttons are at least 44x44", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true });
    await page.evaluate(() => document.querySelector(".approval.pending").scrollIntoView({ block: "center" }));
    const boxes = await page.evaluate(() => [...document.querySelectorAll(".approval.pending button")].map((button) => button.getBoundingClientRect().toJSON()));
    await context.close();
    assert.equal(boxes.length, 2);
    for (const box of boxes) assert.ok(box.width >= 43.5 && box.height >= 43.5, `a card button is ${box.width}x${box.height}`);
  });

  test("a fine pointer keeps the desktop sizes (the 44 px rules are coarse-only)", async () => {
    const { context, page } = await openPage(PHONES[1]);
    const sizes = await page.evaluate(() => ({
      icon: document.querySelector(".composer-bar .icon-btn").getBoundingClientRect().height,
      menuOpacity: Number(getComputedStyle(document.querySelector(".bot-menu-btn")).opacity),
    }));
    await context.close();
    assert.ok(Math.abs(sizes.icon - 2.2 * 16) < 0.5, `the icon button is ${sizes.icon}px on a fine pointer`);
    assert.equal(sizes.menuOpacity, 0, "the bot menu button still appears on hover on a fine pointer");
  });

  for (const viewport of [PHONES[1], VIEWPORTS[3]]) {
    test(`${viewport.name}: the primary fill passes 4.5:1 at rest and on hover; its edge and focus ring pass 3:1 (P4-AC5)`, async () => {
      const { context, page } = await openPage(viewport);
      const results = [];
      for (const selector of [".approval.pending button.primary", ".composer .send-orb"]) {
        await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), selector);
        await page.mouse.move(0, 0);
        const rest = await page.evaluate(buttonColours, selector);
        await page.hover(selector);
        const hover = await page.evaluate(buttonColours, selector);
        await page.mouse.move(0, 0);
        // Keyboard focus, so :focus-visible applies as it would for a keyboard user.
        await page.evaluate((sel) => document.querySelector(sel).focus(), selector);
        const focus = await page.evaluate(buttonColours, selector);
        results.push({ selector, rest, hover, focus });
      }
      await context.close();
      for (const { selector, rest, hover, focus } of results) {
        assert.equal(rest.opacity, 1, `${selector} is dimmed`);
        assert.deepEqual(rest.fill.rgb, [0xc8, 0x3a, 0x3a], `${selector} rest fill is --accent-fill`);
        assert.deepEqual(hover.fill.rgb, [0xb8, 0x32, 0x32], `${selector} hover fill is --accent-fill-hover`);
        const restText = contrast(rest.text.rgb, rest.fill.rgb);
        const hoverText = contrast(hover.text.rgb, hover.fill.rgb);
        assert.ok(restText >= 4.5, `${selector} text at rest is ${restText.toFixed(2)}:1`);
        assert.ok(hoverText >= 4.5, `${selector} text on hover is ${hoverText.toFixed(2)}:1`);
        // The border, not the darker fill, is the edge on hover (WCAG 1.4.11).
        const edge = contrast(hover.border.rgb, hover.surface.rgb);
        assert.ok(edge >= 3, `${selector} hover border on ${hover.surfaceName} is ${edge.toFixed(2)}:1`);
        assert.equal(focus.focusVisible, true, `${selector} does not match :focus-visible`);
        assert.equal(focus.outline.style, "solid");
        assert.ok(focus.outline.width >= 2 && focus.outline.offset > 0, `${selector} focus ring is ${focus.outline.width}px at offset ${focus.outline.offset}`);
        // The offset puts the ring on the surface around the button.
        const ring = contrast(focus.outline.colour.rgb, focus.surface.rgb);
        assert.ok(ring >= 3, `${selector} focus ring on ${focus.surfaceName} is ${ring.toFixed(2)}:1`);
      }
    });
  }

  for (const viewport of [NARROW, ...PHONES, ZOOM_200]) {
    for (const scenario of ["", "?scenario=long", "?scenario=channel"]) {
      test(`${viewport.name}${scenario ? ` ${scenario.slice(1)}` : ""}: no horizontal page scroll; the long command and path wrap inside their bubble and card (P4-AC1, AC6)`, async () => {
        const { context, page, errors } = await openPage(viewport, { touch: true, query: scenario });
        const facts = await page.evaluate(() => {
          const rect = (el) => el.getBoundingClientRect();
          const scroll = document.querySelector(".scroll");
          const card = document.querySelector(".approval.pending");
          return {
            innerWidth,
            scrollWidth: document.scrollingElement.scrollWidth,
            list: { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth },
            composerRight: rect(document.querySelector(".composer")).right,
            card: card ? { right: rect(card).right, code: rect(card.querySelector("code")).right, codeText: card.querySelector("code").textContent, buttons: [...card.querySelectorAll("button")].map((button) => rect(button).right) } : null,
            msgs: [...document.querySelectorAll(".msg")].map((msg) => ({ scrollWidth: msg.scrollWidth, clientWidth: msg.clientWidth })),
          };
        });
        await context.close();
        assert.deepEqual(errors, []);
        assert.ok(facts.scrollWidth <= facts.innerWidth, `the page scrolls sideways: ${facts.scrollWidth} > ${facts.innerWidth}`);
        assert.ok(facts.list.scrollWidth <= facts.list.clientWidth, "the message list scrolls sideways");
        assert.ok(facts.composerRight <= viewport.width + 0.5, "the composer runs past the window");
        for (const msg of facts.msgs) assert.ok(msg.scrollWidth <= msg.clientWidth, "a bubble's content is wider than the bubble");
        if (scenario === "?scenario=long") {
          assert.ok(facts.card.codeText.length >= 120 && !/\s/.test(facts.card.codeText), "F-P4-a is a 120+ character run with no spaces");
          assert.ok(facts.card.code <= facts.card.right + 0.5, "the long command runs past its card");
          assert.equal(facts.card.buttons.length, 2);
          for (const right of facts.card.buttons) assert.ok(right <= Math.min(facts.card.right, viewport.width) + 0.5, "a card button is off screen");
        }
      });
    }
  }

  for (const scenario of ["", "?scenario=channel"]) {
    test(`phone-320${scenario ? " channel" : ""}: the context line wraps to two rows and keeps the connection word whole`, async () => {
      const lines = {};
      for (const viewport of [NARROW, PHONES[0]]) {
        const { context, page } = await openPage(viewport, { touch: true, query: scenario });
        lines[viewport.name] = await page.evaluate(() => {
          const button = document.querySelector(".chat-context");
          const agent = [...button.querySelectorAll(".ctx-agent")].find((node) => getComputedStyle(node).display !== "none");
          const word = button.querySelector(".ctx-conn");
          const box = button.getBoundingClientRect();
          const wordBox = word.getBoundingClientRect();
          return {
            height: box.height,
            right: box.right,
            buttonScroll: button.scrollWidth - button.clientWidth,
            text: word.textContent,
            cut: word.scrollWidth > word.clientWidth + 1,
            wordRight: wordBox.right,
            wordLeft: wordBox.left,
            sameRow: Math.abs(wordBox.top - agent.getBoundingClientRect().top) < 2,
            agentWidth: agent.getBoundingClientRect().width,
            pageWidth: document.scrollingElement.scrollWidth,
          };
        });
        await context.close();
      }
      const narrow = lines["phone-320"];
      assert.match(narrow.text, scenario ? /Connected/ : /Local harness not reachable/);
      assert.equal(narrow.cut, false, "the connection word is truncated at 320 px");
      assert.equal(narrow.sameRow, false, "the connection word did not move to a second row at 320 px");
      assert.ok(narrow.wordLeft >= 0 && narrow.wordRight <= narrow.right + 0.5, "the connection word runs past the line");
      assert.ok(narrow.buttonScroll <= 1, "the line's content is wider than the line");
      assert.ok(narrow.right <= 320.5, "the line runs past the window");
      assert.ok(narrow.agentWidth >= 40, `the agent text is ${narrow.agentWidth}px wide`);
      assert.ok(narrow.height >= 44, `the line is ${narrow.height}px tall`);
      assert.ok(narrow.pageWidth <= 320, "the page scrolls sideways");
      // P1's single row is unchanged from 360 px up.
      assert.equal(lines["phone-360"].sameRow, true, "the line wrapped at 360 px");
      assert.equal(lines["phone-360"].cut, false);
    });
  }

  test("coarse pointer: Enter inserts a newline and only the Send button sends (P4-AC3)", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true });
    await page.tap("#composer");
    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");
    await page.keyboard.type("there");
    const typed = await page.evaluate(() => ({ value: document.querySelector("#composer").value, sent: [...window.__sent] }));
    assert.equal(typed.value, "hello\nthere", "Enter did not insert a newline");
    assert.deepEqual(typed.sent, [], "Enter sent the draft on a coarse pointer");
    await page.tap(".composer .send-orb");
    const after = await page.evaluate(() => ({ value: document.querySelector("#composer").value, sent: [...window.__sent] }));
    await context.close();
    assert.deepEqual(after.sent, ["hello\nthere"], "the Send button did not send");
    assert.equal(after.value, "");
  });

  test("fine pointer: Enter sends, Shift+Enter inserts a newline, and Enter during IME composition never sends (P4-AC3)", async () => {
    const { context, page } = await openPage(VIEWPORTS[3]);
    await page.click("#composer");
    await page.keyboard.type("hi");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("you");
    assert.equal(await page.evaluate(() => document.querySelector("#composer").value), "hi\nyou");
    assert.deepEqual(await page.evaluate(() => [...window.__sent]), [], "Shift+Enter sent");
    // An Enter that commits an IME composition.
    await page.evaluate(() => document.querySelector("#composer").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    assert.deepEqual(await page.evaluate(() => [...window.__sent]), [], "Enter during composition sent");
    await page.keyboard.press("Enter");
    const sent = await page.evaluate(() => [...window.__sent]);
    await context.close();
    assert.deepEqual(sent, ["hi\nyou"], "Enter did not send on a fine pointer");
  });

  // A stand-in visualViewport, installed before the page's scripts, so the fixture's real
  // installViewportFit() reads it. Headless Chromium has no soft keyboard; this is the shape a
  // keyboard (or a pinch) gives the real object.
  function fakeVisualViewport() {
    const target = new EventTarget();
    const state = { height: window.innerHeight, offsetTop: 0, scale: 1 };
    const viewport = {
      get height() { return state.height; },
      get width() { return window.innerWidth; },
      get offsetTop() { return state.offsetTop; },
      get offsetLeft() { return 0; },
      get scale() { return state.scale; },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    window.__setViewport = (patch) => {
      Object.assign(state, patch);
      target.dispatchEvent(new Event("resize"));
    };
  }
  const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const keyboardFacts = (page) => page.evaluate(() => {
    const composer = document.querySelector(".composer").getBoundingClientRect();
    return {
      keyboard: document.documentElement.dataset.keyboard ?? null,
      inset: document.documentElement.style.getPropertyValue("--keyboard-inset"),
      composerBottom: composer.bottom,
      composerTop: composer.top,
      composerPadding: getComputedStyle(document.querySelector(".composer")).paddingBottom,
      dock: getComputedStyle(document.querySelector(".dock")).display,
      innerHeight,
    };
  });

  test("phone-390: viewportFit sees the soft keyboard; the composer ends above it and the dock steps aside", async () => {
    const { context, page, errors } = await openPage(PHONES[1], { touch: true, init: fakeVisualViewport });
    const closed = await keyboardFacts(page);
    // The keyboard covers 336 px of an 844 px layout viewport.
    await page.evaluate(() => window.__setViewport({ height: 508 }));
    await frames(page);
    const open = await keyboardFacts(page);
    // The browser panned the page itself instead: nothing is hidden below, so no inset.
    await page.evaluate(() => window.__setViewport({ offsetTop: 336 }));
    await frames(page);
    const panned = await keyboardFacts(page);
    await page.evaluate(() => window.__setViewport({ height: 844, offsetTop: 0 }));
    await frames(page);
    const again = await keyboardFacts(page);
    await context.close();
    assert.deepEqual(errors, []);
    assert.equal(closed.keyboard, null);
    assert.equal(closed.dock, "grid");
    assert.equal(open.keyboard, "open", "viewportFit did not see the keyboard");
    assert.equal(open.inset, "336px");
    assert.equal(open.dock, "none", "the dock stays up while typing");
    assert.ok(open.composerBottom <= 508 + 0.5, `the composer ends at ${open.composerBottom}, under the keyboard`);
    assert.ok(open.composerTop >= 0, "the composer is pushed off the top");
    assert.equal(panned.keyboard, null, "a panned page was padded as well");
    assert.deepEqual(again, closed, "closing the keyboard did not restore the layout");
  });

  test("phone-390: pinch zoom is not a keyboard", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true, init: fakeVisualViewport });
    const before = await keyboardFacts(page);
    await page.evaluate(() => window.__setViewport({ scale: 2, height: 422 }));
    await frames(page);
    const zoomed = await keyboardFacts(page);
    await context.close();
    assert.equal(zoomed.keyboard, null, "pinch zoom was taken for a keyboard");
    assert.equal(zoomed.inset, "");
    assert.deepEqual(zoomed, before);
  });

  test("a window resized from 800 to 500 px tall is not a keyboard (real visualViewport)", async () => {
    const { context, page } = await openPage({ width: 390, height: 800 }, { touch: true });
    assert.equal(await page.evaluate(() => Boolean(window.visualViewport)), true);
    await page.setViewportSize({ width: 390, height: 500 });
    await frames(page);
    const facts = await keyboardFacts(page);
    await context.close();
    assert.equal(facts.innerHeight, 500);
    assert.equal(facts.keyboard, null, "a shorter window was taken for a keyboard");
    assert.equal(facts.inset, "");
    assert.equal(facts.dock, "grid");
    assert.ok(facts.composerBottom <= 500, "the composer runs past the window");
  });

  test("tablet-1024: with the keyboard open the composer drops its safe-area padding (no double gap)", async () => {
    const { context, page } = await openPage({ width: 1024, height: 768 }, { touch: true, init: fakeVisualViewport });
    await page.evaluate(() => window.__setViewport({ height: 450 }));
    await frames(page);
    const open = await keyboardFacts(page);
    // Headless Chromium reports no safe-area inset, so also check the rule that removes it is
    // global (not only in the phone media query), where an iPad at 900 px and up would reach it.
    const rule = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).some((item) => item instanceof CSSStyleRule && item.selectorText.replace(/\s+/g, " ") === ':root[data-keyboard="open"] .composer' && item.style.paddingBottom === "0.75rem"));
    await context.close();
    assert.equal(open.keyboard, "open");
    assert.equal(open.composerPadding, "12px");
    assert.ok(open.composerBottom <= 450 + 0.5, `the composer ends at ${open.composerBottom}, under the keyboard`);
    assert.equal(rule, true, "no top-level rule drops the safe-area padding while the keyboard is open");
  });

  test("touch: with a photo attached and no text, the Send button sends (it does not record)", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true, query: "?attach=1" });
    const orb = await page.evaluate(() => ({ text: document.querySelector(".composer .send-orb").textContent, label: document.querySelector(".composer .send-orb").getAttribute("aria-label") }));
    await page.tap(".composer .send-orb");
    const result = await page.evaluate(() => ({ sent: [...window.__sent], voice: window.__voice.length }));
    await context.close();
    assert.deepEqual(orb, { text: "Send", label: "Send" });
    assert.deepEqual(result, { sent: [""], voice: 0 }, "the attached photo was not sent");
  });

  test("touch: with nothing to send the button records a voice note", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true });
    const text = await page.evaluate(() => document.querySelector(".composer .send-orb").textContent);
    await page.tap(".composer .send-orb");
    const result = await page.evaluate(() => ({ sent: [...window.__sent], voice: window.__voice.length }));
    await context.close();
    assert.equal(text, "Rec");
    assert.deepEqual(result, { sent: [], voice: 1 });
  });

  for (const touch of [true, false]) {
    test(`${touch ? "coarse" : "fine"} pointer: Ctrl+Enter and Cmd+Enter send (a hardware keyboard on a tablet)`, async () => {
      const { context, page } = await openPage(touch ? PHONES[1] : VIEWPORTS[3], { touch });
      await page.focus("#composer");
      await page.keyboard.type("one");
      await page.keyboard.press("Control+Enter");
      await page.keyboard.type("two");
      await page.keyboard.press("Meta+Enter");
      const sent = await page.evaluate(() => [...window.__sent]);
      await context.close();
      assert.deepEqual(sent, ["one", "two"]);
    });

    test(`${touch ? "coarse" : "fine"} pointer: an Enter with keyCode 229 or isComposing never sends, even with Ctrl or Cmd`, async () => {
      const { context, page } = await openPage(touch ? PHONES[1] : VIEWPORTS[3], { touch });
      await page.focus("#composer");
      await page.keyboard.type("draft");
      const codes = await page.evaluate(() => {
        const box = document.querySelector("#composer");
        const seen = [];
        for (const init of [{}, { ctrlKey: true }, { metaKey: true }]) {
          // Safari's composition-committing keydown: isComposing false, keyCode 229.
          const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
          Object.defineProperty(event, "keyCode", { value: 229 });
          box.dispatchEvent(event);
          seen.push(event.keyCode);
          box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true, ...init }));
        }
        return seen;
      });
      const sent = await page.evaluate(() => [...window.__sent]);
      await context.close();
      assert.deepEqual(codes, [229, 229, 229]);
      assert.deepEqual(sent, [], "an IME Enter sent the draft");
    });
  }

  test("phone-360 touch: the composer placeholder stays on one line (ellipsis), and typed text still wraps", async () => {
    const { context, page } = await openPage(PHONES[0], { touch: true });
    const empty = await page.evaluate(() => getComputedStyle(document.querySelector("#composer")).whiteSpace);
    await page.focus("#composer");
    await page.keyboard.type("typed text");
    const typed = await page.evaluate(() => getComputedStyle(document.querySelector("#composer")).whiteSpace);
    await context.close();
    assert.equal(empty, "nowrap");
    assert.notEqual(typed, "nowrap", "typed text no longer wraps");
  });

  test("phone-390 touch: the rail's thread list keeps about four and a half 44 px rows in view", async () => {
    const { context, page } = await openPage(PHONES[1], { touch: true });
    await page.tap(".dock button >> nth=0");
    await page.waitForSelector(".chat-list");
    const list = await page.evaluate(() => ({ max: parseFloat(getComputedStyle(document.querySelector(".chat-list")).maxHeight), row: document.querySelector(".chat-list li").getBoundingClientRect().height }));
    await context.close();
    assert.ok(list.row >= 44, `a thread row is ${list.row}px`);
    assert.ok(list.max / list.row >= 4.4, `the list shows ${(list.max / list.row).toFixed(1)} rows`);
  });
});
