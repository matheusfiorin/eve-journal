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
├── fly          wing (calls, shared plans, presence), timers (foreground service), where I am, fit, skills, jobs
├── plan         explore, build, mine, trade, sell, haul routes, wing goals (the web's planners via the bridge)
├── corp         starbases, structures, wallet, members, corp jobs, customs offices, assets (GET /api/corp, /api/assets)
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
  when the first timer starts (it needs it for the ongoing timer notification anyway), and the Wing screen offers it.

### Flying together (com.echelon.eve.wing)

The room's coordination types (worker/README.md, "Coordination types") on top of the channel:

- Channel state: `statuses` (each pilot's live status by id), `session` (the running one) and `sessionHistory` (ended,
  with totals), `pending` (outbox size). Send: `publishStatus(pilot, WingStatus?)`, `ack(pilot, ref, WingAck.ONIT)`,
  `startSession(pilot, SessionPlan(activity, goal, where))`, `reportContribution(pilot, isk, units)`, `endSession(pilot)`.
  Answers arrive on each `WingEvent.acks`. `jumpsBetween(systems, a, b)` (core/wing/WingGeo.kt) is a gate BFS over
  `market.state.value.data?.systems`.
- `container.wingServices` (`WingServices`, started from `EchelonApp.onCreate`): `settings` (opt-in live status,
  activity, followed route; SharedPreferences `wing`), `StatusPublisher` (GET /api/live, or the snapshot, once a minute
  while sharing and connected), `SessionReporter` (wallet change and mining-ledger units since the session started on
  this phone), `WingNotifier` (wingmate calls on `wing`, answers / sessions / "in your system" on `wing_updates`, only
  while the app is in the background and something holds the socket; with no socket the room pushes through FCM).
- For other features: `wingServices.follow(route)` shares the route the pilot is about to fly (follow mode; the Wing
  screen does it when "Set my autopilot" is used), `wingServices.startSession(plan)`, `wingServices.jumpsToWingmate()`.
- Top bar: `WingStatusIndicator(onClick = { open Fly → wing })` (wing/WingIndicator.kt) reads the container itself and
  draws nothing without one; `WingIndicator(WingIndicatorState(...))` is the stateless form for screenshots.

## The Fly feature (fly)

- `FlyFeature` registers `cockpit` first, then `wing`, `timers`, `live`, `fit`, `skills`, `jobs`. Each has a stateless screen
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
- Timers are bound to a system: `TimerStore.start` stamps the flying pilot's current system (`meta.system`,
  `meta.systemName`), and the screen (`TimersRoute`, views in `TimerViews.kt`) shows a Horizon strip (every end on one
  time axis), a Jump radar (systems by jumps from here) and one card per system with ring countdowns, here first.
  Notifications name the system ("Gas site in Tama").
- Cockpit (`fly/cockpit`): the screen to keep open while playing — where you are (security warnings on entering
  low/null), the next timer, the wingmate, and one-tap calls and timers. `CockpitLive` polls location; the same screen
  runs as `CockpitActivity` (picture-in-picture / overlay) and the `CockpitWidget` home-screen widget. Both open the app
  on a screen through `MainActivity.open(context, "Destination/key")` (`EXTRA_OPEN`, handled by
  `EchelonShell(openOnStart)`).
- Follow mode: sending or sharing an Explore loop or a haul route calls `wingServices.follow(route)`, so (with status
  sharing on) the wingmate sees this pilot's destination and can set their own autopilot to it.
- Fit and jobs reuse the web's `fit.js` and `jobs.js` through the bridge (`fit.groups`, `fit.eft`, `jobs.wing`). Encode
  ESI records for the bridge with defaults on (`EchelonJson` leaves them out, and jobs.js reads `status`).

## The Plan feature (plan)

- Seven screens, each a package under `plan/`: `explore`, `build`, `mine`, `trade`, `sell`, `haul`, `goals`. Every
  screen but Wing goals runs the web's own planner through one adapter file in `android/js/plan/` (the web's
  render function minus the HTML: inputs in as JSON, the screen's rows out), so the numbers match the website.
- `PlanEngine.ready()` (`container.plan`) loads into the bridge, once per market update: the gate map
  (`universe.load`), region 0's meta (`market.meta`: traffic, risk, skill ids, ores, starters) and the scanned
  regions' order book (`market.book`). Adapters read them through the `ctx` in `android/js/planners.js`.
- Public data the market does not carry is fetched by the app and handed in: ESI adjusted prices and industry cost
  indices (hourly, `build.esi`, shared with Trade), station owners for standings-based broker fees (a second pass
  when the adapter returns `needOwners`), live zKillboard kills and stargate destinations (Haul), EVE-Scout
  wormholes (Explore), live buy orders per region and type (Sell: 6 at once, 150 per plan, 5-minute cache).
- What the website syncs through the journal syncs here too, through `PrefJournal`: scan marks
  (`explored:<id>`, newest per system) and the Haul plan (`haul:<id>`, newest wins). Wing goals read and write the
  journal's `goal` records directly; a write races the website at the record's rev, and a lost race keeps this
  phone's version as a "(conflict copy)", as the web does.
- Tests: every adapter is pinned to what Node prints for the same call on `src/test/resources/plan-fixture.json`
  (the web's e2e market with times pinned; regenerate with `node scripts/android-plan-fixture.mjs`), plus a
  screenshot golden per screen in `PlanSnapshotTest`.

## The Corp feature (corp)

- `CorpRepository` (`container.corp`) reads `GET /api/corp` with the flying pilot's session (else the wingmate's) and
  each pilot's own `GET /api/assets`; pull-to-refresh reloads the snapshot. Assets are valued at ESI's average prices
  (markets/prices, hourly), as the website values them.
- `CorpSection` gives every screen the same frame: no snapshot yet (404), the backend's error, a section the source
  pilot's in-game role can't read ("needs role Director"), one never read, then the content; the snapshot's age and
  source pilot sit on top. Fuel hours and days come computed from the Worker (worker/corp.js withHealth).
- The console (`CorpOverview.kt`, `CorpConsole.kt`): `overview` is the first hub entry; its card is the overview in
  miniature (corporation logo, ticker from ESI `corporations/{id}`, members, a rolling treasury, health rings), the
  full screen adds the fuel bay (`LiquidGauge`: the fill sloshes when its value changes, a notch marks the alert line,
  reinforced rows pulse red) and "Locked sections" (`roleNotes`: which in-game role a section needs and who can fix it).
  The thresholds (`Thresholds`, `Starbase.health()`) are shared with the alerts. Reduced motion and screenshots stand still.
- Refuel planner (`CorpFuel.kt`, `CorpRefuel.kt`): `refuelPlan(snapshot, days)` tops each tower (blocks per hour by size,
  block by race) and structure (online services' burn, an estimate by service name) up to 7/14/30 days from what its bay
  holds, 5 m³ a block; `multibuy(plan)` is the "name quantity" list Copy shopping list puts on the clipboard.
- Local alerts (`CorpAlerts.kt`, `CorpAlertWork.kt`, `CorpAlertSettings.kt`): `CorpFeature.start` enqueues unique hourly
  `CorpAlertWorker` work (network required). It reads `/api/corp` for each connected pilot (one snapshot per corporation)
  and `evaluateAlerts` returns what is new: a tower under 24 h, a structure under 3 days, a reinforced tower or structure.
  Told keys (`kind:corp:item`, per reinforcement phase) are stored in SharedPreferences `corp_alerts` and forgotten once the
  condition clears, so a refuel re-arms the item; a switched-off type or an unread section keeps its keys. Each type has a
  switch in Settings (`CorpAlertSettingsSection`, one line in `nav/Settings.kt`). A tap opens `MainActivity.open(ctx,
  "Corp/starbases/<id>")`: the deep link's third part is the screen's `ctx.arg`, and the screen scrolls to that item and lights it.
- Tests parse `src/test/resources/corp-fixture.json`, an answer built with the Worker's own corp.js helpers.

## Features that start with the app

`Feature.start(container)` runs from `EchelonApp.onCreate`. Fly uses it so timers saved on the phone come back (and
their service restarts) when the app is opened, before anyone visits the Fly tab.

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

The identity is **Formation**: two darts flying in echelon (Fiofka leading in amber, Decxus stepped back in cyan)
inside a plotted arc, with an Ion → Flare beacon. Its motif is the *step*: a 45° cut on the top-end corner of anything
that leads somewhere, and three stepped bars (`EchelonStripes`) in front of headings. The DesignCatalog (and its
`DesignCatalogPagesTest` goldens, a screen at a time) shows all of it.

- `EchelonTheme(settings, pilot)` wraps everything (the shell does it). Read tokens through `Echelon`:
  `Echelon.colors.surface1`, `Echelon.type.num`, `Echelon.pilot.color`, `Echelon.reduceMotion`, `Echelon.backdrop`.
  Spacing, radii, type sizes, durations and easings are `Spacing` (`touch` 48 dp, `maxContent` 720 dp), `Radii`
  (`cut` is the motif), `TypeScale`, `Durations` (`stagger`, `celebrate`), `Easings` (`emphasized` for arrivals).
  Material components get the same palette through the mapped `ColorScheme`.
- Colours: ink grounds with a violet cast (`bg` `#090C18`, `surface1..3`); **Ion** violet `accent` `#A58CFF` is the UI
  accent; **Flare** `#FF7AC6` is brand-only (`colors.flare`, `colors.brand` = Ion → Flare: the beacon, celebrations,
  a progress bar's fill, never a state). Pilot colours are identity only (`PilotColors.Fiofka` `#F0BB5C`,
  `PilotColors.Decxus` `#5CD3DE`, `PilotColors.of(id)`); `ok`/`warn`/`danger`/`info` are states; security uses EVE's
  palette (`secColor`, `secText`, `SecurityBadge`). Every text colour is WCAG AA on every surface, and the pilots stay
  far apart in hue: `ColorContrastTest` checks both.
- Type (variable fonts, OFL, in `res/font`, licences in `assets/licenses`): **Oxanium** for display
  (`Echelon.type.hero`, `screenTitle`, `overline` for spaced capitals, Material's display/headline slots), **Saira** at
  90 % width for the UI (every body/title/label slot), **JetBrains Mono** for figures (`Echelon.type.num`, `numLarge`,
  `numSmall`; tabular, slashed zero). `Michroma`/`Barlow`/`MartianMono` remain as deprecated aliases.
- Shapes: `formationShape(cut, radius)` (top-end corner cut, RTL-aware) for primary panels, hub cards, the primary
  button and the tab pill; `cutCornerShape()` is its square-cornered form.
- Brand (`ui.components`): `Emblem(size, highlight, animate)` (with `animate` the formation assembles: arc, leader,
  wingman, beacon), `Wordmark`, `EchelonStripes`, `Dart` (the pilot marker in `PilotBadge`/`WingChip`). The launcher
  icon (`ic_launcher_background`/`_foreground`/`_monochrome` for themed icons), `ic_emblem`, the notification
  silhouette `ic_stat_echelon` and the splash (`avd_splash`: the same assembly, then a lift-and-fade hand-off in
  `MainActivity`) share the emblem's geometry.
- Components (`ui.components`): `EchelonCard` (`shape`, `onClickLabel`; sinks under the finger when clickable),
  `PrimaryPanel` (tick ruler and lit cut edge: one per screen), `SectionHeader`, `Hairline`, `StatTile`/`StatRow`,
  `Tag`, `ChoiceChip`, `SecurityBadge`, `PilotBadge`, `StatusDot` (`live` breathes), `ListRow`, `KeyValueRow`,
  `ProgressBar` (brand fill; a sheen when it reaches 100 %), `ProgressRing`, `SkeletonRows`/`Modifier.shimmer()`,
  `LoadingCrossfade(loading) { content }`, `EmptyState`, `ErrorState`, `Countdown` (bursts when it reaches zero;
  `celebrate = false` to opt out)/`RollingText`/`rememberNow`, `Portrait`, `TypeIcon`, `EveImages`,
  `PrimaryButton`/`SecondaryButton`/`LinkButton`, `WingChip`, `GridBackground` (dot grid and a glow of the flying
  pilot's colour), `HeroBackground`, `EchelonRefreshBox` (pull-to-refresh with the Formation indicator),
  `ContentWidth` (caps a column at `Spacing.maxContent`). `Tone` picks neutral/accent/ok/warn/danger/info everywhere.
  In `nav`: `HubCard(title, summary, icon, onOpen, trailing = …)` lets a feature's live hub `card` keep the hub's look.
- Formatting (`ui.format`): `compactNumber`, `format(value, Kind.Isk|Pct|Hours|Count)` (the web's `format()`), `isk()`
  (two decimals), `duration`, `left`, `clock` (countdowns), `ago`, `parseIsk`, `plural`, `secShown`, `secBand`,
  `secLabel`. `FormatTest` pins them to values printed by the web's own functions.
- Icons: `EchelonIcons`, a 1.6-stroke line set on a 20-unit grid. The destinations have filled twins
  (`PlanSelected`, `FlySelected`, `CorpSelected`) that the tab bar swaps to; also `Wing` (the darts), `Waypoint`,
  `Gauge`, `Target`, `Bell`, `Sparkle`. `material-icons-core` is available for anything else.

### Motion vocabulary (ui.motion)

Motion answers an action or shows something is live; nothing else moves. Every piece honours reduced motion (the
system's Remove animations, or the app's setting): no travel, at most a short fade. Screenshots run in inspection
mode and render end states, so goldens never catch an animation mid-way.

| Moment | API | What it does |
|---|---|---|
| A screen opens | `StaggerRoot(key)` + `Modifier.entrance(index?)` | Cards, panels, headers, stat tiles, rows, empty and error states rise 16 dp and fade in, 40 ms apart, for the first 0.7 s of a screen; once per visit. The shell wraps every hub, sub-screen and Settings. `NoEntrance { }` stops it below a point (a card's content enters with the card). |
| Hub → screen | `sharedContainer(key)`, `sharedText(key)`, `sharedHero(key)` | The hub card becomes the screen (container transform) and its title flies into the back bar. `sharedHero` is for an element that looks the same in both places (a portrait). |
| Push / pop / back gesture | `NavMotion` | Slide a fifth of the width on a spring with a fade; predictive back scrubs the pop. Tabs fade through with a slight zoom. |
| Press, hover | `Modifier.pressScale(interactionSource)` | Sinks to 97 % on a stiff spring, lifts a hair on hover. Built into cards, rows, buttons, chips and the tab bar. |
| Tab change | `BottomBar` | The Formation pill travels like a worm (leading edge first), the icon swaps to its filled twin and pops. |
| Numbers | `AnimatedNumber`, `RollingText`, `Countdown` | Count up once; changed digits roll. |
| Loading → content | `LoadingCrossfade`, `shimmer()` | A diagonal sheen over skeleton rows, then a cross-fade into content that staggers in. |
| Refresh | `EchelonRefreshBox` | The disc drops with the pull, its arc plots to a ring (tick haptic at the threshold), then spins in the brand gradient. |
| Done! | `Modifier.celebrate(fire, key)`, `CelebrationFrame` | A one-shot burst of darts and sparks in both pilots' colours with a ring and a confirm haptic, when `fire` turns true on screen (not when a screen opens already done). `Countdown` does it at zero; a goal reaching 100 % should use it too. |
| Live | `Modifier.pulse(active, color)`, `StatusDot(live = true)` | A halo that breathes. |
| Backdrop | `Starfield`/`HeroBackground` | Three parallax star depths, two wandering nebulae and, twice a minute and a half, a pair of streaks in echelon. One infinite transition; still when reduced. The hub hero parallaxes and fades as the list scrolls over it. |
| Splash | `avd_splash`, `MainActivity` | The emblem assembles, then lifts and fades into the app. |

Also: `Springs.nav/select/value/press/pop/enter`, `motionSpec(full, reduced)` (snap when reduced),
`rememberHaptics()` (`select`, `tick`, `confirm`, `reject`, `heavy`, `gestureEnd`).


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
