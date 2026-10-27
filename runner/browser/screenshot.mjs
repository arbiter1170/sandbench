// Headless screenshots at phone widths (SB-13). Not exposed yet: the screenshot tool is SB-10,
// which passes `outDir` as the calling agent's own folder (resolved with SB-09's
// resolveWorkspacePath).
//
// Chromium's only way out is the checking proxy from ssrf.mjs (loopback included), so every
// request, every redirect hop and every subresource is checked; Chromium follows redirects without
// telling a page.route handler, which is why a route check alone is not enough. The first refused
// request fails the whole call with SsrfError.
import { chromium } from "playwright";
import { fileSaver } from "./images.mjs";
import { SsrfError, assertSafeUrl, startSafeProxy } from "./ssrf.mjs";

const slug = (host) => host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";

async function launchChromium(proxyPort) {
  try {
    return await chromium.launch({
      headless: true,
      // "<-loopback>" removes Chromium's built-in exception, so loopback goes through the proxy too.
      proxy: { server: `http://127.0.0.1:${proxyPort}`, bypass: "<-loopback>" },
      // No WebRTC traffic outside the proxy.
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
  } catch (error) {
    if (/Executable doesn't exist/.test(String(error?.message))) {
      throw new Error("Chromium is not installed for Playwright. Run `npx playwright install chromium` in runner/ (the runner image already has it).");
    }
    throw error;
  }
}

/** Returns [{ width, path, bytes }], one PNG per width. */
export async function screenshot({ url, outDir, widths = [320, 375, 390], fullPage = true, waitFor, saveImage = fileSaver, allow = {}, launch = launchChromium }) {
  const first = await assertSafeUrl(url, allow);
  if (!Array.isArray(widths) || !widths.length || widths.some((width) => !Number.isInteger(width) || width < 200 || width > 2000)) {
    throw new Error("Widths are whole numbers between 200 and 2000.");
  }
  const proxy = await startSafeProxy(allow);
  const results = [];
  try {
    const browser = await launch(proxy.port);
    try {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
        try {
          const page = await context.newPage();
          try {
            await page.goto(first.href, { timeout: 20_000 });
            if (waitFor) await page.waitForSelector(String(waitFor), { timeout: 10_000 });
          } catch (error) {
            throw proxy.refused ?? error;
          }
          if (proxy.refused) throw proxy.refused;
          const buffer = await page.screenshot({ fullPage, type: "png" });
          const saved = await saveImage({ outDir, name: `${slug(first.hostname)}-${width}.png`, buffer });
          results.push({ width, path: saved.path, bytes: saved.bytes });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await proxy.close();
  }
  return results;
}

export { SsrfError };
