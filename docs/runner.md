# Sandbench runner (SB-01)

The runner is the hosted version of the local harness. It runs on one small VM in Docker and serves the Sandbench page and its API from the same address. The only way in is a Cloudflare Tunnel, behind Cloudflare Access.

```
phone / laptop ──https──> Cloudflare Access (Google sign-in, allowlist)
                     └──> Cloudflare Tunnel ──> runner:8080  (page + /api)
                                                    └── postgres (internal network only)
```

## What is checked, and where

1. **Cloudflare Access** lets in only the allowed Google accounts. This is the outer gate.
2. **The runner** checks every `/api` call again (`runner/api/auth.mjs`):
   - no token, or a token that isn't valid: **401**;
   - a valid token for an account that isn't on `SANDBENCH_ALLOWED_EMAILS`, or whose email isn't verified: **403**;
   - a request with an `Origin` that isn't `SANDBENCH_PUBLIC_ORIGIN`: **403**.
3. **No ports are open.** `deploy/compose.yml` publishes no ports, and CI fails if one is added. Postgres sits on a network with no route out.
4. The runner **refuses to start** with an empty allowlist or with one of the off-limits Firebase projects.

`/healthz` answers `{ok:true}` without a token, for Docker's health check only. `/api/health` needs a token and shows the VM host.

## Routes so far

`/api/health`, `/api/drivers`, `/api/turns`, `/api/turns/:id/interrupt`, `/api/permissions/:id`, `/api/events`, `/api/workspace/read`, `/api/workspace/write` and `/api/exec`. They're ported from `harness/server.mjs` and use the same driver and turn code (`harness/drivers`, `harness/turns.mjs`). Commands run in bash inside `/srv/sandbench/workspace`, still with the 30-second limit; SB-04 adds long jobs.

Screen capture, input, the process list and text-to-speech stay in the local harness, because the VM has no desktop. Skills, memory, schedules, triggers and MCP move to the runner in SB-08, SB-14, SB-15 and SB-22.

## The page in runner mode

Building the page with `VITE_RUNNER_URL=/api` makes `src/harness.ts` call the runner and send the signed-in user's Firebase ID token. Without it, the page uses the local harness through the Vite proxy as before. The runner image builds the page this way on its own.

## Setting up the VM (Vincent)

1. **Firebase:** create Sandbench's own project, turn on Google sign-in, and add the tunnel hostname under Authentication > Settings > Authorized domains. Copy the web app config.
2. **Cloudflare (free plan):** add a domain, then go to Zero Trust > Networks > Tunnels and create a tunnel. Give it a public hostname such as `sandbench.<domain>` that points at `http://runner:8080`, and copy the tunnel token. Under Access > Applications, add a self-hosted app for that hostname with Google as the identity provider, and a policy that lets in only your email.
3. **VM:** create a Hetzner Cloud **CX43** (Ubuntu 24.04, an EU location) with an SSH key. In its Hetzner firewall, allow inbound SSH only from your IP, or nothing at all if you use Cloudflare for SSH later. Then install Docker and set up the runner:
   ```bash
   git clone https://github.com/arbiter1170/sandbench && cd sandbench
   cp deploy/.env.example deploy/.env && nano deploy/.env   # fill it in; never commit it
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
- `runner/test/emulator.test.mjs` checks real Firebase ID tokens against the Auth emulator (`demo-sandbench`). CI runs it in the `runner-auth` job.
- The CI `runner-image` job checks that `deploy/compose.yml` is valid and publishes no ports. It also builds the image, starts it, and checks that `/healthz` answers, `/api/health` returns 401 and the page is served.
