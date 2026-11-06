// Browser layout checks for the chat page in real headless Chromium. It lives with the runner's
// tests because Playwright and its Chromium are the runner's (CI installs them for SB-13; locally
// run `npx playwright install chromium` in runner/). The page under test is the fixture in
// src/layout-fixture (the real Workspace shell, real styles, fixed messages), built with Vite into
// a temp folder and served from 127.0.0.1. No harness, no sign-in, no network beyond loopback.
//
// What it asserts, at phone widths and on the desktop with the side panel: the page and the
// message list never scroll sideways, every bubble holds its own content (long inline Windows
// paths, separators, links), approval cards stay inside their bubble with their buttons on
// screen, and only the preformatted tool output scrolls, inside its own panel.
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
        command: { right: rect(card.querySelector("code")).right },
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
