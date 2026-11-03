# Echelon (EVE Pilot Console)

A wing console for **Fiofka** and **Decxus**, two pilots who fly EVE Online together: GitHub Pages frontend, Cloudflare Worker backend.

Live: https://matheusfiorin.github.io/eve-journal/

## What it shows

The first visit asks **who's flying** (Fiofka or Decxus) in a full-screen picker. The browser remembers the choice, every view centres on that pilot, and the wingmate's plans sit right alongside. Switch from the top bar.

Seven destinations sit in the left rail (a bottom bar on phones): **Bridge**, **Wing** (Crew map, Goals), **Pilot** (Training, Skills, Clones), **Earn** (Build, Mine, Explore, Trade), **Navigate** (Star map, Haul plan), **Ledger** and **Logbook**. Each view has its own address (`#earn/mine`), and old links like `#mining` still work. **Ctrl/Cmd K** searches screens, actions and systems; `g` then a letter jumps to a destination, `1`–`4` switches views, and `?` lists every shortcut.

- **Bridge** — your title (rank + specialty from your skill points), training alert, ship and position, and your wing: the wingmate's training, wing net worth and combined skill points.
- **Wing → Crew map** — wing net worth, holdings by category, what we own (grouped, with each owner's portrait) and each pilot's role breakdown.
- **Earn → Trade** — opportunities from your pilot's current system (or a trade hub): haul & flip routes ranked by profit per jump, station trading spreads, and manufacturing margins, all sized to your budget (your wallet unless you type another). Fees come from your Accounting and Broker Relations; cargo defaults to your current ship.
- **Earn → Build** — an early-game plan for the chosen pilot: alpha/omega detection, job slots, fees, the cheapest place to build, a stage plan by wallet, the next skills to train, and the best NPC-sold T1 blueprints to start with. Picks are sized to the budget (your wallet by default): a small wallet buys fewer runs, and picks it can't cover at all are hidden unless you ask for them. A wing build plan fills each pilot's build slots within their wallet, skipping blueprints they lack the skills for and never giving both pilots the same product. Each pick shows its research plan (ME target, time, cost), required skills, the full material bill (bought in one region), margin, profit per day and payback. Sale prices are capped at 15% over the 7-day average, and thin, spiking, crowded or low-margin markets are flagged and ranked lower. It lists the cheapest safe NPC factories and labs within 10 high-sec jumps, and every pick has a trip plan: where to buy the blueprint, research, buy materials, build and sell, each leg with its jump-by-jump route (coloured by security) and a Dotlan map link.
- **Earn → Mine** — the best belts within reach of each pilot right now: which ores can spawn there (by security and empire), ISK per hour for your ship and skills, ore valued at the best of selling raw, compressed or reprocessed, last hour's kills and traffic per system, a jump-by-jump route, a ship comparison with what to train next, and the last 30 days of your mining ledger valued at today's prices. High-sec by default; tick **Include low-sec** to widen it.
- **Earn → Explore** — where to scan for relic and data sites. ESI has no signature counts, so “least explored” means least travelled: systems are ranked by jumps over ~24 hours (decayed hourly history), ship kills (weighted by a careful/normal/bold setting), distance and dead ends, and systems you or your wingmate visited recently (the backend keeps a 7-day location trail; **Mark scanned** adds your own) sink. A scanning loop visits the best picks in the fewest jumps and returns to your start, with time, risk, 3D view, Dotlan and **Send to autopilot**. It suggests your race's explorer frigate and the exploration skills to train next. High-sec is the default; tick low-sec or null-sec when you're ready, and live Thera/Turnur wormhole connections from EVE-Scout show the way into wormhole space.
- **Navigate → Haul plan** — plan a trip through any number of stops (optionally in the best order, or back to the start) and compare three routes: safest, balanced and shortest. Each system's risk combines the pipeline's 24-hour and 7-day kill history (ESI) per passing ship, how attractive your cargo is to gankers, your hull, and live gate camps: zKillboard's last hour of kills in every region on the route, counted per gate you actually use, flagged for smartbombs and interdictors. Routes minimise jumps × the value of your time + cargo value × −ln(chance of arriving). Every system links to zKillboard, the trip opens on Dotlan, and **Send to autopilot** sets the route in game.
- **Navigate → Star map** — a Dotlan-style map of New Eden built from CCP's own 2D region layout and 3D star positions. Region maps show every system with a glowing security light, gates, constellation borders and links to neighbouring regions; drag (one finger) to pan, scroll or pinch to zoom, and **Fit** shows the whole region. **Region in 3D** and **New Eden in 3D** orbit the real star positions (drag to turn, pinch or scroll to zoom, two fingers to pan) with auto-rotation that stops when you prefer reduced motion; the 3D map only redraws while something moves. **List** shows the region as a sortable table (security, kills over 1 h/24 h/7 days, jumps, belts, NPC stations and services, build index, incursions and faction warfare). Overlays from live ESI: ship, pod and NPC kills and jumps in the last hour, ~24-hour ship kills, sovereignty (coloured per owner), faction warfare, incursions, the manufacturing index, belts and NPC stations; the legend names the security bands and each overlay's scale, and says when a live feed is unavailable or an overlay is empty in the region. Jump range (Black Ops, jump freighter, capitals, supers) highlights low/null-sec systems in light-years. The address keeps the region, system, overlay, jump range and view (`#navigate/map?r=10000002&s=30000142&o=shipKills&v=3d`), so links can be shared and **Back** steps through your selections; the view, overlay and jump range you last used are remembered in this browser. Routes opened with **Open in Star map** stack as coloured layers (up to four) with A/B badges, hop numbers and a note where the route leaves the region; the bar on the map fits each route, sends it to the autopilot or removes it. Click a system for its panel: security, constellation, live stats, sovereignty, faction warfare, incursion, industry indices, gates, NPC stations and their services, a route from your location, **Haul here**, **Haul from**, **Add as stop**, **Set destination**, Dotlan and zKillboard. On phones the map fills the screen: search and **Layers** float on top, zoom, Fit and Locate me sit in a thumb-sized stack, and the system panel is a bottom sheet you drag between peek, half and full. Keyboard: Tab reaches the map once, arrow keys follow gates (and region exits) and Enter selects; in 3D the arrows turn, +/− zoom and Enter picks the star in the middle. Search (**Ctrl/Cmd K**) shows a system on the Star map; **Shift+Enter** opens it in 3D.
- **Routes everywhere** — every route in Market, Industry, Mining and Hauling previews as a sketch when you hover it, and **3D view** opens it in a 3D modal with its jump strip; system names open their panel; **Open in Star map** carries the route onto the full map.
- **Pilot → Training** — the active skill with progress, a queue timeline, and alerts when the queue is empty, paused, or runs out within 24 hours.
- **Pilot → Skills** — the full skill sheet grouped by skill group, with levels, SP per skill and group, and search.
- **Ledger** — balance, the latest 50 journal entries and market transactions, and current industry jobs.
- **Pilot → Clones** — attributes and remaps, active implants, home station, jump clones and the next clone jump time.
- **Wing → Goals** and **Logbook** — shared goals and a journal stored only in this browser, with export, import and draft recovery. A goal can carry an ISK target, the result so far (shown as progress, with “target reached”), a checklist of steps you tick off on the goal, and notes.

Visitors without a session see public profiles plus each pilot's shared skill total and queue. Everything else needs that pilot's own session.

A browser stays connected: its session is kept in `localStorage` and renews itself on every daily visit, expiring only after 30 days without use. Redeploys don't log anyone out, because sessions, encrypted EVE authorizations and the encryption key all live in Cloudflare, and the backend keeps syncing every 30 minutes even with no browser open. **Disconnect** ends it everywhere.

## Jobs

**Earn → Jobs** lists every industry job running for the wing (your own, plus your wingmate's when they share with you): ready-to-deliver first, then the soonest to finish, with a progress bar, time left and end time, runs (copies × runs for copy jobs), where it runs and its cost in the detail drawer. It also shows each pilot's build and science slots in use and flags idle build slots. ESI can still report a finished job as active for a few minutes; the page counts it as ready once its end time passes.

## How it works

Each pilot connects once through the Worker (`/auth/start`), which runs EVE SSO with PKCE and a confidential client, stores the refresh token encrypted in D1, and syncs ESI every 30 minutes. The browser only ever holds an opaque 24-hour session; it never sees EVE tokens. See [worker/README.md](worker/README.md).

### EVE application scopes

Enable all of these on the EVE application (client ID `a94f7ccbcc8b4b0d8f7fd90fec110d2b`):

- `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1` (required)
- `esi-wallet.read_character_wallet.v1`
- `esi-location.read_location.v1`, `esi-location.read_ship_type.v1`
- `esi-industry.read_character_jobs.v1`, `esi-industry.read_character_mining.v1`
- `esi-clones.read_clones.v1`, `esi-clones.read_implants.v1`
- `esi-assets.read_assets.v1`
- `esi-ui.write_waypoint.v1` (Hauling: send a route to the in-game autopilot)

A pilot who connected before a scope was added sees "Permission not granted" for that data and can press **Reconnect** to grant it.

### Wingmate sharing

On the consent page each pilot can tick **share with my wingmate**. Their skills, wallet balance and asset summary (and, for pilots who connected after the Mining tab shipped, their ship, location and mining ledger) then reach the other pilot's session through `GET /api/wing`. That data is never public.

### Market pipeline

`.github/workflows/market.yml` runs every hour (and on demand). `scripts/market-pipeline.mjs` resolves `market/watchlist.json`, adds the materials of each item's blueprint (blueprints from CCP's official static data export), screens up to 400 cheap T1 blueprints and surveys high-sec regions for NPC sell orders (365-day orders) so the Industry tab only suggests blueprints you can actually buy, with their real seller stations. ESI rate-limits market orders, so the survey is incremental: each run spends up to 20 minutes refreshing the regions not checked in the last 20 hours, the pilots' and trade hubs' regions first, and keeps its progress in the Worker. It then builds the gate map (with asteroid belts, 3D positions, CCP's schematic layout, constellations and region names), every NPC station with its services, the NPC factory/lab list and belt-ore reprocessing data from the SDE, records last hour's kills and jumps per system and keeps decayed histories of ship kills (24 h and 7 days) and jumps (24 h), and scans ESI orders in the five trade hubs plus every region a connected pilot is in. It keeps the best prices per NPC station and uploads the result to the Worker (`POST /api/market/ingest`, signed with an HMAC of the EVE client secret). The browser reads `GET /api/market` and adds jump distances from the pilot's position. Edit the watchlist to scan other items.

## Develop

```sh
npm ci
npm run check
npm test              # unit + Worker tests
npm run test:e2e      # browser tests against a mocked backend
npm start             # http://localhost:8000/
```

Pushing to `main` runs the tests, deploys the Worker and Pages, then runs live smoke tests.

The page is static ES modules with no build step. `app.js` boots the app and routes between views; `ui/` holds the shell and shared helpers, and each destination owns `ui/screens/<name>.js` (its markup, renderers and listeners) and `styles/<name>.css`. Design tokens live in `styles/tokens.css`. The pure planning modules (`model.js`, `market.js`, `industry.js`, `route.js`, …) stay at the root with their unit tests.

## Notes storage

Goals and entries live in `localStorage` (`eve-flight-journal:v1`); the unsaved draft lives in `sessionStorage`. Unreadable saved data blocks writes and offers a raw recovery download. A change made in another tab blocks stale saves.

EVE Online and related imagery are property of CCP Games. This is an independent fan project, not affiliated with or endorsed by CCP Games.
