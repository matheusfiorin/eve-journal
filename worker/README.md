# EVE backend

GitHub Pages remains the frontend. A Cloudflare Worker handles EVE Authorization Code login with a confidential client, PKCE S256, signed-token validation, encrypted credentials, D1 snapshots, opaque dashboard sessions and scheduled refreshes every 10 minutes per pilot.

Only Fiofka (2124810474) and Decxus (2124815118) may enroll. Each pilot explicitly confirms sharing their skill total and queue on the public dashboard. Wallet, ship, location and industry data require the pilot's opaque dashboard bearer session. No EVE access or refresh tokens are returned to the frontend in backend mode.

## Deployment

GitHub environment **github-pages → Environment secrets** must contain:

- `CLOUDFLARE_API_TOKEN`: Account Workers Scripts Edit, D1 Edit, Account Settings Read, scoped to the intended account.
- `CLOUDFLARE_ACCOUNT_ID`: account ID, not zone ID or email.
- `EVE_CLIENT_SECRET`: secret from the EVE application whose public client ID is `a94f7ccbcc8b4b0d8f7fd90fec110d2b`.

The check and backend deployment jobs explicitly select `github-pages`, so its environment secrets are available.

The Pages workflow validates the application, provisions/reuses `eve-journal` D1, applies migrations, deploys `eve-journal-api`, creates a persistent AES-256-GCM key in Cloudflare if absent, uploads the EVE client secret, verifies health, then publishes Pages with its public backend URL. It does not upgrade the account to a paid plan. Cloudflare product setup, limits, account permissions, and verification must permit Workers/D1 deployment.

The encryption key is never printed or committed. It is preserved across deployments. Do not manually delete or replace it while encrypted authorizations exist, or those authorizations will need to be reconnected.

**After deployment**, the GitHub workflow summary prints the actual Worker callback. Set that exact URL in EVE's developer application:

```
https://<actual-worker-host>.workers.dev/auth/callback
```

Then connect each pilot from Pages. A GitHub secret being present does not prove its value matches the EVE application; real EVE consent is required to verify the complete integration.

## Endpoints

- `GET /health`: database and configuration readiness; no secret values.
- `GET /auth/start?pilot=<id>`: explicit sharing consent screen.
- `POST /auth/start`: CSRF-checked EVE OAuth redirect.
- `GET /auth/callback`: state-bound, single-use authorization-code exchange; redirects to Pages with an opaque session in the URL fragment, scrubbed immediately by the frontend.
- `GET /api/public/pilots`: whitelisted total SP and queue snapshots only.
- `GET /api/session`: own private snapshot; opaque bearer required.
- `POST /api/session/revoke`: ends the presented bearer session and nothing else. After a Reconnect the browser hands in the session it replaced, so old sessions don't linger for 30 days, and the pilot's other devices stay signed in.
- `POST /api/sync`: own ESI refresh, minimum one minute between successful updates.
- `GET /api/wing`: the pilots' wing summaries (skills, wallet, asset summary, and with the newer consent ship, location, 7-day trail, industry jobs and mining ledger) for pilots who share with their wingmate, plus the caller's own; opaque bearer required.
- `POST /api/waypoints`: replaces the caller's in-game autopilot route with up to 40 systems; opaque bearer required and the pilot must be logged in to the game.
- `GET /api/market`: the hourly market snapshot (item metadata, gate map, prices per region, regions scanned in the last 6 hours). Without a valid opaque bearer it serves the trade hubs only, since other regions show where the pilots fly.
- `GET /api/market/regions`, `GET /api/market/survey`, `POST /api/market/ingest`: the market pipeline's reads and uploads, authorized with an HMAC of the EVE client secret.
- `GET /api/journal?since=<rev>[&prefs=1]`: goals (the wing's), the caller's own entries and, with `prefs=1`, the caller's own prefs changed after `rev`, oldest first, 500 per page (`more` says there is another), deletes as `record: null`; opaque bearer required.
- `POST /api/journal`: up to 40 changes `{kind, id, base, record|null}`. Each applies only if the stored rev still equals `base` (0 for a new record); otherwise the stored copy comes back in `conflicts`. Another pilot's entry is `denied`. Kind `pref` (migration 0005) holds a pilot's own setting under id `explored:<characterId>` or `haul:<characterId>`; only that pilot may write it (403 otherwise), it is never deleted, and it's validated per setting (at most 1000 scanned marks, 50 haul stops, 64 KB). Records are validated like a backup file and encrypted with `TOKEN_ENCRYPTION_KEY`. Deleted records stay as tombstones for 180 days. Disconnect keeps the journal.
- `POST /api/disconnect`: waits for a running sync, requests EVE revocation of the newest refresh token (the reply's `revoked` says whether EVE confirmed it) and deletes stored enrollment, all that pilot's dashboard sessions and shared snapshot. If EVE's revocation service is unavailable, deletion still proceeds; account management can revoke the remote grant.

Opaque dashboard sessions expire 30 days after their last use; each day of use pushes the expiry forward. Scheduled refreshes run every 5 minutes and sync one pilot per run (the free plan allows 50 subrequests per invocation), so each pilot refreshes every 10 minutes. Disconnect waits for a running sync, then revokes the newest refresh token. Encrypted refresh tokens remain server-side for scheduled updates until disconnected or revoked. D1 stores private snapshots, protected by the API session checks; the credentials themselves are additionally encrypted with AES-GCM. Each encrypted blob (`v:2`) binds the row it belongs to (`pilot:<id>`, `goal:<id>`, `entry:<id>`, `state:<hash>`) as additional data, so a blob copied into another row does not decrypt; older `v:1` blobs still decrypt and are rewritten as `v:2` the next time their row is saved (credentials at the next token refresh, journal records at their next edit).

When EVE answers a refresh with `invalid_grant`, the Worker records it (`grant_revoked_at`, migration 0005) and stops asking EVE for that pilot, scheduled turns included, until the pilot reconnects. A 429 from EVE login holds refreshes until its `Retry-After` (at most an hour; `refresh_after`). The OAuth callback clears both.

Only the configured Pages origin can issue browser API requests. OAuth consent/callback cookies are first-party, HttpOnly, Secure, SameSite=Lax. No cross-site third-party cookie is required by Pages. EVE responses and secrets are not logged by the Worker; observability is disabled in deployment configuration.

## Plan: moving to a custom domain

Not implemented; a plan for when the wing owns a domain. Today the page is on `matheusfiorin.github.io` and the API on `*.workers.dev`. Those are two different sites (both suffixes are on the Public Suffix List), so:

- The dashboard session can't be a cookie. A cookie from `workers.dev` on a `fetch` from `github.io` is a third-party cookie, which Safari blocks and other browsers are phasing out. So the opaque session is a bearer token in `localStorage`, readable by any script on the page, and Safari's 7-day rule deletes it.
- `github.io` is a shared origin. Every GitHub Pages project of this account runs on `matheusfiorin.github.io` and can read this app's `localStorage` (sessions and the journal). The CSP limits what this page runs, not what the account's other pages do.

The fix is to serve both halves from one registrable domain, say `app.<domain>` for the page and `api.<domain>` for the Worker:

1. **DNS and hosting.** Add the zone to Cloudflare and serve the page from Cloudflare too (Workers static assets or Cloudflare Pages, the same files the Pages workflow copies into `_site/`). Safari caps server-set cookies at 7 days when the API's IP address doesn't share the first half of the page's (its defence against CNAME cloaking), so `app.` on GitHub Pages' addresses and `api.` on Cloudflare's would lose the cookie as fast as `localStorage`. GitHub Pages with a custom domain (a `CNAME` file in the artifact, Enforce HTTPS) works for everything else but not for that. Give the Worker a custom domain `api.<domain>` (a `routes` entry with `custom_domain: true` in `scripts/deploy-backend.mjs`) and keep `workers_dev` on until the move is done.
2. **Configuration.** `FRONTEND_URL=https://app.<domain>/`, the frontend's `backendUrl=https://api.<domain>` (`scripts/configure-frontend.mjs`), `connect-src` for `https://api.<domain>` in `index.html` (and drop `https://*.workers.dev` afterwards), and the EVE application's callback URL `https://api.<domain>/auth/callback`.
3. **Session cookie.** `app.` and `api.` are the same site, so `/auth/callback` can set the session as `Set-Cookie: __Host-eve_session=…; Path=/; Secure; HttpOnly; SameSite=Lax` on `api.<domain>` and redirect to the page without a token in the fragment. The browser sends it on `fetch(…, {credentials:'include'})`; CORS answers with `Access-Control-Allow-Origin: https://app.<domain>` and `Access-Control-Allow-Credentials: true`. Page scripts can no longer read the session, Safari's 7-day rule for script-writable storage doesn't apply to an HttpOnly cookie set by a same-site server on the same network (step 1), and Lax still keeps it off cross-site requests. One cookie per pilot (`__Host-eve_session_<id>`), or one cookie listing both of this browser's pilots, keeps the two-pilot model. State-changing requests keep the exact-Origin check, plus `Sec-Fetch-Site: same-site` or a custom request header, as CSRF defence. Expiry stays server-side (30 days from last use); `Max-Age` mirrors it.
4. **A non-shared origin.** `app.<domain>` holds only this app, so its `localStorage` (the journal, drafts) is no longer readable by other GitHub Pages projects.
5. **Migration.** For a release, accept both the cookie and the bearer header; on load, a page that still holds a bearer session trades it once for a cookie (`POST /api/session/upgrade`) and deletes it from `localStorage`. The journal doesn't move between origins by itself: sync it to the backend (or export a backup) on the old address, then open the new one and connect. Keep the old Pages site up for a while with a notice that links to the new address, then remove the bearer path and `*.workers.dev` from `connect-src`.

## Verification

Worker unit tests use SQLite to exercise real migrations and query behavior, generated signed tokens, encrypted-at-rest assertions, public/private data separation, OAuth state/cookie binding and replay rejection, token rotation, session expiration, CORS, deletion and scheduler behavior. Frontend tests cover opaque sessions and shared snapshots alongside existing browser-only fallback behavior. `npm run check` syntax-checks the Worker; there is no Wrangler dry-run build. Actual Cloudflare deployment and EVE consent must be verified separately.
