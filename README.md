# EVE Pilot Console

A dashboard for **Fiofka** and **Decxus**: GitHub Pages frontend, Cloudflare Worker backend.

Live: https://matheusfiorin.github.io/eve-journal/

## What it shows

The first visit asks **who's flying** (Fiofka or Decxus) in a full-screen picker. The browser remembers the choice, and every view centres on that pilot and compares them with their wingmate. Switch from the header.

- **Overview** — your title (rank + specialty from your skill points), training alert, and a head-to-head with your wingmate: skill points, level-V skills, net worth, wallet, assets and queue length.
- **Empire** — combined net worth of both pilots, each pilot's share, who brings what, holdings by category, both titles with their role breakdown, and the most valuable holdings.
- **Market** — opportunities from your pilot's current system (or a trade hub): haul & flip routes ranked by profit per jump, station trading spreads, and manufacturing margins. Fees come from your Accounting and Broker Relations; cargo defaults to your current ship.
- **Industry** — an early-game plan for the chosen pilot: alpha/omega detection, job slots, fees, the cheapest place to build, a stage plan by wallet, the next skills to train, and the best NPC-sold T1 blueprints to start with. A starting plan fills each pilot's build slots within their wallet, skipping blueprints they lack the skills for and never giving both pilots the same product. Each pick shows its research plan (ME target, time, cost), required skills, the full material bill (bought in one region), margin, profit per day and payback. Sale prices are capped at 15% over the 7-day average, and thin, spiking, crowded or low-margin markets are flagged and ranked lower. It lists the cheapest safe NPC factories and labs within 10 high-sec jumps, and every pick has a trip plan: where to buy the blueprint, research, buy materials, build and sell, each leg with its jump-by-jump route (coloured by security) and a Dotlan map link.
- **Mining** — the best belts within reach of each pilot right now: which ores can spawn there (by security and empire), ISK per hour for your ship and skills, ore valued at the best of selling raw, compressed or reprocessed, last hour's kills and traffic per system, a jump-by-jump route, a ship comparison with what to train next, and the last 30 days of your mining ledger valued at today's prices. High-sec by default; tick **Include low-sec** to widen it.
- **Training** — the active skill with progress, a queue timeline, and alerts when the queue is empty, paused, or runs out within 24 hours.
- **Skills** — the full skill sheet grouped by skill group, with levels, SP per skill and group, and search.
- **Wallet** — balance, the latest 50 journal entries and market transactions, and current industry jobs.
- **Clones** — attributes and remaps, active implants, home station, jump clones and the next clone jump time.
- **Notes** — goals and a journal stored only in this browser, with export, import and draft recovery.

Visitors without a session see public profiles plus each pilot's shared skill total and queue. Everything else needs that pilot's own session.

A browser stays connected: its session is kept in `localStorage` and renews itself on every daily visit, expiring only after 30 days without use. Redeploys don't log anyone out, because sessions, encrypted EVE authorizations and the encryption key all live in Cloudflare, and the backend keeps syncing every 30 minutes even with no browser open. **Disconnect** ends it everywhere.

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

A pilot who connected before a scope was added sees "Permission not granted" for that data and can press **Reconnect** to grant it.

### Wingmate sharing

On the consent page each pilot can tick **share with my wingmate**. Their skills, wallet balance and asset summary (and, for pilots who connected after the Mining tab shipped, their ship, location and mining ledger) then reach the other pilot's session through `GET /api/wing`. That data is never public.

### Market pipeline

`.github/workflows/market.yml` runs every hour (and on demand). `scripts/market-pipeline.mjs` resolves `market/watchlist.json`, adds the materials of each item's blueprint (blueprints from CCP's official static data export), screens up to 400 cheap T1 blueprints and surveys high-sec regions for NPC sell orders (365-day orders) so the Industry tab only suggests blueprints you can actually buy, with their real seller stations. ESI rate-limits market orders, so the survey is incremental: each run spends up to 20 minutes refreshing the regions not checked in the last 20 hours, the pilots' and trade hubs' regions first, and keeps its progress in the Worker. It then builds the gate map (with asteroid belts per system), the NPC factory/lab list and belt-ore reprocessing data from the SDE, records last hour's kills and jumps per system, and scans ESI orders in the five trade hubs plus every region a connected pilot is in. It keeps the best prices per NPC station and uploads the result to the Worker (`POST /api/market/ingest`, signed with an HMAC of the EVE client secret). The browser reads `GET /api/market` and adds jump distances from the pilot's position. Edit the watchlist to scan other items.

## Develop

```sh
npm ci
npm run check
npm test              # unit + Worker tests
npm run test:e2e      # browser tests against a mocked backend
npm start             # http://localhost:8000/
```

Pushing to `main` runs the tests, deploys the Worker and Pages, then runs live smoke tests.

## Notes storage

Goals and entries live in `localStorage` (`eve-flight-journal:v1`); the unsaved draft lives in `sessionStorage`. Unreadable saved data blocks writes and offers a raw recovery download. A change made in another tab blocks stale saves.

EVE Online and related imagery are property of CCP Games. This is an independent fan project, not affiliated with or endorsed by CCP Games.
