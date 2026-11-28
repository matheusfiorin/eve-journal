# Resume notes

## Industrial Intelligence foundation (current feature work)

Approved scope and phase status: docs/briefs/industrial-intelligence.md. The first delivery adds a pure normalized catalog
contract and synthetic tests; it does not integrate the HTTP SDE collector, change Build or price a production lot.
Phase 0B has a tested public GET-only diagnostic tool: scripts/capture-industrial-contracts.mjs; instructions and
acceptance criteria are in docs/briefs/industrial-source-validation.md. Capture actual SDE manifests/schemas/records
and the ESI specification, then review/map them before implementing the source adapter. Synthetic capture tests do
not homologate live data. Direct requests still fail with ENOTFOUND for sde.evetech.net and esi.evetech.net; the tool
preserves an incomplete report and can be run from the user's terminal with an explicit output directory.
Node dependencies/browsers are now installed. Windows portability and Android timer/amount fixes are separate review
PRs #8/#10/#11; do not assume their commits are already on main or mixed into this foundation branch.
Each functionality now needs its own branch and PR (draft while partial); feature-branch push is authorized, merge is not.
The notes below predate the Android/Sell changes: inspect code and migrations rather than treating their status as current.

Main is current; nothing else needs pushing. Verify any change with `npm run check`, `npm test` and
`E2E_PORT=<free port> CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --grep-invert LIVE: --workers 2`.
Always pick your own E2E_PORT: Playwright reuses whatever server already listens on 8000, possibly another checkout.
Under load a few mobile map tests flake and pass on rerun (`--last-failed`).
New top-level files must be added to the copy line in `.github/workflows/pages.yml`, and boot-graph modules to the
`modulepreload` list in `index.html` (tests/package.test.js checks both). New D1 migrations take the next number after
0010 and go in the list at the top of tests/worker.test.js.

## Done (session ending Nov 2026)
- **Sessions:** per-pilot session storage merged across tabs; a reconnect works when it returns in another tab and
  revokes the old session; the pilot choice syncs across tabs; ciphertext bound to its row (v:2); refresh holds after
  invalid_grant and 429.
- **Journal sync (opt-in):** goals, Logbook, Mark scanned and the haul plan sync through `/api/journal` (D1, encrypted,
  revs, tombstones; `ui/syncplan.js`, `ui/journalsync.js`); newer edits win imports, Replace is explicit, unknown
  fields survive.
- **Roadmap 1–9:** kills/jumps sampled by the Worker cron (`worker/activity.js`); `/api/market?v=2` plus a versioned
  universe document cached in IndexedDB, with ETag/304; ESI Expires/ETag caching and 429/420 holds in the pilot sync;
  idle 3D map, typed-array Dijkstra, Haul plan in a Web Worker, lazy Earn/Navigate; UX pass (0 axe violations);
  Workers Logs, `/health/freshness` and the health workflow, daily cleanup cron; signed pipeline auth, rate limits,
  `/api/forget`, consent levels (wing 2/3, Discord alerts), CCP notice, pinned actions; features: Current fit with
  Copy as EFT, My orders with outbid, contracts, loss log, Discord alerts, blueprint library, Earn → Planets, broker
  fees from standings. Subrequest budget: `SYNC_LIMIT` with a round-robin cursor in `worker/pilotdata.js`.

## Owner setup after this deploy
`PIPELINE_SECRET` in the github-pages environment; restrict that environment to main; tick the six new scopes on the
EVE application; both pilots reconnect once; optional `DISCORD_WEBHOOK_URL`; check the CCP footer wording; delete old
market workflow runs whose logs named pilot regions.

## Not done
- Map Phase 2/3 from the earlier plan: pilot markers and trail layer, within-N-jumps rings, map pins, wormhole layer,
  WebGL renderer. Track B gaps: region-boundary route stubs, Add waypoint, landscape phone layout.
- 44 px targets still short on the Goals form, Haul plan and some Earn rows.

## Next
Sell planner: best route and markets to sell a cargo across one or more ships (see the plan in the session).
