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

## Workspaces (SB-09)

**Roots.** All four come from `SANDBENCH_HOME` (`/srv/sandbench` in the image) and are created when the runner starts:

| Root | Holds | Read | Write |
| --- | --- | --- | --- |
| `workspace/` | the page's own folder (the owner context, no agent) | the page | the page |
| `shared/` | handoff notes, repo clones | every agent | agents only under `shared/handoff/` |
| `agents/<slug>/` | an agent's own folder | that agent | that agent |
| `wt/<slug>/<repo>/<branch>/` | that agent's git worktrees | that agent | that agent |

**Rules** (`runner/workspace/paths.mjs`, `resolveWorkspacePath(roots, agentSlug, path, { write })`):
- Paths are relative. Absolute paths, drive letters, backslashes, null bytes and any `..` segment are refused.
- For an agent, a path starting `shared/` or `wt/<slug>/` names that root; anything else is inside its own folder, so another agent's folder can't even be named. Another agent's worktree is neither readable nor writable.
- Links are followed: a path that leads out of its root through a symlink is refused, and so is a link that points at nothing yet (writing through it would create its target).
- The slug comes from the server, never from a request. Until SB-03 passes it from the job, every page call (`/api/workspace/*`, `/api/exec`, `/api/turns`) is the owner context and works exactly as before in `workspace/`.
- This is not a sandbox: a shell command can still open any path the runner's user can. The fix is decided and comes with SB-29; see [Agent isolation](#agent-isolation-decided-sb-29).

**Worktrees** (`runner/workspace/worktrees.mjs`). Repos come from an allowlist in `SANDBENCH_REPOS`, `name=/absolute/path[#base]` separated by commas, with the base defaulting to `origin/main`, for example `SANDBENCH_REPOS=game=/srv/sandbench/shared/game#origin/main,team=/srv/sandbench/shared/team`. Nothing reads it yet: the `worktree_create` and `worktree_remove` tools that use it come with SB-10.
- `create({ agentSlug, repo, branch })` checks everything before any `git` call (branch names: letters, digits, `._/-`, up to 100 characters, no leading `-`, no `..`, `//`, trailing `/` or `.lock`), fetches, and runs `git worktree add --no-track -b <branch> wt/<slug>/<repo>/<branch> <base>`.
- `remove(...)` refuses another agent's worktree and any worktree with uncommitted changes (never `--force`), and keeps the branch.
- `prune({ olderThanDays: 7 })` finds worktrees whose branch is merged into the base and whose folder hasn't changed for 7 days. **It is a dry run by default.** With `dryRun: false` it runs `git worktree remove` and `git branch -d` (never `--force`, never `-D`). The nightly run is SB-14.

**Still to prove live:** PixelPets and a review agent building in real worktrees on the laptop runner. That needs SB-03 (the slug) and SB-10 (the tools).

## Agent profile, skills and memory (SB-08)

- **Profile:** an agent record's `data` may carry `slug`, `title`, `description`, `capabilities`, `model`, `driver`, `maxSteps`, `budgetUsdDay` and `workspace` (all optional; `Bot` in `src/types.ts`). It is the same JSON row, so there are no column changes.
- **Memory:** `memory_items` in Postgres (`runner/db/migrations/002_memory.sql`), scoped to the signed-in account and the agent's record id. Items are up to 8000 characters. `profile` items go into every prompt; `journal` items are found with full-text search (English stemming: "width" finds "widths").
  - `GET /api/memory?agent=<id>&q=<words>&kind=&limit=` searches, best match first, or lists newest first without `q`.
  - `POST /api/memory` with `{agentId, kind, text}` saves one item (201).
  - Without a database these answer 503.
- **Skills:** `SANDBENCH_TEAM_DIR` is a read-only checkout of the private team repo. In compose it is `/srv/team`, mounted from `SANDBENCH_TEAM_HOST_DIR`, or from the empty `deploy/team-empty` folder when that is unset.
  - `GET /api/skills` lists `.claude/skills/*/SKILL.md` (name and description), and `GET /api/skills/:name` returns one.
  - Both read the files on every call, so editing a skill changes the next turn without a redeploy.
  - Names are lowercase folder names. Links and anything outside the skills folder are refused.
- **Prompt:** `GET /api/prompt/:agentId` shows the system prompt a turn would get now (`runner/agent/prompt.mjs`): the profile description (or the old instructions), the team `AGENTS.md`, the skills index, the profile memory and the 10 newest journal items, in that order. Each section has a size budget and is cut at a word with a marker; the whole prompt is at most 40,000 characters. The turn engine (SB-03) will use the same builder. The inbox summary waits for SB-07.
- **Old file memory** (the harness's `/bots/:id/memory`, unchanged) becomes a one-time import. Each paragraph of `MEMORY.md` and `memory/*.md` becomes a profile item, and each paragraph of `memory/log/YYYY-MM-DD.md` becomes a journal item dated that day. A second run adds nothing. Postgres publishes no port, so run it inside the runner, one bot at a time:
  ```bash
  docker compose -f deploy/compose.yml cp ~/.sandbench/bots/<id> runner:/srv/sandbench/import/<id>
  docker compose -f deploy/compose.yml exec runner node runner/agent/memory-import.mjs --dir /srv/sandbench/import/<id> --agent <id>
  ```
  The agent must already exist as a record on the runner. Add `--owner <uid>` if more than one account has it.
- **Backup:** `docker compose -f deploy/compose.yml exec runner node runner/agent/memory-backup.mjs --out /srv/sandbench/backup` writes `<agent>/profile.md` and `<agent>/journal.md`; copy them into the team repo. The nightly run is SB-14.

## Browser and emulator (SB-13)

The runner image is built on `mcr.microsoft.com/playwright:v1.64.1-noble`, which has headless Chromium and Node 22. `playwright` in `runner/package.json` is pinned to the same version. It adds Java 21 (for the Firebase emulators), `gh`, Python 3 and `firebase-tools` 14. None of this is reachable by agents yet: the `screenshot` and `emulator_*` tools come with SB-10, behind the policy layer (SB-06).

- **Screenshots** (`runner/browser/screenshot.mjs`): `screenshot({ url, outDir, widths = [320, 375, 390], fullPage, waitFor })` saves one PNG per width (`<host>-<width>.png`, at scale 1) and returns `[{ width, path, bytes }]`.
  - `outDir` will be the agent's own folder (SB-09 rules).
  - Saving goes through a `saveImage({ outDir, name, buffer })` → `{ path, bytes }` interface (`runner/browser/images.mjs`), so attachments (SB-18) can plug in later.
- **SSRF rules** (`runner/browser/ssrf.mjs`):
  - Only `http` and `https`, with no user name or password in the URL.
  - Every address the host resolves to must be public. Loopback, private, link-local (including the `169.254.169.254` metadata address), carrier-grade NAT, multicast and reserved ranges are refused, as are IPv4-mapped IPv6, odd numeric IPv4 spellings, `localhost` and `metadata.google.internal`.
  - Chromium's only way out is a local checking proxy, loopback included. So every request, subresource and redirect hop is checked. The proxy connects to the exact address it checked, so a DNS answer that changes in between can't redirect it.
  - `allowHosts` (for example the live game host) and `allowLoopbackFor` (tests) are explicit exceptions.
- **Emulators** (`runner/browser/emulator.mjs`): `emulatorStart({ project })` runs `firebase emulators:start --only auth,firestore,database --project <project>` with a temporary config file (ports 9099, 8180 and 9000 by default, as in the game repo's `firebase.json`), and `emulatorStop` stops it and deletes the file. Only `demo-*` ids are accepted, never one blocked by `runner/guard.mjs` or `SANDBENCH_BLOCKED_PROJECTS`, and `--project` is always passed.
- **Local tests:** `npx playwright install chromium` once in `runner/`. CI installs it before `npm run test:node`.

## Agent isolation (decided, SB-29)

**Why.** Today every shell (`runner/shell.mjs`) and every engine process (`harness/drivers/*.mjs`) runs as the one `node` user in the runner container and inherits its whole environment. Once agents can run commands, an agent could read another agent's folder, read the model keys from its environment or the secrets file, and use `DATABASE_URL` to read every account's rows in Postgres. The SB-09 path rules cannot stop that, because they only cover the runner's own routes.

**Decision (2026-10-27).** One `sandbox` compose service, with one Linux user per agent inside it. It takes the place of the `jobs` service that SB-04 planned (brief, open question 4), so the laptop runs one extra container, not one per agent.

```
            edge network                 sandbox network (no Postgres)
phone ──> runner:8080 ── control API ──> sandbox
            │  keys, secrets file           │  uid per agent, no keys, no DB
            │  /api/model adds the key <────┘  engines call the model through the runner
         internal network
            │
          postgres
```

1. **Where things run.** Every agent shell, detached job and engine process (Claude Code, Codex, Grok CLI) runs in `sandbox`, never in `runner`. The page's own owner-context calls stay in `runner` as today.
2. **One user per agent.** Each agent slug maps to a fixed uid (from 10001 up), chosen by the runner, never from a request. `agents/<slug>/` and `wt/<slug>/` belong to that uid with mode 0700. `shared/` is readable by all agents; only `shared/handoff/` is writable by them. `workspace/` is not mounted in the sandbox.
3. **No secrets in the sandbox.** No API keys in its environment, the secrets file and the Postgres volume are not mounted, and it is not on the `internal` network, so Postgres can't be reached. A spawned process gets an environment built from an allowlist, not a copy of the parent's.
4. **Model calls go through the runner.** Engines point at the runner's `/api/model` (`harness/modelProxy.mjs`), for example with `ANTHROPIC_BASE_URL`, and carry the per-turn token from SB-10. The runner adds the real key. GitHub access comes with SB-11's App tokens, scoped per call.
5. **Control channel.** The runner asks the sandbox to spawn, kill and tail processes over a small authenticated HTTP API on a private compose network. The runner never gets the Docker socket, because that is root on the laptop.
6. **Hardening.** The sandbox process starts as root only to drop into the agent's uid for each spawn (`setpriv --reuid --regid --clear-groups --no-new-privs`). The container runs with `cap_drop: ALL` plus `SETUID`, `SETGID`, `CHOWN` and `KILL`, `no-new-privileges`, and pids and memory limits. Each spawn gets its own process group, which SB-04 needs anyway.
7. **Network out** stays open for git, npm and GitHub. Narrowing it is a follow-up.
8. **Accepted limits.** Agents share the kernel of the laptop's Docker VM, so this is not a VM boundary. Agents can see each other's process list until `/proc` is mounted with `hidepid` (follow-up). One agent can still use up shared CPU within the limits.
9. **Gate.** SB-10 may ship its read-only tools before SB-29. Any tool that runs a shell, writes files or runs git, SB-04's `job_start`, and the engine's own shell tool in runner mode do not merge until SB-29 has merged. SB-06's policy checks stay on top: isolation limits what a command can reach, the policy decides whether it runs at all.

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
- **Logs and computer events** are append-only on the runner. The page shows the newest 40 (newest first by `at`), and an item trimmed from the page is never a delete. The runner keeps them all; deleting a bot deletes its computer events there explicitly. Pruning old ones on the runner is a later item.
- **First load:** when the runner has no records, the device uploads the newer of its own copy and the Firestore copy older builds kept (by `updatedAt`); an empty base is saved first, so an upload cut short resumes on the next load. If another account has already synced from this browser, the local copy is treated as theirs and not uploaded. When a device that has never synced finds records on the runner, the runner's copy replaces its own, and a one-time backup of the old copy is kept in IndexedDB (`backupBeforeRunner:<uid>`).
- **Open one device first.** If two devices open an empty runner at the same moment, both upload, and a record both have keeps the fields of whichever wrote last, even if its copy is older. Let the first device finish loading before opening the second.

## API keys (SB-05)

Model, voice and connector keys are kept on the runner, or on the local harness in local mode, never in the page, IndexedDB sync or Firestore.

- **Where they come from:** environment variables (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `COMPAT_API_KEY`, `DECISION_API_KEY`, `ELEVENLABS_API_KEY`, `FISH_API_KEY`, set in `deploy/.env`) or `/srv/sandbench/secrets.json` (mode 0600, override with `SANDBENCH_SECRETS_FILE`). An environment value wins and can't be changed from the page.
- **Rotation:** the file is re-read on every call, so changing a key in it takes effect on the next request. A changed environment value needs `docker compose up -d runner`. Neither needs a new page build.
- **A broken file is never overwritten:** if `secrets.json` can't be read (a bad hand edit), lookups go on without its keys and every add or remove is refused until it is fixed. Each write keeps the previous file as `secrets.json.bak` (0600).
- **What the page can do:** `GET /api/secrets` lists name, preview (`abcd…yz`), scope and source. `PUT /api/secrets/NAME` and `DELETE /api/secrets/NAME` add or remove a key. No route returns a value.
- **Model calls:** the page sends `POST /api/model` with the provider, endpoint and request body. The runner adds the key and streams the answer back. Only the xAI, OpenAI-compatible, Anthropic and OpenRouter chat endpoints are allowed. On the VM an OpenAI-compatible base must be `https://`, so the runner can't be pointed at its own network.
- **Agent scope:** a key can be `shared` or scoped to one agent slug. A scoped key is hidden from every other agent. The owner's page can still use it.
- **Connectors:** header templates such as `{{COMPOSIO_KEY}}` are filled in on the server.
- **Migration:** a workspace saved by an older build has its keys moved here on the first load that can reach a harness or runner. Until then they wait on that device only, never in the cloud copy. No copy that holds a key (the Firestore copy or the device's own) is rewritten until the key is kept on the device or the server; if neither works, the key stays in memory and the cloud copy is left alone for that session.

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

- `npm run test:node` runs `runner/test/*.test.mjs`, which needs no network and no dependencies. It covers the 401/403 rules, the Origin check, workspace path limits, exec approval and static-file path limits. `workspace.test.mjs` and `worktrees.test.mjs` cover the SB-09 path rules and worktrees, with real `git` on fixture repos in a temp folder.
- `runner/test/data.test.mjs` runs the SB-02 datastore against a real Postgres. Set `TEST_DATABASE_URL` to a database whose name ends in `_test`, because its schema is wiped; without it, the test is skipped. CI runs it in the `Typecheck, test, build` job with a Postgres 17 service, and fails if it was skipped. `runner/test/memory.test.mjs` (SB-08) works the same way, in its own schema, and CI fails if it skips too. `skills.test.mjs` and `prompt.test.mjs` need no database.
- `runner/test/emulator.test.mjs` checks real Firebase ID tokens against the Auth emulator (`demo-sandbench`). CI runs it in the `runner-auth` job.
- The CI `runner-image` job checks that `deploy/compose.yml` is valid and publishes no ports. It also builds the image, starts it, and checks that `/healthz` answers, `/api/health` returns 401 and the page is served.
