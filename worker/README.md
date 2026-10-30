# EVE backend

GitHub Pages remains the frontend. A Cloudflare Worker handles EVE Authorization Code login with a confidential client, PKCE S256, signed-token validation, encrypted credentials, D1 snapshots, opaque dashboard sessions and scheduled refreshes every 30 minutes.

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
- `POST /api/sync`: own ESI refresh, minimum one minute between successful updates.
- `POST /api/disconnect`: requests EVE revocation and deletes stored enrollment, all that pilot's dashboard sessions and shared snapshot. If EVE's revocation service is unavailable, deletion still proceeds; account management can revoke the remote grant.

Opaque dashboard sessions expire after 24 hours. Encrypted refresh tokens remain server-side for scheduled updates until disconnected or revoked. D1 stores private snapshots, protected by the API session checks; the credentials themselves are additionally encrypted with AES-GCM.

Only the configured Pages origin can issue browser API requests. OAuth consent/callback cookies are first-party, HttpOnly, Secure, SameSite=Lax. No cross-site third-party cookie is required by Pages. EVE responses and secrets are not logged by the Worker; observability is disabled in deployment configuration.

## Verification

Worker unit tests use SQLite to exercise real migrations and query behavior, generated signed tokens, encrypted-at-rest assertions, public/private data separation, OAuth state/cookie binding and replay rejection, token rotation, session expiration, CORS, deletion and scheduler behavior. Frontend tests cover opaque sessions and shared snapshots alongside existing browser-only fallback behavior. Build validation uses Wrangler dry-run. Actual Cloudflare deployment and EVE consent must be verified separately.
