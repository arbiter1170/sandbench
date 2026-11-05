# Per-PR checklist (Claude runs this top to bottom for every PR)

Paste real output into the PR body and the WORKLOG entry. "I ran it" without output does not count.
Hard rules and STOP points are in `STOP_POINTS.md`; if a step here conflicts with it, `STOP_POINTS.md` wins.

## A. Before you write code

- [ ] `git fetch origin` then `git switch -c <branch-from-the-task> origin/deploy/vercel` (a fresh
      branch every time; never reuse or reset an old one; never stack on an unmerged branch).
- [ ] The task's dependencies are **merged** into `deploy/vercel` (`gh pr list --state merged --limit 20`).
- [ ] `git status` is clean. If it is not and you did not make the changes, STOP.
- [ ] You have read the task's "Touch" and "Do NOT touch" lists. Anything outside "Touch" needs a
      line in the PR body under "Deviations" and, if it is a STOP point, a STOP.
- [ ] Node 22 (`node -v`). CI uses 22. Run the checks in WSL or Git Bash on Windows, not PowerShell.

## B. While you code

- [ ] One PR per task. Keep the diff to the task. No drive-by refactors or formatting passes.
- [ ] Tests first where the task says so (policy, classifiers, path rules).
- [ ] Every new runner **data path** gets a Postgres test, in a file that reads `TEST_DATABASE_URL`
      and that CI asserts "not skipped" (see section C, step 5).
- [ ] No secrets, tokens, private keys, personal emails, machine paths, real tailnet name,
      off-limits Firebase ids, or player data, in code, tests, fixtures, docs, comments or commit
      messages. Test keys are generated in the test. Test emails end in `@example.test`.
- [ ] Project ids and real hostnames appear only in `deploy/.env`, never in the repo. Docs say
      "Sandbench's own project (`FIREBASE_PROJECT_ID` in `deploy/.env`)".
- [ ] Migrations: new file `runner/db/migrations/NNN_name.sql` matching `^\d+_[\w-]+\.sql$`;
      additive only; never edit a merged migration; update the list asserted in
      `runner/test/data.test.mjs` (`assert.deepEqual(await migrate(sql), [...])`).
- [ ] Runner code that must run in the container lives under `runner/` or `harness/` (the Dockerfile
      copies only `harness`, `runner` and `dist`), not under `scripts/`.
- [ ] No new network calls with a real key in tests. Fake the model, GitHub and browsers.
- [ ] **Mutation check:** for each safety fix or rule you add (path checks, SSRF, policy rules), switch it off once, see its test
      fail, switch it back. Paste the result in the PR body.

## C. Commands to run locally (all must pass; copy the output)

Run from the repo root. Docker is needed for steps 5 and 7.

```bash
# 1. Install (Node 22)
node -v
npm ci --no-audit --no-fund
npm ci --prefix runner --no-audit --no-fund

# 2. Typecheck, web tests, node tests (what the "Typecheck, test, build" job runs)
npm run typecheck
npm run test:web
npm run test:node          # if your Node is not 22 the glob may not expand: list the test files explicitly

# 3. Build and the bundle-key check
npm run build
if grep -rEn 'sk-ant-[A-Za-z0-9]|xai-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9]' dist/; then echo "KEY IN BUNDLE"; fi

# 4. Throwaway Postgres, same as CI (Postgres 17; password is a throwaway)
docker rm -f sb-test-pg 2>/dev/null
docker run -d --name sb-test-pg -e POSTGRES_USER=sandbench -e POSTGRES_PASSWORD=ci-only \
  -e POSTGRES_DB=sandbench_test -p 127.0.0.1:5432:5432 postgres:17-bookworm
until docker exec sb-test-pg pg_isready -U sandbench -d sandbench_test; do sleep 1; done
export TEST_DATABASE_URL=postgres://sandbench:ci-only@127.0.0.1:5432/sandbench_test

# 5. DB tests must RUN, not skip. Do this for data.test.mjs and for EVERY new DB test file:
set -o pipefail
node --test runner/test/data.test.mjs 2>&1 | tee /tmp/data.log && grep "^# skipped 0" /tmp/data.log
# (a new DB test file gets the same two-line check; add it to the existing step
#  "The datastore tests ran (not skipped)" in .github/workflows/ci.yml, inside that job only)
npm run test:node          # again, now with TEST_DATABASE_URL set, so the DB tests run in the full suite

# 6. Auth emulator job (only if you touched runner auth/CORS: but that is a STOP point)
#    cd runner/test/emulator && npx --yes firebase-tools@14 emulators:exec --only auth --project demo-sandbench "node --test ../emulator.test.mjs"

# 7. Runner image and compose file (needed whenever you touch runner/Dockerfile, deploy/ or runner/package.json)
FIREBASE_PROJECT_ID=demo-sandbench SANDBENCH_ALLOWED_EMAILS=ci@example.test \
SANDBENCH_PUBLIC_ORIGIN=https://sandbench.example.test POSTGRES_PASSWORD=ci-only \
CLOUDFLARE_TUNNEL_TOKEN=ci-only TS_AUTHKEY=ci-only bash -c '
  docker compose -f deploy/compose.yml config -q
  for p in laptop cloudflare; do docker compose -f deploy/compose.yml --profile $p config -q; done
  test "$(docker compose -f deploy/compose.yml --profile laptop config --services | sort | tr "\n" " ")" = "postgres runner tailscale "
  test "$(docker compose -f deploy/compose.yml --profile cloudflare config --services | sort | tr "\n" " ")" = "cloudflared postgres runner "
'
if grep -nE '^\s+ports:' deploy/compose.yml; then echo "A SERVICE PUBLISHES A PORT"; fi
docker build -f runner/Dockerfile -t sandbench-runner:ci .
# The image must still start with NO database url and NO secrets, and /api/health must answer 401:
docker rm -f runner-ci 2>/dev/null
docker run -d --name runner-ci -p 127.0.0.1:8080:8080 -e FIREBASE_PROJECT_ID=demo-sandbench \
  -e SANDBENCH_ALLOWED_EMAILS=ci@example.test -e FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 sandbench-runner:ci
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8080/healthz && break; sleep 1; done
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)" = 401
docker logs runner-ci; docker rm -f runner-ci

# 8. Secret scan, as CI runs it (full history), plus the email check
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --redact --no-banner --exit-code 1
if git ls-files -z -- . ':!:package-lock.json' ':!:runner/package-lock.json' \
   | xargs -0 grep -nEI '[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|proton|protonmail)\.[a-z]{2,}'; then echo "PERSONAL EMAIL"; fi

# 9. Clean up
docker rm -f sb-test-pg
```

If the gitleaks volume mount fails on Windows, run the same command from WSL. If Docker is not
available, say so in the PR body and rely on CI for steps 7 and 8; never write "passed" for a step
you did not run.

Also scan **your diff** for things the CI patterns do not catch (run them on `git diff origin/deploy/vercel`):
the real tailnet name (anything ending `.ts.net` other than `<your-tailnet>`), Firebase project ids other
than `demo-*`, absolute paths with a user name, and any `.env` contents.

## D. Commit and push

- [ ] Normal commits with clear messages. Commit author is whatever Claude Code is configured as; do not
      add personal email addresses to config or messages.
- [ ] `git push -u origin <branch>`. Never `--force`, never `--force-with-lease`, never `rebase`.
- [ ] Open the PR: `gh pr create --base deploy/vercel --head <branch> --title "<title from the task>" --body-file <file>`.
      If `gh` is not signed in, STOP (needs Vincent).

## E. PR body template

```markdown
## What
<one paragraph: the task id and what this PR adds>

## Plan item
<SB-xx per PLAN.md, handoff task Txx, files Touch list respected: yes/no>

## Checks run locally (real output pasted below)
- typecheck: <result>
- vitest (`npm run test:web`): <N passed>
- node tests (`npm run test:node`): <N passed, N skipped>
- DB tests on Postgres (`# skipped 0`): <result, file names>
- build + bundle key check: <result>
- compose + image (if touched): <result>
- gitleaks + email grep: <result>

## Live check still needed (so the PLAN box stays unticked)
<exactly what Vincent should try on the laptop runner, or "none">

## Deviations
<anything outside the task's Touch list, or any handoff-vs-brief disagreement; "none" if none>

## Not covered
<what this PR deliberately does not do>

Handoff: WORKLOG entry in this PR. Vincent: merge only after the 4 required checks are green on the head commit (docs/parity/handoff/MERGE_GUIDE.md).
```

## F. After the PR is open

- [ ] Wait for the 4 required checks on the **final head sha** (`gh pr checks <n> --watch`). Required:
      `Typecheck, test, build`, `Runner sign-in checks (Auth emulator)`,
      `Runner image and compose file`, `Secret scan`. Vercel's preview checks should also be green; if
      only Vercel fails and the cause is fork protection or a preview limit, note it and tell Vincent
      (it is not a required check).
- [ ] If a check fails: read the log (`gh run view <run-id> --log-failed`), fix with a NEW commit, push.
      Two different failed fixes for the same failure is a STOP.
- [ ] To catch up with `deploy/vercel`: `git fetch origin && git merge origin/deploy/vercel` (merge
      commit, never rebase). Conflicts in `WORKLOG.md` and `STATUS.md`: keep both sides, newest entry first.
      Conflicts anywhere else: resolve only if trivial, otherwise STOP.
- [ ] Never merge the PR yourself. Vincent merges (see `MERGE_GUIDE.md`).

## G. Session end (every session, even a STOP)

- [ ] `PLAN.md` Progress log: one new line at the end of the log for this PR (date, SB id, PR number,
      what is built, what is pending live). Do not tick plan boxes.
- [ ] `docs/parity/handoff/WORKLOG.md`: new entry at the **top**, using the template there.
- [ ] `docs/parity/handoff/STATUS.md`: rewritten (task states, open PRs, blockers, last updated time ET).
- [ ] The WORKPLAN checkbox for the task: tick it only when its PR is **merged** (next session does that).
- [ ] Log commit pushed, and the 4 checks are green again on the final head. Report that head sha.
