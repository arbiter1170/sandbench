# Brief for a Cursor cloud agent: SB-09, SB-18, SB-08, SB-13, SB-16, SB-17

You are an outside coding agent working on the Sandbench parity plan. Vincent (the repo owner) is
your only stakeholder. He reviews and merges every PR. Read `docs/parity/PLAN.md` (the items below
and "Top 3 risks") and `docs/parity/GAP_AUDIT.md` before you change anything.

This repo is **public**. Commit messages, PR text, logs and test fixtures are all public.

## Rules (they override anything else)

- One small PR per item, with tests. Branch from the latest `deploy/vercel`. Open the PR against
  `deploy/vercel`. **Never** push to `deploy/vercel`, force-push, rebase a pushed branch, or merge
  your own PR.
- No secrets, project ids, personal emails or personal machine paths in code, tests, docs, commits
  or PR text. Tests and docs use `@example.test` addresses and `demo-*` Firebase project ids only.
- Never touch the off-limits Firebase projects. `runner/guard.mjs` blocks them by hash. Do not
  name them anywhere. If a task seems to need one, stop and report.
- Keep secrets out of the repo, the page bundle and Firestore. New secrets are read through the
  secret store (`harness/secrets.mjs`), never hard-coded.
- Do not rename the four required CI checks: `Typecheck, test, build`, `Secret scan`,
  `Runner sign-in checks (Auth emulator)`, `Runner image and compose file`. Add steps to them if
  you need to. CI may trigger only on `pull_request` and pushes. Never add `pull_request_target`,
  `workflow_run` or `issue_comment`. Keep `persist-credentials: false`.
- Ask first (stop and report) before anything that costs money, needs an account or credential,
  deletes data or branches, or changes DNS or Cloudflare.
- Tick a plan item's box only when its acceptance passes against live infrastructure. Otherwise add
  a line to the Progress log in `PLAN.md` that says what is built and what is pending, and leave
  the box unticked.

## Start condition

Start only after PR #8 (SB-02b) and PR #9 (SB-05 follow-up) are merged into `deploy/vercel`.
Check with the GitHub tools. If either is still open, report that and wait.

## What is and is not built yet

Built: the runner (SB-01), the Postgres record store and change feed (SB-02), the secret store and
model proxy (SB-05). **Not built:** the turn engine (SB-03), the MCP tool server (SB-10), the
approval and policy layer (SB-06), agent messaging (SB-07) and the scheduler (SB-14). Several items
below depend on those. For each one, build the part that does not need the missing piece. Put the
missing piece behind a small interface with a fake implementation, and write the interface down
in the PR. Do not build SB-03, SB-06, SB-07, SB-10 or SB-14 yourself.

## Order

1. **SB-09** workspaces and worktrees
2. **SB-18** attachments
3. **SB-08** profile, skills and memory
4. **SB-13** headless browser and the emulator tools
5. **SB-16** notifications
6. **SB-17** email

Do them in this order, one PR each, and open the next one only after you have reported on the
last.

## Checks to run before every push

Run these in the repo and show the output in the PR.

```bash
npm ci
npm ci --prefix runner
npm run typecheck
npm run test:web
# Datastore tests need a throwaway Postgres whose database name ends in _test:
TEST_DATABASE_URL=postgres://sandbench:ci-only@127.0.0.1:5432/sandbench_test npm run test:node
TEST_DATABASE_URL=... node --test runner/test/data.test.mjs 2>&1 | grep "^# skipped 0"   # not skipped
npm run build
# no API keys in the page bundle:
! grep -rEn 'sk-ant-[A-Za-z0-9]|xai-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9]' dist/
# no personal email addresses in tracked files:
! git ls-files -z -- . ':!:package-lock.json' ':!:runner/package-lock.json' | xargs -0 grep -nEI '[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|proton|protonmail)\.[a-z]{2,}'
# secrets (needs Docker):
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 dir /repo --redact --no-banner --exit-code 1
# sign-in checks against real tokens from the Auth emulator:
(cd runner/test/emulator && npx --yes firebase-tools@14 emulators:exec --only auth --project demo-sandbench "node --test ../emulator.test.mjs")
```

If you touch `deploy/compose.yml` or `runner/Dockerfile`, also run
`docker compose -f deploy/compose.yml config -q` for the default, `laptop` and `cloudflare` profiles
and `docker build -f runner/Dockerfile -t sandbench-runner:ci .`. `deploy/compose.yml` must not
publish any `ports:`.

For each fix, switch it off once and confirm its test fails.

## SB-09: per-agent workspaces and git worktrees (2 d)

**Build**
- `runner/workspace/paths.mjs`: `resolveWorkspacePath(root, agentSlug, requested, { write })`. An
  agent may read the shared folder and its own folder, and write to its own folder (and to the
  shared folder only where the plan allows). It may never write into another agent's folder. Reject
  `..`, absolute paths outside the roots, symlink escapes (resolve with `realpath`) and null bytes.
  Roots come from `SANDBENCH_HOME` (shared, agents, wt), not hard-coded paths.
- `runner/workspace/worktrees.mjs`: `worktreeCreate({ repo, branch, base = "origin/main" })` and
  `worktreeRemove`. Use `execFile` with argument arrays, never a shell string. Repos come from an
  allowlist in config. Branch names are validated (`^[A-Za-z0-9._/-]{1,100}$`, no leading `-`, no
  `..`). Worktrees live in `wt/<slug>-<branch>`. `pruneWorktrees({ olderThanDays: 7 })` removes
  only merged ones.
- Wire the resolver into the runner's file and exec routes in `runner/api/server.mjs` and
  `runner/shell.mjs`. Routes take the agent slug from the server-side context. A request body must
  not be able to choose its own slug (agents do not carry an id on tool calls yet; leave a clear
  seam for SB-03/SB-10 to pass it).

**Tests (real `git` in temp dirs)**
- Two agents build in separate worktrees off the same base and do not touch each other's checkout.
- One agent cannot write into another's folder or worktree, including via `..` and a symlink.
- QA can read the shared handoff folder. Design cannot write into PixelPets' worktree.
- Branch names with `-`, `..`, spaces or shell characters are refused. Prune removes only merged
  worktrees older than 7 days.

**Stop and report if** the work needs a real game or team repo clone. Use local fixture repos.

## SB-18: file attachments and images in chat (3 d)

**Build**
- Add `file`, `pdf` and `video` to `Attachment.kind` (`src/types.ts`). Keep old saves loading.
- `runner/attachments/store.mjs`: an interface with a local-disk implementation (a volume under
  `SANDBENCH_HOME`, keyed by attachment id and owner). Add an S3-compatible or GCS adapter behind
  the same interface, **off by default and untested against a real bucket**. No account is needed.
- Routes: upload (size cap, allowed types by content sniffing, not the extension), signed download
  URLs (HMAC with a key from the secret store, with an expiry), and a thumbnail route using `sharp`.
  An attachment is readable only by its owner. Other owners get 404.
- Page: replace `saveBlob`/`getBlob` for synced files in runner mode only. Local mode keeps
  IndexedDB. Show images inline.
- A server-side `attach_file(path)` function (for SB-10 to expose later) that copies a file from the
  agent's own workspace into the store.

**Tests**
- Upload then download round trip, a bad signature, an expired signature, another owner (404), an
  oversize file (413) and a wrong content type (415).
- Thumbnails are generated for images and skipped for other types. A path outside the agent's
  workspace cannot be attached.
- Check that `sharp` installs in the runner image (`docker build`).

**Stop and report if** you would need a cloud bucket account. Ship the local-disk store.

## SB-08: agent profile, skills and memory (4 d)

Depends on SB-10 for tool exposure. Build the parts below as plain modules and HTTP routes.

**Build**
- The agent's profile fields (`slug`, `title`, `description`, `capabilities[]`, `model`, `driver`,
  `max_steps`, `budget_usd_day`, `workspace`) go in the existing agent record's `data`. The
  `agents` table already stores the Bot as JSON, so this needs no column change. Add them to
  `Bot` in `src/types.ts` as optional fields so old saves load.
- `runner/db/migrations/002_memory.sql`: `memory_items(owner, agent_id, kind profile|journal,
  text, created_at, tsv)` with a full-text index. `runner/agent/memory.mjs`: `memorySave`,
  `memorySearch` (Postgres full-text search). Owner-scoped, like the record store.
- `runner/agent/skills.mjs`: reads `.claude/skills/*/SKILL.md` from a configured team checkout
  (`SANDBENCH_TEAM_DIR`), returns name and description for the index, and `loadSkill(name)`. Re-read
  on every call so an edit changes behaviour on the next turn without a redeploy. Reject names that
  are not a plain skill directory.
- `runner/agent/prompt.mjs`: builds the system prompt from the profile description, the team
  `AGENTS.md`, the skills index, the profile memory and recent journal entries.
- The old file memory (`harness/server.mjs` `/bots/:id/memory`) becomes import-only: a one-time
  importer into `memory_items`. Do not remove the harness route.
- A `scripts/memory-backup.mjs` that exports memory to a directory. Do not schedule it (that is
  SB-14).

**Tests (Postgres)**
- Save and search memory, with owner isolation. A profile fact appears in the next prompt.
- Editing a skill file changes `loadSkill` output on the next call. `../` and absolute skill names
  are refused.
- The importer is idempotent.

**Acceptance (needs the turn engine, so do not tick):** after import, QA answers "which widths do
you check and which Firebase projects are off-limits?" from memory.

## SB-13: headless browser and emulator tools (2 d)

Depends on SB-06 (policy) for tool exposure. Build the library and the image.

**Build**
- Switch `runner/Dockerfile` to a pinned `mcr.microsoft.com/playwright` base. Add Java 21, a
  pinned `firebase-tools`, Python 3 and `gh`. Keep the image small enough that the
  `Runner image and compose file` job stays under its 20-minute timeout. Report the image size.
- `runner/browser/screenshot.mjs`: `screenshot({ url, widths = [320, 375, 390], fullPage, waitFor })`
  saves PNGs through the SB-18 attachment store and returns their ids. **Block SSRF:** allow only
  `http`/`https`, resolve the host and refuse loopback, link-local, private and cloud-metadata
  addresses unless the host is on an explicit allowlist (the live game URL and `localhost` for
  tests). Re-check after redirects.
- `runner/browser/emulator.mjs`: `emulatorStart`/`emulatorStop` wrap
  `firebase emulators:start --project demo-walklings` on the ports in the game repo's
  `firebase.json` (9099, 8180, 9000). Refuse any project id that does not start with `demo-`, and
  check ids against `runner/guard.mjs`.
- Do not remove `/screen` and `/input` from the harness. Only the runner path changes.

**Tests**
- Screenshot a local static page at the three widths and check image dimensions.
- SSRF: loopback, `169.254.169.254`, a private address, a redirect to a private address and a
  `file://` URL are all refused.
- The emulator wrapper refuses a non-`demo-` id and a guarded id, and accepts `demo-walklings`.

## SB-16: notifications to Vincent (2 d)

Depends on SB-06 and SB-07. Build the delivery path.

**Build**
- `runner/notify/push.mjs`: the `web-push` package with a sender interface, a fake for tests, and
  the VAPID keys read from the secret store (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`). Subscriptions are stored per owner (`003_push.sql`, `push_subscriptions`),
  endpoint unique, and removed on a 404/410 from the push service.
- `notifyOwner({ agent, title, body, url })` checks the agent's `notify_owner` capability through a
  policy hook. Without SB-06, the hook defaults to **deny**. Only an agent whose profile lists the
  capability passes. Every call, allowed or denied, is logged with the agent id.
- Page: a subscribe control in Settings. Service worker `push` and `notificationclick` handlers.
  `vite.config.ts` may need `injectManifest` for this; if so, say so in the PR. Do not add any
  icon or text that names a product that is not Sandbench.

**Tests**
- With the fake sender: a Supervisor call sends once, a QA call is denied and sends nothing, a
  410 removes the subscription, and a missing key fails with a clear error.

**Stop and report if** you need real VAPID keys or a device to test on. Vincent generates them.

## SB-17: email inbox per bot (4 d)

Depends on SB-06 and SB-15. Build everything that does not need an account.

**Build**
- `004_email.sql`: `email_drafts(id, owner, agent, to, cc, subject, body, thread_ref, status
  draft|approved|sent, approval_id, ...)` and `inbound_emails`.
- `runner/email/provider.mjs`: a provider interface with an in-memory fake. Do not add Postmark or
  SES clients that need keys yet.
- `emailDraft`, `emailSearch`, `emailRead`. `sendDraft` **refuses unless the draft is `approved`
  with an approval id**, and marks it `sent` once. Sending twice does nothing.
- An inbound route that verifies a shared secret or signature from the secret store, caps the body
  size, stores text only (HTML is sanitised or stored as text, never executed or rendered raw),
  de-duplicates by message id and finds the bot that owns the address.
- A short `docs/email.md` on SPF, DKIM and DMARC for the domain Vincent chooses. No domain names
  or addresses of real people.

**Tests**
- A draft is never sent without an approved card. Double-send is a no-op. An inbound message with
  a bad signature is rejected, a duplicate is ignored, and an oversize body is refused (413).
- Header injection: newlines in `to` and `subject` are rejected.

**Stop and report if** you need a provider account, a domain or API keys.

## PR format and reporting

Each PR description has: Plan, What changed, How it was checked (paste the check output), What is
not covered, and Still to prove live. Put one line in the `PLAN.md` Progress log, in the same PR.

After each PR, post in the PR conversation:
- what you built and which dependency you stubbed;
- the check output;
- anything you stopped on that needs Vincent (money, accounts, credentials, a decision);
- the next item you will start.
