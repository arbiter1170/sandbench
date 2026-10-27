// SB-13 SSRF guard with a fake resolver: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SsrfError, assertSafeUrl } from "../browser/ssrf.mjs";

const DNS = {
  "game.example.test": ["203.0.114.10"],
  "private.example.test": ["10.1.2.3"],
  "mixed.example.test": ["198.51.99.7", "192.168.0.9"],
  "v6.example.test": ["2606:4700::1111"],
  "mapped.example.test": ["::ffff:127.0.0.1"],
  "localhost": ["127.0.0.1"],
};
const lookup = async (host, options) => {
  assert.deepEqual({ all: options.all }, { all: true }, "every address is checked");
  if (!DNS[host]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return DNS[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
const check = (url, extra = {}) => assertSafeUrl(url, { lookup, ...extra });
const refused = async (url, extra) => assert.rejects(check(url, extra), SsrfError, url);

test("loopback, link-local, private and carrier-grade addresses are refused", async () => {
  for (const url of ["http://127.0.0.1/", "http://127.9.9.9:8080/", "http://[::1]/", "http://localhost/", "http://app.localhost/", "http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/", "http://10.0.0.5/", "http://172.16.4.4/", "http://192.168.1.2/", "http://100.64.0.1/", "http://0.0.0.0/", "http://224.0.0.1/", "http://255.255.255.255/", "http://[fe80::1]/", "http://[fd00::1]/"]) {
    await refused(url);
  }
});

test("IPv4-mapped IPv6 and odd IPv4 spellings are refused", async () => {
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://[::ffff:7f00:1]/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/", "http://mapped.example.test/"]) {
    await refused(url);
  }
});

test("a name that resolves to a private address, or to one public and one private, is refused", async () => {
  await refused("https://private.example.test/");
  await refused("https://mixed.example.test/");
  await refused("https://unknown.example.test/");
});

test("non-http schemes and URLs with credentials are refused", async () => {
  for (const url of ["file:///etc/passwd", "ftp://game.example.test/", "javascript:alert(1)", "data:text/html,hi", "https://user:pass@game.example.test/", "https://user@game.example.test/", "not a url"]) {
    await refused(url);
  }
});

test("public addresses are accepted", async () => {
  assert.equal((await check("https://game.example.test/build/?w=390")).hostname, "game.example.test");
  assert.equal((await check("http://v6.example.test:8080/")).port, "8080");
  assert.equal((await check("http://203.0.114.10/")).hostname, "203.0.114.10");
});

test("localhost is accepted only when listed, and only for loopback", async () => {
  await refused("http://localhost:4173/");
  assert.ok(await check("http://localhost:4173/", { allowLoopbackFor: ["localhost"] }));
  assert.ok(await check("http://127.0.0.1:4173/", { allowLoopbackFor: ["127.0.0.1"] }));
  // Listing a host for loopback does not open private ranges for it.
  await refused("http://private.example.test/", { allowLoopbackFor: ["private.example.test"] });
  // allowHosts skips the address check for that exact host only.
  assert.ok(await check("http://private.example.test/", { allowHosts: ["private.example.test"] }));
  await refused("http://mixed.example.test/", { allowHosts: ["private.example.test"] });
});
