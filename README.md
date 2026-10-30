# EVE Pilot Console

A dashboard for **Fiofka** and **Decxus**: GitHub Pages frontend, Cloudflare Worker backend.

Live: https://matheusfiorin.github.io/eve-journal/

## What it shows

- **Overview** — portrait, corporation, skill points, wallet, location, ship, security status, corporation history, and a training alert.
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

A pilot who connected before a scope was added sees "Permission not granted" for that data and can press **Reconnect** to grant it.

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
