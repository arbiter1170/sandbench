# Deploy Sandbench to Vercel (Firebase Auth + sync)

Private Google-gated SPA with Firestore workspace sync. Computer harness/CUA stays on desktop.

**Live (production):** https://sandbench-ten.vercel.app  
**GitHub:** https://github.com/arbiter1170/sandbench (`deploy/vercel` default)  
**Allowlist:** set `VITE_ALLOWED_EMAILS` in the Vercel project's environment variables (never in the repo) — add Firebase web config env vars, authorize the Vercel domain, publish `firestore.rules`, then `vercel --prod` (or push) to bake them in.

## 1. Firebase Console

1. Open your Firebase project → **Authentication** → enable **Google**.
2. **Authentication → Settings → Authorized domains**: add your Vercel domain (`*.vercel.app` and any custom domain).
3. **Project settings → Your apps → Web**: copy the web config into env vars below.
4. **Firestore**: create a database (production mode), then publish rules from [`firestore.rules`](../firestore.rules) in the Firebase console (or `firebase deploy --only firestore:rules` if the CLI is linked).

Rules allow each signed-in user to read/write only `users/{theirUid}/workspace/snapshot`.

## 2. Environment variables

Copy [`.env.example`](../.env.example) to `.env.local` for local dev. On Vercel → Project → Settings → Environment Variables, set:

| Variable | Notes |
|----------|--------|
| `VITE_FIREBASE_API_KEY` | Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Project id |
| `VITE_FIREBASE_APP_ID` | Web app id |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Optional but recommended |
| `VITE_FIREBASE_STORAGE_BUCKET` | Optional |
| `VITE_ALLOWED_EMAILS` | Comma-separated Google emails |

| `VITE_RUNNER_URL` | The runner's API, e.g. `https://sandbench.<tailnet>.ts.net/api`. Leave it unset to use the local harness via the dev proxy |

Vite inlines these at **build** time. Changing the allowlist or the runner URL requires a redeploy.

**The Firebase project must be `sandbench-arbiter`, the same project the runner verifies tokens against.** If the site is built with any other project, every runner call is a 401. Never point the site at one of the off-limits projects. The runner refuses to start with them (`runner/guard.mjs`); the site has no such guard, so check `VITE_FIREBASE_PROJECT_ID` before you deploy. The runner must also list the site's origin in `SANDBENCH_ALLOWED_ORIGINS` (see [runner.md](runner.md#laptop-runner)).

## 3. GitHub + Vercel

- Repo is public; production branch: `deploy/vercel` (merges deploy to production).
- Vercel project: Framework Vite, build `npm run build`, output `dist` (see `vercel.json`).
- After first deploy, add the Vercel URL to Firebase authorized domains.

## 4. Cloud sync behavior

- On sign-in, the app loads IndexedDB, then Firestore `users/{uid}/workspace/snapshot`.
- Newer `updatedAt` wins; the other side is updated.
- Attachments/blobs stay in IndexedDB on the device (not uploaded).
- API keys in Settings sync with the snapshot — treat allowlist as the access boundary.

## 5. iOS Safari QA

- [ ] Allowlisted Google account signs in via redirect and reaches the app.
- [ ] Non-allowlisted Google account sees the private-demo message.
- [ ] Create a bot, send a message with your own model API key.
- [ ] Reload / another Safari tab: workspace still present (cloud or local).
- [ ] Safe areas look correct in portrait and landscape (notch / home indicator).
- [ ] Call / speak does not hang if system voices are empty.
- [ ] Settings shows harness hint when computer control is unavailable.

## Local with Auth

```bash
cp .env.example .env.local
# fill values
npm run dev
```

Add `localhost` / `127.0.0.1` to Firebase authorized domains for local redirect sign-in.
