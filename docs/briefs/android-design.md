# Echelon for Android: shared design (read fully)

Goal: an Android-first native app (Kotlin + Jetpack Compose, Material 3) for two EVE Online pilots, Fiofka and
Decxus. It's a new client of the existing Cloudflare Worker backend (worker/index.js). The backend keeps the EVE
tokens, syncs ESI every 10 min, sends alerts and does journal sync. It must look and feel great: purposeful motion,
dark space theme built from styles/tokens.css, haptics, edge-to-edge, and one-handed use.

Three destinations (bottom navigation), plus a pilot switcher and settings in the top bar:
1. PLAN: decide what to do next.
   - places to explore (exploration.js rankSystems/loop)
   - which BPO to buy and build (industry.js evaluate/rank/portfolio)
   - what to mine (mining.js)
   - trade and haul opportunities (market.js)
   - Sell planner (sell.js)
   - haul routes (hauling.js)
   - wing goals
2. FLY: help during play.
   - Timers tied to the account: gas-site sleeper timer started right after warping in, mining cycles and hold-full
     time from the actual fit + skills, site despawn, cyno, generic.
   - Foreground service + ongoing notification countdown, Quick Settings tile, home widget, haptic alerts.
   - Live location/ship from GET /api/live: suggests a timer when you enter a wormhole system or undock in a mining
     ship.
   - Current fit (Copy as EFT), skill queue, jobs ready.
3. CORP: administer the corporation and personal assets.
   - POS (starbase) health: fuel blocks/strontium time left, state, reinforcement timer.
   - Upwell structures: fuel expiry, services, state.
   - Corp wallet divisions, members, corp industry jobs, customs offices.
   - Personal and corp asset browser by location, with search and value.
   - Low-fuel / reinforced alerts.

## Repo layout
android/ is a self-contained Gradle project (settings.gradle.kts, gradle wrapper, one :app module).
- Package root: com.echelon.eve. Feature packages: .plan, .fly, .corp. Each owns its screens.
- Shared code: .core (api, auth, data, cache, model), .ui (design system, components, motion), .nav.
- Feature agents edit only their own package plus a registration line; the scaffold provides stub screens and
  extension points.

## Toolchain
- The Android SDK is at $HOME/android-sdk (platforms;android-36, build-tools;36.0.0, platform-tools). JDK 21.
- Set ANDROID_HOME or sdk.dir in android/local.properties (gitignored).
- No emulator: verify UI with Paparazzi (JVM screenshot tests) and JVM unit tests (Robolectric only where needed).
  Commit golden screenshots for key screens under app/src/test/snapshots.
- Build: `cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest`.
- Pin versions to stable releases you verify exist on Maven (google(), mavenCentral(), gradlePluginPortal()).

## Mobile auth contract (the backend implements it; the app uses it)
1. The app makes a PKCE pair (verifier V, challenge C = base64url(SHA-256(V))) and opens a Custom Tab at
   `${API}/auth/start?pilot=<characterId>&client=android&challenge=<C>`.
   - The consent page then works as today (the share boxes), followed by EVE SSO.
2. On a successful EVE callback for client=android, the Worker does NOT put the session in a URL. It stores a one-time
   code K (hash, challenge, pilot, the new session token; expires in 5 min; single use) and 303-redirects to
   `echelon://auth/callback?code=K&pilot=<id>`.
3. The app sends POST `${API}/api/mobile/redeem` {code:K, verifier:V} and gets back {session, pilot, expires}. The
   Worker checks base64url(SHA-256(V)) == C, single use, not expired. Errors are 400 and generic.
4. The app keeps the session encrypted (Android Keystore AES-GCM key + DataStore) and sends `Authorization: Bearer` as
   the web does.
   - Endpoints: /api/session, /api/sync, /api/wing, /api/market?v=2, /api/market/universe?v=,
     /api/journal (same sync protocol as ui/syncplan.js), /api/waypoints, /api/disconnect, /api/forget,
     /api/sell-station, /api/contract-items, /api/live, /api/corp, /api/assets.
API base: https://eve-journal-api.eve-pilots-f6933080.workers.dev (a build config field). Pilots come from
/api/public/pilots.

## New backend endpoints (the backend agent builds them)
- GET /api/live (bearer, rate-limited): fetches /location/, /ship/ and /online/ live from ESI (3 subrequests; ESI
  caches about 5 s). Returns {system, station, structure, shipType, shipName, online, at}.
- GET /api/corp (bearer; the caller must belong to the corp): the latest corp snapshot.
- GET /api/assets?location=<id>|all (bearer): the caller's asset tree, grouped by location, with names and flags,
  fetched on demand.

## Wing sharing (added by the user): timers and more, shared live with the wingmate's app
Backend: one Durable Object, the "wing room", using the SQLite-backed class (allowed on the free plan) with the
WebSocket Hibernation API. One room per wing, keyed "wing". Bindings and migrations go in scripts/deploy-backend.mjs
(durable_objects + migrations new_sqlite_classes).
- Connecting: GET /api/wing/socket with a bearer token. A browser can't set WebSocket headers, but the native app
  can; also accept a short-lived ticket from POST /api/wing/ticket via ?ticket=. The Worker checks the session and
  that the pilot is in ALLOWED, then forwards to the DO.
- Messages are JSON {type, id, from, at, ...}. Types:
  - timer.upsert, timer.remove: {timer:{id, kind, label, startedAt, durationMs, pausedAt?, owner, shared, meta}}
  - plan.share: a sell, haul or explore plan summary plus its route system ids, sent to the wingmate
  - ping: {kind:'undock'|'help'|'omw'|'docked'|'custom', text?}
  - presence: online in the app, plus the active timer count
- The DO keeps current timers and the last 50 shared items in its SQLite, so a reconnecting app gets a 'state'
  snapshot first. Timers older than 24 h after their end are expired.
- REST fallback: GET/POST /api/wing/timers for clients without a socket.
- Ping and plan messages may carry locations only when the sender chose to; they're private to the two pilots.
  Nothing goes to logs.
- Background push (optional): if FCM_SERVICE_ACCOUNT (JSON) and FCM_PROJECT_ID Worker secrets exist, the DO sends an
  FCM HTTP v1 data message to the wingmate's registered device tokens (POST /api/push/register {token}, a D1 table
  push_tokens) for timer start/end and pings. Use WebCrypto RS256 for the OAuth JWT. It's a no-op without the secrets.
App:
- A WingChannel client (OkHttp WebSocket) with backoff reconnect. It's active while the app is in the foreground or
  a timer foreground service is running.
- Exposes StateFlows of wing timers, presence, pings and shared plans.
- The app shows shared timers next to its own (the wingmate's colour, with a "Decxus started 'Gas site' 3 min
  ago" chip).
- Firebase: optional. The google-services plugin is applied only when app/google-services.json exists, so the build
  works without it. On receiving a push, show a notification.
