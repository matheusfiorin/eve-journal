# Resume notes (Echelon map + repo fixes)

Branch: `ccr-4bc45995-xpus3d` (nothing else needs pushing). No PR was opened; the user asked not to publish roadmaps.
Verify any change with `npm run check`, `npm test`, `npm run test:e2e`. The e2e web server is `scripts/static-server.mjs`; set `CHROMIUM_PATH` or `E2E_PORT` if needed. Under load, a few mobile e2e tests flake on `page.goto` and pass on rerun (`npx playwright test --last-failed`).
New top-level files must be added to the copy list in `.github/workflows/pages.yml`; put new modules under `ui/`.

## Done
**Track A (repo fixes):** 7-calendar-day trade volume; `/api/market` returns only hub regions unless signed in (pilot regions no longer public); `invalid_grant` tells the pilot to reconnect (502, not 401); backend client reports the HTTP status on non-JSON errors; Jobs slot totals use fixed skill IDs; wingmate build plan priced with the wingmate's numbers; in-flight market/price/cost loads shared; cron runs every 15 min and syncs one pilot per run; dead code removed; Content-Security-Policy in `index.html` (e2e fails on violations); focus on view change, pilot picker trap, Jobs keeps focus; deploys no longer cancelled on `main`, import-graph guard test; stray connection links can't replace a session; asset lookups capped at 4; pipeline survives a failed region lookup and times out fetches; docs pass.

**Track B (map Phase 0+1):** Fit fixed; shared gestures (`ui/gestures.js`) for 2D+3D; tooltip only for mouse/focus; 3D redraws only when something moves; readable security colours and legends; address state (`ui/mapstate.js`: `#navigate/map?r=&s=&o=&j=&v=`) plus saved preferences; layers (up to 4 route layers, A/B badges, hop numbers); phone layout (full-screen map, search and Layers buttons, bottom sheet, 44 px controls) and desktop breadcrumb; keyboard, labels, status line, sortable List view; draw-first loading and failed-feed legend; Haul from / Add as stop. Screen code is in `ui/screens/starmap.js`; tests in `tests/gestures.test.js`, `tests/mapstate.test.js`, `e2e/starmap.spec.js`.

## Not done
- **Phase 2 done so far:** Danger to haulers, Ship kills (~7 days) and Jumps (~24 h) overlays; live camps come from `ui/killfeed.js`, shared with the Haul plan.
- **Phase 2 (map features on the layer model):** pilot/wingmate markers and 7-day trail (worker trail, `trail()` in earn.js, `/api/sync` refresh); earning layers (all cost indices, mining ISK/h via `sites()`, NPC factory/lab pins, running jobs); within-N-jumps rings (`paths()` in route.js) and a shared avoid list; browser-only pins and notes (`eve-map-pins:v1`); wormhole layer (move `eveScout` out of earn.js); haul plan modes (safest/balanced/shortest) as separate route layers, explore loop and mining sites as pins.
- **Phase 3 (3D):** camera upgrades (inertia, double-tap focus, reset); raw WebGL2 renderer in `ui/starmap-gl.js` with the Canvas `StarMap` as fallback (keep `set/fly/pick/start/stop`, `data-frames`, `data-focus-xy`, add `data-renderer`); route ribbon and ship marker; true light-year range sphere with grid index; flat/3D morph and level of detail; axis widget and ortho toggle. Check axis mirroring against Dotlan (`map.js:90`) first. Measured: New Eden 3D 24 ms/frame desktop, 102 ms at 4x CPU slowdown.
- **Track B gaps:** routes only draw as a stub and note at a region boundary; no "Add waypoint" (the worker call clears waypoints); landscape phone layout never viewed; desktop page scrolls by the footer height under the map; a long route's exit note can sit off-screen on phones.
- **Review items skipped on purpose:** splitting `/api/market` into a cached universe endpoint, caching the SDE zip in CI, a single pilot allowlist source, Queues. Two Track A fixes (wingmate budget, asset concurrency) have no regression test.
- **Commit attribution:** Track A commits say "Opus 5.5" in Co-Authored-By; the session asked for "Claude Sonnet 5.5". Reword only if history is rewritten.

## Next steps
1. Phase 2 items in the order above (layers first: markers/trail, rings/avoid, pins).
2. Phase 3 in the order above, one shippable step at a time, each with an e2e test.
3. Fix the Track B gaps; look at the landscape layout.
