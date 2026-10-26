# Sandbench runner (SB-01)

The runner is the hosted version of the local harness. It runs in Docker and serves its own copy of the Sandbench page and its API from one address. The Vercel site can also call it across origins. The same `deploy/compose.yml` runs in two places, chosen with `COMPOSE_PROFILES`:

- **`laptop`** (today): Vincent's laptop, reached through **Tailscale Funnel** at a stable `https://<name>.<tailnet>.ts.net` address. See [Laptop runner](#laptop-runner).
- **`cloudflare`** (server later): a VPS behind a Cloudflare named tunnel plus Cloudflare Access. This needs a domain.

```
phone / browser ──https──> Tailscale Funnel (laptop)  or  Cloudflare Access + Tunnel (server)
                                └──> runner:8080  (page + /api: ID token + email allowlist)
                                        └── postgres (internal network only)
```

## What is checked, and where

1. **Cloudflare Access** (cloudflare profile only) lets in only the allowed Google accounts. This is the outer gate. **The laptop profile has no outer gate**; see the warning under [Laptop runner](#laptop-runner).
2. **The runner** checks every `/api` call (`runner/api/auth.mjs`):
   - no token, or a token that isn't valid: **401**;
   - a valid token for an account that isn't on `SANDBENCH_ALLOWED_EMAILS`, or whose email isn't verified: **403**;
   - a browser request whose `Origin` isn't `SANDBENCH_PUBLIC_ORIGIN` or listed in `SANDBENCH_ALLOWED_ORIGINS`: **403**, preflight included. With neither set, every browser `Origin` is refused.
3. **CORS** is answered only for those exact origins: `OPTIONS /api/*` returns 204, and the runner sends `Access-Control-Allow-Origin: <that origin>` and `Vary: Origin`. Only the `authorization`, `content-type` and `x-sandbench-client` headers are allowed. There are no credentials or cookies; the Firebase ID token travels in the `Authorization` header. Wildcards are refused when the runner starts.
4. **The token's project must match.** `verifyIdToken` checks the token against `FIREBASE_PROJECT_ID`, so any page that calls the runner (its own copy, or the Vercel site) must be built with the **same** Firebase project. Otherwise every call is a 401.
5. **No ports are open.** `deploy/compose.yml` publishes no ports, and CI fails if one is added. Postgres sits on a network with no route out.
6. The runner **refuses to start** with an empty allowlist or with one of the off-limits Firebase projects (listed by hash in `runner/guard.mjs`; add more with `SANDBENCH_BLOCKED_PROJECTS`).

`/healthz` answers `{ok:true}` without a token, for Docker's health check only. `/api/health` needs a token and shows the VM host.

## Routes so far

`/api/health`, `/api/drivers`, `/api/turns`, `/api/turns/:id/interrupt`, `/api/permissions/:id`, `/api/events`, `/api/workspace/read`, `/api/workspace/write`, `/api/exec`, plus `/api/secrets` and `/api/model` (see API keys) and the SB-02 record routes (see Records). The first nine are ported from `harness/server.mjs` and use the same driver and turn code (`harness/drivers`, `harness/turns.mjs`). Commands run in bash inside `/srv/sandbench/workspace`, still with the 30-second limit; SB-04 adds long jobs.

Screen capture, input, the process list and text-to-speech stay in the local harness, because the VM has no desktop. Skills, memory, schedules, triggers and MCP move to the runner in SB-08, SB-14, SB-15 and SB-22.

## Records (SB-02)

With `DATABASE_URL` set (compose sets it), the runner keeps the workspace in Postgres as **one row per entity** instead of one snapshot where the newest write wins. Migrations in `runner/db/migrations/` are applied when the runner starts. Without `DATABASE_URL`, these routes return 503 and everything else still works.

- **Kinds:** `agents`, `threads`, `messages` (one row each, no cap per thread), `routines`, and `tasks`, `reminders`, `events`, `contacts`, `logs`, `computer`, `settings`, `studio`. Rows are scoped to the signed-in user's Firebase uid.
- **Routes:**
  - `GET /api/data/:kind` lists records (`?thread=ID` for one thread's messages, oldest first).
  - `GET /api/data/:kind/:id` reads one record.
  - `POST /api/data/:kind` with `{id, data}` creates one.
  - `PATCH /api/data/:kind/:id` with `{version, data}` merges the given fields.
  - `DELETE /api/data/:kind/:id?version=n` deletes one, leaving a tombstone that other devices see.
- **No lost edits:** every row has a version, and an edit must name the version it read. A stale version gets **409** with the current row, so the page reloads that one row and retries. Edits to different rows never collide. Two devices changing different fields of the same row both survive after one retry.
- **Change feed:** `GET /api/stream?since=<seq>` is an SSE stream of changes in commit order, pushed live through Postgres `LISTEN/NOTIFY`. `GET /api/changes?since=<seq>` returns the same changes as JSON, for catching up.
- **The page (SB-02b):** in runner mode (`VITE_RUNNER_URL` set), the page loads these records instead of the Firestore snapshot. Lists are read in pages (`?after=<id>`, id order) until `more` is false, and a load that fails anywhere, messages included, counts as failed. It saves only the records that changed, each with the version it read. On a 409 the other device's fields go to the page and its own changed fields are re-sent on top of the newer version, so edits to different fields on two devices both survive, now and on every later save. Changes from other devices arrive live over `/api/stream`, and only the fields that changed are applied, so an edit still waiting to be saved survives. A delete wins over a concurrent edit. Firestore is no longer written in this mode. `GET /api/changes/head` gives the feed position a device starts from.
- **Offline edits:** IndexedDB keeps this device's copy plus a *base*: the records as the device last agreed with the runner, with their versions. While the runner is unreachable the page keeps working from its copy and retries the load (5 s, doubling to 60 s). When a load gets through, the edits made here (the copy compared with the base) are replayed on top of the runner's copy instead of being replaced by it. The base advances for a record only once the local copy holds the runner's version of it.
- **First load:** when the runner has no records, the device uploads the newer of its own copy and the Firestore copy older builds kept (by `updatedAt`); an empty base is saved first, so an upload cut short resumes on the next load. When a device that has never synced finds records on the runner, the runner's copy replaces its own, and a one-time backup of the old copy is kept in IndexedDB (`backupBeforeRunner`).

## API keys (SB-05)

Model, voice and connector keys are kept on the runner, or on the local harness in local mode, never in the page, IndexedDB sync or Firestore.

- **Where they come from:** environment variables (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `COMPAT_API_KEY`, `DECISION_API_KEY`, `ELEVENLABS_API_KEY`, `FISH_API_KEY`, set in `deploy/.env`) or `/srv/sandbench/secrets.json` (mode 0600, override with `SANDBENCH_SECRETS_FILE`). An environment value wins and can't be changed from the page.
- **Rotation:** the file is re-read on every call, so changing a key in it takes effect on the next request. A changed environment value needs `docker compose up -d runner`. Neither needs a new page build.
- **What the page can do:** `GET /api/secrets` lists name, preview (`abcd…yz`), scope and source. `PUT /api/secrets/NAME` and `DELETE /api/secrets/NAME` add or remove a key. No route returns a value.
- **Model calls:** the page sends `POST /api/model` with the provider, endpoint and request body. The runner adds the key and streams the answer back. Only the xAI, OpenAI-compatible, Anthropic and OpenRouter chat endpoints are allowed. On the VM an OpenAI-compatible base must be `https://`, so the runner can't be pointed at its own network.
- **Agent scope:** a key can be `shared` or scoped to one agent slug. A scoped key is hidden from every other agent. The owner's page can still use it.
- **Connectors:** header templates such as `{{COMPOSIO_KEY}}` are filled in on the server.
- **Migration:** a workspace saved by an older build has its keys moved here on the first load that can reach a harness or runner. Until then they wait on that device only, never in the cloud copy.

If you keep secrets in SOPS or age, decrypt them into `deploy/.env` (or `secrets.json`) on the VM when you deploy. The repo never holds them.

## The page in runner mode

Building the page with `VITE_RUNNER_URL` set makes `src/harness.ts` call the runner and send the signed-in user's Firebase ID token in the `Authorization` header. The event stream uses `fetch`, not EventSource, so it works across origins too. Without `VITE_RUNNER_URL`, the page uses the local harness through the Vite proxy as before.

- **The runner's own page:** the image builds it with `VITE_RUNNER_URL=/api` (same origin).
- **The Vercel site:** set `VITE_RUNNER_URL=https://<runner host>/api` in Vercel and redeploy. The runner must list `https://sandbench-ten.vercel.app` in `SANDBENCH_ALLOWED_ORIGINS`, and both must use the same Firebase project.

## Laptop runner

Today the runner lives on Vincent's laptop (no domain, no server). Moving to a server later means running the same compose file there: copy the `sandbench-data` and `postgres-data` volumes and switch `COMPOSE_PROFILES`.

> **Security: Funnel has no sign-in screen in front of the runner.** Anyone on the internet can reach the ts.net address. The static page and `/healthz` are public. Every `/api/*` call must carry a valid Firebase ID token for an allowed, verified email, or it gets 401 or 403. Those two checks, plus the origin list, are the **only** gate. Keep `SANDBENCH_ALLOWED_EMAILS` to Vincent's account, and never set it empty (the runner refuses to start if it is).

**Steps (Windows; macOS notes in brackets):**

1. **Docker.** Install Docker Desktop with the WSL 2 backend. [macOS: Docker Desktop.] Clone the repo inside WSL (`cd ~ && git clone https://github.com/arbiter1170/sandbench`), not under `C:\`. In Windows power settings, stop the laptop sleeping when plugged in, because the runner is offline whenever the laptop sleeps. [macOS: System Settings > Battery > prevent sleeping when the display is off, on power adapter.]
2. **Tailscale.** Sign up at tailscale.com. In the admin console, turn on **MagicDNS** and **HTTPS certificates** (DNS page). Allow **Funnel** in the access-control policy (a `nodeAttrs` entry with `"attr": ["funnel"]` for `tag:sandbench`, and `tagOwners` for that tag). Create a **reusable, tagged auth key** (Settings > Keys, tag `tag:sandbench`).
3. **Env file.** `cp deploy/.env.example deploy/.env` and fill in:
   - the `sandbench-arbiter` web config (`FIREBASE_PROJECT_ID` and the `VITE_FIREBASE_*` values);
   - `SANDBENCH_ALLOWED_EMAILS`, `POSTGRES_PASSWORD` and `TS_AUTHKEY`;
   - `COMPOSE_PROFILES=laptop`;
   - leave `SANDBENCH_PUBLIC_ORIGIN` empty for now, and set `SANDBENCH_ALLOWED_ORIGINS=https://sandbench-ten.vercel.app`.
4. **Start.** `docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build`. The machine shows up in the Tailscale admin console as `sandbench`. Its address is `https://sandbench.<your-tailnet>.ts.net`, also shown by `docker compose -f deploy/compose.yml --env-file deploy/.env exec tailscale tailscale serve status`. Put it in `SANDBENCH_PUBLIC_ORIGIN` and run the same `up -d` again.
5. **Firebase.** In the `sandbench-arbiter` console, add the ts.net hostname under Authentication > Settings > Authorized domains, so the runner's own page can sign in.
6. **Vercel.** Under Settings > Environment Variables (Production), set `VITE_RUNNER_URL=https://sandbench.<your-tailnet>.ts.net/api` and the `sandbench-arbiter` Firebase web config, then **Redeploy**. The value is inlined at build time.
7. **Check.** From outside, `curl https://sandbench.<tailnet>.ts.net/api/health` gives 401. On a phone, open the ts.net URL and the Vercel URL and sign in on each. The page should show the runner as connected, with your email and the container's host name on `/api/health`.

The address stays the same across restarts, because the Tailscale state lives in the `tailscale-state` volume. If you remove that volume, the machine may come back as `sandbench-1`; rename it in the admin console.

## Server later (cloudflare profile, deferred)

Deferred for now: no domain and no VPS yet. When it's time, the same compose file runs with `COMPOSE_PROFILES=cloudflare`.

1. **Firebase:** in `sandbench-arbiter`, and add the tunnel hostname under Authentication > Settings > Authorized domains. Copy the web app config.
2. **Cloudflare (free plan):** add a domain, then go to Zero Trust > Networks > Tunnels and create a tunnel. Give it a public hostname such as `sandbench.<domain>` that points at `http://runner:8080`, and copy the tunnel token. Under Access > Applications, add a self-hosted app for that hostname with Google as the identity provider, and a policy that lets in only your email.
3. **VM:** create a small VPS (for example a Hetzner Cloud CX43, Ubuntu 24.04) with an SSH key. In its Hetzner firewall, allow inbound SSH only from your IP, or nothing at all if you use Cloudflare for SSH later. Then install Docker and set up the runner:
   ```bash
   git clone https://github.com/arbiter1170/sandbench && cd sandbench
   cp deploy/.env.example deploy/.env && nano deploy/.env   # COMPOSE_PROFILES=cloudflare; never commit it
   docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
   ```
4. **Check it:** open `https://sandbench.<domain>` on your phone, sign in, and open a bot. Then run `curl https://sandbench.<domain>/api/health`. It's stopped at Cloudflare Access, and without Access it would get a 401 from the runner.

## Local development

```bash
FIREBASE_PROJECT_ID=demo-sandbench SANDBENCH_ALLOWED_EMAILS=you@example.com \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run runner     # needs `npm ci --prefix runner`
VITE_RUNNER_URL=/api npm run dev                               # the Vite proxy sends /api/ to :8080
```

## Tests

- `npm run test:node` runs `runner/test/*.test.mjs`, which needs no network and no dependencies. It covers the 401/403 rules, the Origin check, workspace path limits, exec approval and static-file path limits.
- `runner/test/data.test.mjs` runs the SB-02 datastore against a real Postgres. Set `TEST_DATABASE_URL` to a database whose name ends in `_test`, because its schema is wiped; without it, the test is skipped. CI runs it in the `Typecheck, test, build` job with a Postgres 17 service, and fails if it was skipped.
- `runner/test/emulator.test.mjs` checks real Firebase ID tokens against the Auth emulator (`demo-sandbench`). CI runs it in the `runner-auth` job.
- The CI `runner-image` job checks that `deploy/compose.yml` is valid and publishes no ports. It also builds the image, starts it, and checks that `/healthz` answers, `/api/health` returns 401 and the page is served.
