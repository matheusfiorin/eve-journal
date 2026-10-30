# EVE Pilot Console

A dashboard for **Fiofka** and **Decxus**: GitHub Pages frontend, Cloudflare Worker backend.

Live: https://matheusfiorin.github.io/eve-journal/

## What it shows

The first visit asks **who's flying** (Fiofka or Decxus) in a full-screen picker. The browser remembers the choice, and every view centres on that pilot and compares them with their wingmate. Switch from the header.

- **Overview** — your title (rank + specialty from your skill points), training alert, and a head-to-head with your wingmate: skill points, level-V skills, net worth, wallet, assets and queue length.
- **Empire** — combined net worth of both pilots, each pilot's share, who brings what, holdings by category, both titles with their role breakdown, and the most valuable holdings.
- **Market** — opportunities from your pilot's current system (or a trade hub): haul & flip routes ranked by profit per jump, station trading spreads, and manufacturing margins. Fees come from your Accounting and Broker Relations; cargo defaults to your current ship.
- **Training** — the active skill with progress, a queue timeline, and alerts when the queue is empty, paused, or runs out within 24 hours.
- **Skills** — the full skill sheet grouped by skill group, with levels, SP per skill and group, and search.
- **Wallet** — balance, the latest 50 journal entries and market transactions, and current industry jobs.
- **Clones** — attributes and remaps, active implants, home station, jump clones and the next clone jump time.
- **Notes** — goals and a journal stored only in this browser, with export, import and draft recovery.

Visitors without a session see public profiles plus each pilot's shared skill total and queue. Everything else needs that pilot's own session.

## How it works

Each pilot connects once through the Worker (`/auth/start`), which runs EVE SSO with PKCE and a confidential client, stores the refresh token encrypted in D1, and syncs ESI every 30 minutes. The browser only ever holds an opaque 24-hour session; it never sees EVE tokens. See [worker/README.md](worker/README.md).

### EVE application scopes

Enable all of these on the EVE application (client ID `a94f7ccbcc8b4b0d8f7fd90fec110d2b`):

- `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1` (required)
- `esi-wallet.read_character_wallet.v1`
- `esi-location.read_location.v1`, `esi-location.read_ship_type.v1`
- `esi-industry.read_character_jobs.v1`
- `esi-clones.read_clones.v1`, `esi-clones.read_implants.v1`
- `esi-assets.read_assets.v1`

A pilot who connected before a scope was added sees "Permission not granted" for that data and can press **Reconnect** to grant it.

### Wingmate sharing

On the consent page each pilot can tick **share with my wingmate**. Their skills, wallet balance and asset summary then reach the other pilot's session through `GET /api/wing`. That data is never public.

### Market pipeline

`.github/workflows/market.yml` runs every hour (and on demand). `scripts/market-pipeline.mjs` resolves `market/watchlist.json`, adds the materials of each item's blueprint (blueprints from CCP's official static data export), and scans ESI orders in the five trade hubs plus every region a connected pilot is in. It keeps the best prices per NPC station and uploads the result to the Worker (`POST /api/market/ingest`, signed with an HMAC of the EVE client secret). The browser reads `GET /api/market` and adds jump distances from the pilot's position. Edit the watchlist to scan other items.

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
