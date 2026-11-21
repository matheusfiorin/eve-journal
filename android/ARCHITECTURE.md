# Echelon for Android: architecture

One Gradle module (`:app`), package root `com.echelon.eve`. Kotlin 2.4 (compiled by AGP 9's built-in Kotlin),
Jetpack Compose with Material 3, manual DI. The app is a client of the Worker (`worker/index.js`): the Worker keeps the
EVE tokens and syncs ESI every 10 minutes; the app holds only per-pilot sessions.

```
com.echelon.eve
├── EchelonApp, MainActivity   process + the one activity (splash, edge-to-edge, sign-in deep link, Custom Tabs)
├── AppContainer               manual DI: every long-lived object, built once
├── core
│   ├── api        EchelonApi (OkHttp + kotlinx.serialization), ApiError / Problem (expired vs outage)
│   ├── auth       Pkce, SessionStore (Keystore AES-GCM + DataStore), AuthManager (the mobile sign-in)
│   ├── cache      ConditionalCache (ETag + body on disk), UniverseCache (universe document per version)
│   ├── data       PilotRepository, WingRepository, MarketRepository, SyncCoordinator, Prefs
│   ├── model      the Worker's JSON: PrivatePilot, PublicPilot, WingPilot, MarketSnapshot, UniverseDoc, LiveStatus …
│   ├── js         PlannerBridge: the web's planners in QuickJS
│   ├── wing       WingChannel (live wing room over WebSocket), protocol models
│   └── push       optional FCM: PushRegistrar, EchelonMessagingService, notifications
├── ui
│   ├── theme      tokens (from styles/tokens.css), Material 3 scheme, fonts, shapes, EchelonTheme
│   ├── components cards, stat tiles, chips, rows, progress, states, countdown, portraits, buttons, wing chip
│   ├── motion     springs, nav transitions, shared elements, animated number, starfield, haptics
│   ├── format     ISK and number formatting (the web's format()), durations, security colours
│   └── catalog    DesignCatalog: every component on one page (and its screenshot test)
├── nav            the shell: Destination, routes, FeatureRegistry, top/bottom bars, hubs, Settings, Welcome
├── fly          timers (shared with the wing, foreground service), where I am, current fit, skill queue, jobs
├── plan, corp   feature packages (stubs from the scaffold)
```

Rules: `ui` depends on nothing in the app but itself. `core` never imports `ui` or `nav` (`core.data.Prefs` reads
`ui.theme.ThemeSettings`, a plain data class, and that is the one exception). Feature packages use `core`, `ui` and the
`nav` extension points, and nothing of each other.

## Extension points for feature agents

### Registering screens (no shell edits)

Each feature owns one `Feature` object (`plan/PlanFeature.kt`, `fly/FlyFeature.kt`, `corp/CorpFeature.kt`).
`nav/Features.kt` lists them: that is the only "registration line", and it already names all three.

```kotlin
object FlyFeature : Feature {
    override val destination = Destination.Fly
    override fun install(registry: FeatureRegistry) {
        registry.register(destination, SubScreen(
            key = "timers",                       // stable: it is in saved back stacks and SubRoute
            title = "Timers", summary = "Gas sites, mining cycles, despawn and cyno",
            icon = EchelonIcons.Timer, order = 10,
            visible = { pilot -> true },          // hide an entry, e.g. without a scope
            card = { ctx, onOpen -> TimersCard(onOpen) },   // optional live card on the hub
        ) { ctx -> TimersScreen(ctx) })
    }
    // Optional: routes of your own (a detail screen with typed arguments).
    override fun graph(builder: NavGraphBuilder, nav: NavController) { builder.composable<TimerDetail> { … } }
}
```

- The hub (`nav/Hub.kt`) lists a destination's entries sorted by `order`; a tap opens `SubRoute(destination, key, arg)`.
- `ScreenContext` gives a screen the flying `pilot`, its `arg`, `open(destination, key, arg)` for any other registered
  screen (also across destinations), and `back()`.
- The shell draws the top bar, the back bar with your title, the bottom bar and the insets. Your `content` fills the
  rest; make it scrollable yourself, and leave `contentPadding`-style bottom space for the gesture bar if you draw to
  the edge.
- The stubs registered today use `Placeholder(title, summary)`; replace each `content` lambda, keep the keys.

### Getting data

- `LocalAppContainer.current` (null in previews/screenshots) gives `AppContainer`: `api`, `sessions`, `pilots`,
  `wing`, `market`, `sync`, `planners`, `wingChannel`, `push`, `prefs`, `selectedPilot`.
- Prefer a ViewModel per screen that takes the pieces it needs as constructor arguments, and a stateless composable
  that takes plain state, so the composable can be screenshot-tested without the container.
- Endpoints the core does not type yet (`/api/corp`, `/api/assets`, `/api/waypoints`, `/api/sell-station`,
  `/api/contract-items`): `api.get<MyModel>(path, token)` / `api.post<MyModel>(path, token, body)` with your own
  `@Serializable` models (in your package). `sessions.token(pilot.id)` gives the bearer token. Errors are `ApiError`;
  `Problem.of(e)` tells an expired sign-in from an outage. A 401 already drops that one token.
- Pull-to-refresh on the hub calls `sync.refresh(force = true)`. To refresh your own data with it (and on resume),
  call `container.sync.addRefresher { … }` once.
- Market: `market.state` holds `MarketData` (snapshot + universe merged, `systems`, `regionName`, `metaData`) and the
  raw `universeJson` for the planner bridge.

### JS planner bridge (core.js)

Verdict: **reuse the web planners through QuickJS** (`io.github.dokar3:quickjs-kt`) rather than port them. The seven
planner modules are pure ES modules with good tests; esbuild bundles them into one 71 kB classic script
(`app/src/main/assets/planners.js`, built by `npm run bundle:android` from `android/js/planners.js`), and QuickJS runs it
on Android and, through quickjs-kt's desktop build, in JVM unit tests. `androidx.javascriptengine` was the other option:
it needs WebView, is async-only with string messages, and cannot run in JVM tests.

- Calls are JSON in, JSON out: `planners.call("route.path", buildJsonObject { … })` or the typed helpers
  (`loadUniverse`, `path`, `within`). The universe is loaded once (`loadUniverse(market.state.value.universeJson)`) and
  stays in the engine; an 8,000-system map loads in about 0.45 s on a laptop JVM and a cross-map route takes about 8 ms.
- One engine on one thread; calls are serialised. Evaluation is capped at 20 s and 256 MB.
- To expose a planner function: add an adapter to `api` in `android/js/planners.js` (turn JSON into the module's
  inputs, and its result back into JSON), run `npm run bundle:android`, commit the bundle, and test the call in
  `PlannerBridgeTest` against values the web's function prints under Node. `tests/android-bundle.test.js` and CI fail
  if the bundle is stale. Every module is already in the bundle (`planners.modules()` lists their exports).

### Wing sharing (core.wing, core.push)

`container.wingChannel` is the live link to the Worker's wing room (`GET /api/wing/socket`, bearer token of the flying
pilot). It connects while held, folds the room's messages into StateFlows, and reconnects with backoff.

- State: `timers` (both pilots', by id; tell the wingmate's apart by `owner`), `presence`, `pings` and `plans` (newest
  first, last 50), `status`, and `incoming` (live messages only, for haptics or an in-app banner).
- Send: `upsertTimer(WingTimer)`, `removeTimer(id, pilot)`, `ping(pilot, WingPing(WingPing.OMW))`,
  `sharePlan(pilot, SharedPlan("haul", title, summary, route))`. Sends while offline are queued and go out once the
  room's snapshot has arrived.
- Lifecycle: the app's foreground holds it automatically (ProcessLifecycleOwner). **The Fly agent's timer foreground
  service** calls `wingChannel.onTimerServiceStarted()` in `onCreate` and `onTimerServiceStopped()` in `onDestroy`, so
  timers keep syncing with the app in the background. With no holds the socket closes.
- UI: `WingChip(name, PilotColors.of(id), "started ‘Gas site’", at, now)` is the "Decxus started … 3 min ago" chip.
- Push (optional): put the Firebase console's `google-services.json` in `android/app/`; the build then applies the
  google-services plugin and FCM delivers the room's data messages to `EchelonMessagingService`, which shows a
  notification on the `wing` channel. Without the file the build is unchanged and Firebase never initialises.
  `PushRegistrar` registers the token (`POST /api/push/register {token}`) for each connected pilot whenever the
  flying pilot or a session changes. Android 13+ needs `POST_NOTIFICATIONS` at run time: the Fly feature asks for it
  when the first timer starts (it needs it for the ongoing timer notification anyway).

## The Fly feature (fly)

- `FlyFeature` registers five screens: `timers`, `live`, `fit`, `skills`, `jobs`. Each has a stateless screen
  (`fly/<name>/…Screen.kt`, screenshot-tested in `FlySnapshotTest`) and a small route in `FlyFeature.kt` that reads
  the container. `FlyLoader` (`FlyData.kt`) turns core data into screen state.
- `container.fly` (`FlyServices`) holds `EveNames` (public ESI: `universe/names`, and type → group → category to tell
  charges apart, pinned to the web's compatibility date) and `TimerStore`.
- Timers: `TimerStore` keeps this phone's own timers in `files/fly-timers.json` and merges the wing room's. The room
  only stores shared timers (worker/wingroom.js), so a private timer lives on this phone only; turning a timer private
  sends it once more with `shared = false` so the room drops it. `TimerService` (a `specialUse` foreground service)
  starts while anything counts down: an ongoing notification with a countdown chronometer, an alert on the
  `timers_done` channel when each timer ends, and a hold on the wing room. The rules (pause, resume, restart, the
  board's order) are pure functions in `fly/timers/Timers.kt`, tested in `TimersTest`.
- Fit and jobs reuse the web's `fit.js` and `jobs.js` through the bridge (`fit.groups`, `fit.eft`, `jobs.wing`). Encode
  ESI records for the bridge with defaults on (`EchelonJson` leaves them out, and jobs.js reads `status`).

## Sign-in and sessions (core.auth)

`AuthManager.start(pilot)` makes a PKCE pair, keeps the verifier in the sealed store (it survives the app being killed
while the Custom Tab is open; good for 30 minutes, used once) and returns
`/auth/start?pilot=<id>&client=android&challenge=<C>`. The Worker redirects to `echelon://auth/callback?code=K&pilot=<id>`
(the activity's intent filter); `complete()` redeems K with the verifier at `POST /api/mobile/redeem` and stores the
session, revoking any session it replaced. A callback this phone did not start has no verifier and is refused.

`SessionStore` mirrors `backend.js`: one session per pilot, only the two wing pilots, a dropped token only if it is
still the one that failed, expiry only forward and never beyond 31 days, expired sessions removed on load. The blob is
AES-256-GCM with an Android Keystore key and bound to its purpose; if the key is lost the pilots simply connect again.
Backups are off for it (`data_extraction_rules.xml`).

## Design system API (ui)

- `EchelonTheme(settings, pilot)` wraps everything (the shell does it). Read tokens through `Echelon`:
  `Echelon.colors.surface1`, `Echelon.type.num`, `Echelon.pilot.color`, `Echelon.reduceMotion`, `Echelon.backdrop`.
  Spacing, radii, type sizes, durations and easings are `Spacing`, `Radii`, `TypeScale`, `Durations`, `Easings`.
  Material components get the same palette through the mapped `ColorScheme`.
- Colours: plotter violet is the UI accent (`accent`); pilot colours are identity only (`PilotColors.Fiofka`
  `#F0BB5C`, `PilotColors.Decxus` `#5CD3DE`, `PilotColors.of(id)`); `ok`/`warn`/`danger`/`info` are states; security
  uses EVE's palette (`secColor`, `secText`, `SecurityBadge`).
- Type: Michroma (display: `Echelon.type.hero`, `screenTitle`, headline slots), Barlow Semi Condensed (UI, every
  body/title/label slot), Martian Mono at 87.5 % width for numbers (`Echelon.type.num`, `numLarge`, `numSmall`). All
  three are OFL and bundled in `res/font` (licences in `assets/licenses`).
- Components (`ui.components`): `EchelonCard`, `PrimaryPanel` (tick ruler and cut corner: one per screen),
  `SectionHeader`, `Hairline`, `StatTile`/`StatRow`, `Tag`, `ChoiceChip`, `SecurityBadge`, `PilotBadge`, `StatusDot`,
  `ListRow`, `KeyValueRow`, `ProgressBar`, `ProgressRing`, `SkeletonRows`/`Modifier.shimmer()`, `EmptyState`,
  `ErrorState`, `Countdown`/`RollingText`/`rememberNow`, `Portrait`, `TypeIcon`, `EveImages`, `Emblem`,
  `PrimaryButton`/`SecondaryButton`/`LinkButton`, `WingChip`, `GridBackground`, `HeroBackground`. `Tone` picks
  neutral/accent/ok/warn/danger/info everywhere.
- Formatting (`ui.format`): `compactNumber`, `format(value, Kind.Isk|Pct|Hours|Count)` (the web's `format()`), `isk()`
  (two decimals), `duration`, `left`, `clock` (countdowns), `ago`, `parseIsk`, `plural`, `secShown`, `secBand`,
  `secLabel`. `FormatTest` pins them to values printed by the web's own functions.
- Motion (`ui.motion`): `Springs.nav/select/value`, `motionSpec(full, reduced)` (snap when reduced), `NavMotion`
  (the NavHost transitions; predictive back scrubs the pop), `Modifier.sharedContainer(key)` (container transform
  list → detail) and `Modifier.sharedHero(key)` (one element flying across), `AnimatedNumber`, `Starfield`,
  `rememberHaptics()` (`select`, `tick`, `confirm`, `reject`, `heavy`, `gestureEnd`). Reduced motion comes from the
  system animator scale (Remove animations) or the app setting; every animation honours it, and screenshots render
  the end state.
- Icons: `EchelonIcons` are the web's line icons as vectors; `material-icons-core` is available for anything else.

## Adding a screen

1. Write a stateless composable that takes plain state (`TimersScreen(state, onStart, …)`), plus a ViewModel or a
   small holder that reads from `LocalAppContainer` and feeds it.
2. Register it in your `Feature.install` with a `SubScreen` (see above). For a list → detail morph, put
   `Modifier.sharedContainer("timer-$id")` on the row and on the detail's top container.
3. Add a Paparazzi test (below) and record its golden.

## Adding a Paparazzi test

Tests live in `app/src/test/java/…`, goldens in `app/src/test/snapshots/images` (committed).

```kotlin
class TimersSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi()           // Pixel 8; echelonPaparazzi(tall = true) for a long page
    @Test fun running() = paparazzi.echelon(pilot = PilotColors.Decxus) { TimersScreen(fixtureState, now = 1_795_000_000_000L) }
}
```

`echelon { }` (in `testing/Snapshots.kt`) renders inside `EchelonTheme` on the grid ground, in inspection mode (still
starfield, numbers at their end values) with a ViewModelStore so a NavHost works. Pass fixed times (`now`, a
`ZoneOffset.UTC` zone) so goldens don't drift. A `tall` page must not scroll itself (render its content without
`verticalScroll`). Then:

```sh
./gradlew :app:recordPaparazziDebug   # writes the goldens
./gradlew :app:verifyPaparazziDebug   # what CI runs
```

Unit tests run one JVM per test class (`forkEvery = 1`): Paparazzi loads layoutlib's Android classes, which would make
OkHttp in a later class pick its Android platform.

## Build notes

- compileSdk/targetSdk 36, minSdk 29, Java 17 bytecode (built with JDK 21). AndroidX, Coil, OkHttp and QuickJS are the
  newest releases that still compile against API 36 (see the note in `gradle/libs.versions.toml`); moving to
  compileSdk 37 unlocks the next ones.
- Paparazzi is 2.0.0-alpha05.1: the last stable (1.3.5) predates AGP 9 and API 36.
- JVM unit tests swap QuickJS's Android artifact for its desktop one (same API, bundled linux/macOS/windows libraries).
- Release signing reads `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD` from the environment (CI sets them from secrets on `v*` tags).
