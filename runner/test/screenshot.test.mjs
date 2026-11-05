// SB-13 screenshots in real headless Chromium against a local page. Chromium must be installed:
// CI installs it; locally run `npx playwright install chromium` in runner/. Without it this test
// fails with that message rather than skipping.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { SsrfError, screenshot } from "../browser/screenshot.mjs";

let server;
let base;
let tmp;
let metadataHits = 0;

// PNG width is the big-endian uint32 at bytes 16-19 (the IHDR chunk).
const pngWidth = (file) => readFileSync(file).readUInt32BE(16);

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sb-shot-"));
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    // Refused targets on THIS server (localhost is not in allowLoopbackFor), so a request that
    // slips through is counted instead of silently timing out.
    if (req.url === "/redirect-local") {
      res.writeHead(302, { location: `http://localhost:${server.address().port}/meta-data-local` });
      return res.end();
    }
    if (req.url === "/chain") {
      res.writeHead(302, { location: "/redirect-local" });
      return res.end();
    }
    if (req.url === "/sneaky") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end('<!doctype html><title>Sneaky</title><img src="http://169.254.169.254/latest/meta-data/x.png"><p id="ready">hi</p>');
    }
    if (req.url?.includes("meta-data")) metadataHits++;
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Pets</title><body style="margin:0"><h1 id="ready">Walklings</h1></body>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const allow = { allowLoopbackFor: ["127.0.0.1"] };

test("a local page at 320, 375 and 390 px gives three PNGs of those widths", async () => {
  const shots = await screenshot({ url: `${base}/`, outDir: tmp, waitFor: "#ready", allow });
  assert.deepEqual(shots.map((shot) => shot.width), [320, 375, 390]);
  for (const shot of shots) {
    assert.equal(path.dirname(shot.path), tmp);
    assert.equal(path.basename(shot.path), `127-0-0-1-${shot.width}.png`);
    assert.equal(pngWidth(shot.path), shot.width);
    assert.ok(shot.bytes > 100);
  }
});

test("a redirect to the metadata address is refused, and it is never contacted", async () => {
  await assert.rejects(screenshot({ url: `${base}/redirect`, outDir: tmp, widths: [390], allow }), SsrfError);
  await assert.rejects(screenshot({ url: `${base}/sneaky`, outDir: tmp, widths: [390], allow }), SsrfError);
  // A safe first hop that redirects again to a refused address: every hop is checked.
  await assert.rejects(screenshot({ url: `${base}/redirect-local`, outDir: tmp, widths: [390], allow }), SsrfError);
  await assert.rejects(screenshot({ url: `${base}/chain`, outDir: tmp, widths: [390], allow }), SsrfError);
  assert.equal(metadataHits, 0);
});

test("the first URL is checked before Chromium starts", async () => {
  let launched = false;
  const launch = async () => {
    launched = true;
    throw new Error("should not launch");
  };
  await assert.rejects(screenshot({ url: `${base}/`, outDir: tmp, launch }), SsrfError, "loopback without allowLoopbackFor");
  await assert.rejects(screenshot({ url: "file:///etc/passwd", outDir: tmp, allow, launch }), SsrfError);
  assert.equal(launched, false);
});
