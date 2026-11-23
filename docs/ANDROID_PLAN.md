# Echelon for Android: plan, status and what's left (as of 23 Nov 2026)

Read this with `android/ARCHITECTURE.md` (how the app is built), `docs/briefs/android-design.md` (the product and API
design, including wing sharing), `docs/briefs/agent-rules.md` (conventions and testing) and `RESUME.md` (the web app).

## The plan
An Android-first native app (Kotlin + Jetpack Compose) for Fiofka and Decxus. It's a second client of the Cloudflare
Worker, with three destinations:
1. **Plan:** what to do next (explore, BPOs to buy, mining, trade, sell, haul, goals). It reuses the web's planners
   through QuickJS.
2. **Fly:** help during play (account-aware timers such as the gas sleeper timer and mining cycle/hold-full, live
   location, pings, Quick Settings tile, widget).
3. **Corp:** POS and structure health, wallet, members, jobs, customs offices, assets, low-fuel alerts.
Timers, plans and pings are **shared live with the wingmate** through the wing-room Durable Object.

## Pull requests
| PR | State | Contents |
|---|---|---|
| #2 | merged 21 Nov | Sell planner (web), mobile auth backend, `/api/live`, corp sync, `/api/corp`, `/api/assets`, the wing room, the Android foundation, app/backend contract fixes |
| #3 | merged 21 Nov | The Android app with Fly (shared timers, foreground service, Where I am, fit with EFT, skill queue, jobs), fit/jobs through the bridge; deployed the backend |
| #4 | merged 21 Nov | Plan (7 screens through the bridge, journal sync), Corp (7 screens from `/api/corp` and `/api/assets`), the Fly Wing screen (presence, calls, shared plans), review fixes |
| #5 | **open** | "Formation" branding, Cockpit (a widget and a Quick Settings tile), timers bound to systems (Horizon, Jump radar, per-system cards), wing live status, read receipts, follow mode, shared sessions |

Deploys work again: the Cloudflare token was replaced, and the deploys for #3 and #4 succeeded. PR #5's CI is green
(the Android build and the web checks).

## Status against the plan
| Plan item | Status |
|---|---|
| Foundation, design system, sign-in, API, cache, CI | Done (#2), rebranded in #5 |
| Plan: Explore, Build, Mine, Trade + My orders, Sell, Haul, Goals | Done (#4) |
| Plan: "Send to wingmate", incoming plans, autopilot | Done (#4); follow mode added in #5 |
| Corp: POS, structures, wallet, members, jobs, customs offices, assets | Done (#4) |
| Corp: an overview screen with health rings | Partly done; check it in #5's hub |
| Corp: **local low-fuel and reinforced alerts (WorkManager)** | **Missing.** Only the Worker's Discord alerts exist. |
| Fly: shared timers, foreground service with a countdown notification | Done (#3), placed by system in #5 |
| Fly: **gas sleeper timer with researched timing and a T−2 min warning** | Done (finish wave): researched 15 min default (15 to 20 min after the first warp-in), T-2 min warning in the timer meta, known-space gas kept separate. See `android/FLY_TIMERS.md`. |
| Fly: **mining cycle and hold-full from the fit and skills** | Done (finish wave): ESI dogma plus skills and hull bonuses, unit-tested against the Venture fit; in the start sheet and the Cockpit. |
| Fly: **exact alarms for the warning and end**, distinct alert channels | Done (finish wave): AlarmManager exact alarms with a receiver, boot reschedule, rationale card; one channel and vibration pattern per alert kind. |
| Fly: wormhole-entry suggestion ("Start sleeper timer") | Done (finish wave): animated one-tap card in Cockpit and Timers; undocking in a mining hull suggests the mining timer. |
| Fly: live system and ship, pings, the wing screen | Done (#3–#5) |
| Fly: Quick Settings tile, home widget | Done in #5; a second "Gas timer" tile (start, or show and stop) added in the finish wave |
| Fly: app shortcut | Done (finish wave): Gas timer, Mining cycle, Cockpit |
| Fly: ProgressStyle notification (Android 16) | Done (finish wave), guarded to API 36 |
| Picture-in-picture Cockpit | **Not built**, though PR #5's description says "picture-in-picture overlay". `CockpitActivity` is an ordinary standalone screen. |
| Background push (FCM) | Code present. Needs a Firebase project and the Worker secrets. |
| Opus review of the whole app | Done before #4 ("fixes from a full review"); #5's ~6,400 new lines have no independent review yet |

## Review of PR #5
**What's good.** It's large (167 files, +6,411/−593) but well split into commits. CI is green, goldens were
re-recorded, a flaky test was fixed, the wing-room backend changes have tests, and the docs were updated.

**Before merging:**
1. **Fix the PR description.** It claims a picture-in-picture overlay that isn't built. Either build PiP
   (`supportsPictureInPicture` on `CockpitActivity` plus `enterPictureInPictureMode` with a compact layout) or remove
   the claim.
2. **The wing-room protocol changed** (live status, acknowledgements, sessions). Make sure an app from #4 still works
   against the #5 backend, and the other way round, since the two pilots may update at different times. Check that
   unknown message types are ignored on both sides and that the `state` snapshot stays compatible.
3. **Merging #5 redeploys the Worker.** Check that the wing-room changes need no Durable Object migration beyond
   `v1`, or that one is added in `scripts/deploy-backend.mjs`.

**Can follow after merging** (the "Missing" items above): sleeper timing with research and a warning, mining from the
fit and skills, exact alarms, the wormhole suggestion, Corp local alerts, the app shortcut, and an independent Opus
review of #5.

## Owner actions still open
1. Tick every scope in `README.md` on the EVE application (developers.eveonline.com): the features release, online,
   and the eight corporation scopes. Then reconnect both pilots in the web app and the Android app.
2. Corp data needs in-game roles (Director, Station Manager, Accountant).
3. Optional:
   - Firebase project plus `google-services.json` and the Worker secrets `FCM_PROJECT_ID` and
     `FCM_SERVICE_ACCOUNT`, for pushes when the app is closed
   - `ANDROID_KEYSTORE_*` secrets and a `v*` tag, for a signed APK
   - `DISCORD_WEBHOOK_URL`
4. Restrict the `github-pages` environment to `main`, and set `PIPELINE_SECRET` there if that isn't done yet.
5. Delete the old market workflow runs whose public logs named the pilots' regions.

## How to build and test
```sh
npm ci && npm run check && npm test
E2E_PORT=8811 CHROMIUM_PATH=/path/to/chromium npx playwright test --grep-invert LIVE: --workers 2
npm run bundle:android                       # after changing a root planner module
cd android && echo "sdk.dir=$HOME/android-sdk" > local.properties
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:verifyPaparazziDebug --max-workers=2
```
