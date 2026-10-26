// Model calls from the page (SB-05). The page sends the provider, the endpoint and the
// request body; the server adds the API key from the secret store and streams the
// provider's answer back. The page never holds or sends a key.
const PROVIDERS = {
  xai: { secret: "XAI_API_KEY", base: "https://api.x.ai/v1", paths: ["/chat/completions"], auth: "bearer" },
  openai_compat: { secret: "COMPAT_API_KEY", base: null, paths: ["/chat/completions"], auth: "bearer" },
  anthropic: { secret: "ANTHROPIC_API_KEY", base: "https://api.anthropic.com/v1", paths: ["/messages"], auth: "anthropic" },
  openrouter: { secret: "DECISION_API_KEY", fallback: "COMPAT_API_KEY", base: "https://openrouter.ai/api/v1", paths: ["/chat/completions"], auth: "bearer" },
};

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

/** Which provider each stored key unlocks, so the page can tell what is ready. */
export function providerSecret(provider) {
  return PROVIDERS[provider]?.secret ?? null;
}

export function resolveTarget({ provider, base, path }, { allowLocal = false } = {}) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error("Unknown model provider.");
  if (!spec.paths.includes(path)) throw new Error("That model endpoint is not allowed.");
  let root = spec.base;
  if (provider === "openai_compat" || (provider === "xai" && base)) {
    const trimmed = String(base || "").trim().replace(/\/$/, "");
    if (trimmed && (trimmed.startsWith("https://") || (allowLocal && LOCAL.test(trimmed)))) root = trimmed;
    else if (provider === "openai_compat") throw new Error(allowLocal ? "The API base URL must start with https:// or point at this computer." : "The API base URL must start with https://.");
  }
  return { spec, url: `${root}${path}` };
}

/**
 * Proxy one model request. `body` is { provider, base?, path, payload }. Writes the
 * provider's status, content type and body (streamed) to `res`.
 */
export async function proxyModel(body, res, { store, agent, allowLocal = false, signal, fetchImpl = fetch } = {}) {
  let target;
  try {
    target = resolveTarget(body ?? {}, { allowLocal });
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ error: error.message }));
  }
  const { spec, url } = target;
  const key = store.get(spec.secret, { agent }) || (spec.fallback ? store.get(spec.fallback, { agent }) : null);
  if (!key) {
    res.writeHead(409, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ error: `No ${spec.secret} is stored on this server. Add it under Settings > Keys.`, secret: spec.secret }));
  }
  const headers = { "content-type": "application/json" };
  if (spec.auth === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  if (body.provider === "openrouter") headers["X-Title"] = "Sandbench";
  const upstream = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body.payload ?? {}), signal });
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
    "cache-control": "no-store",
  });
  if (!upstream.body) return res.end();
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}
