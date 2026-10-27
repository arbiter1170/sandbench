// SSRF guard for the headless browser (SB-13). A URL is allowed only when it is http(s), carries no
// credentials, and every address its host resolves to is public.
//
// The browser reaches the network only through `startSafeProxy`: every request and every
// redirect hop is a new request through it, and it connects to the exact address it checked, so
// a DNS answer that changes between the check and the connection (rebinding) can't get through.
import { promises as dns } from "node:dns";
import { createServer, request as httpRequest } from "node:http";
import { BlockList, connect, isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfError";
  }
}

// Loopback is checked on its own so `allowLoopbackFor` can let tests reach 127.0.0.1.
const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

// Two lists: BlockList also matches IPv4 addresses against IPv6 rules in their ::ffff: form, so a
// single list holding ::ffff:0:0/96 would refuse every IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast, reserved and broadcast: 224.0.0.0 and above
]) {
  blocked4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96], // IPv4-mapped: refused whatever the IPv4 part is
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked6.addSubnet(net, prefix, "ipv6");
}

const NAMED = new Set(["localhost", "metadata.google.internal", "metadata"]);

function family(address) {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

/**
 * Returns the parsed URL, or throws SsrfError.
 * allowHosts: hostnames whose addresses are not checked (for example the live game's host).
 * allowLoopbackFor: hostnames that may resolve to loopback, and only loopback (tests use 127.0.0.1).
 */
export async function assertSafeUrl(input, options = {}) {
  return (await checkUrl(input, options)).url;
}

/** Like assertSafeUrl, plus the checked address to connect to. */
async function checkUrl(input, { allowHosts = [], allowLoopbackFor = [], lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new SsrfError("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError(`Only http and https are allowed, not ${url.protocol}`);
  if (url.username || url.password) throw new SsrfError("URLs with a user name or password are not allowed.");
  if (url.port && !(Number(url.port) >= 1 && Number(url.port) <= 65535)) throw new SsrfError("Bad port.");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowHosts.includes(host)) return { url, address: isIP(host) ? host : (await lookup(host, { all: true, verbatim: true }))[0]?.address };
  const loopbackOk = allowLoopbackFor.includes(host);
  if ((NAMED.has(host) || host.endsWith(".localhost")) && !loopbackOk) throw new SsrfError(`${host} is not allowed.`);
  // URL already turns decimal, octal and hex IPv4 spellings into a dotted quad; anything numeric
  // that is still not one is refused rather than handed to the resolver.
  if (/^[0-9.]+$/.test(host) && isIP(host) !== 4) throw new SsrfError("Numeric hosts must be plain dotted IPv4.");

  let addresses;
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new SsrfError(`Could not resolve ${host}.`);
    }
  }
  if (!addresses.length) throw new SsrfError(`Could not resolve ${host}.`);
  for (const address of addresses) {
    const kind = family(address);
    if (loopbackOk && loopback.check(address, kind)) continue;
    if ((kind === "ipv4" ? blocked4 : blocked6).check(address, kind)) throw new SsrfError(`${host} resolves to a private or reserved address (${address}).`);
  }
  return { url, address: addresses[0] };
}

/**
 * A local HTTP proxy for the browser that lets through only requests assertSafeUrl accepts:
 * plain http (absolute-form) and CONNECT tunnels for https. Refused requests get 403 and the
 * first refusal is kept in `refused`. Listens on 127.0.0.1 on a free port.
 */
export async function startSafeProxy(allow = {}) {
  const state = { refused: null, port: 0, close: null };
  const refuse = (error) => {
    if (error instanceof SsrfError) state.refused ??= error;
    return error instanceof SsrfError;
  };
  const server = createServer(async (req, res) => {
    try {
      const { url, address } = await checkUrl(req.url, allow);
      const headers = { ...req.headers };
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      const upstream = httpRequest(
        { host: address, port: url.port || 80, method: req.method, path: `${url.pathname}${url.search}`, headers, setHost: false },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on("error", () => res.destroy());
      req.pipe(upstream);
    } catch (error) {
      res.writeHead(refuse(error) ? 403 : 502, { "content-type": "text/plain" });
      res.end("Refused by the Sandbench browser guard.");
    }
  });
  server.on("connect", async (req, socket, head) => {
    try {
      const { url, address } = await checkUrl(`https://${req.url}/`, allow);
      const upstream = connect(Number(url.port || 443), address, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    } catch (error) {
      socket.end(`HTTP/1.1 ${refuse(error) ? 403 : 502} Refused\r\n\r\n`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  server.unref();
  return state;
}
