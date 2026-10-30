# EVE Flight Journal

A GitHub Pages companion for **Fiofka** and **Decxus**. See your public EVE profiles, connect private training data, set milestones, and keep a personal flight record.

Source: https://github.com/matheusfiorin/eve-journal

## What works in this version

- Public character lookup, portraits, corporations, birthday, character age, and security status from EVE ESI.
- Read-only skills, total/unallocated SP, and training queues after each pilot authorizes EVE login. Shows the active skill, training progress, queue end, paused skills, and a searchable trained-skill list.
- Goals with a pilot, focus, optional target date, completion state, editing, and open/completed filters.
- Private journal with editing, dates, focus categories, text search, pilot filters, and tab-local draft recovery.
- Overview with local milestone counts, next goal, and latest journal entry.
- JSON backup export and merge, recovery downloads for malformed saved data, and protection against overwriting a journal changed in another tab.
- Responsive layout, keyboard focus indicators, named form fields, live status messages, and local system fonts. No analytics or font CDN.

**Privacy:** journal entries and goals are stored in this browser, not shared automatically. Public hosting does not publish your notes or training. Your friend can read the same public pilot profiles but will not see your local journal. Export a backup before changing browsers or clearing site data. Backups include private notes; share them intentionally.

## Verification status

Syntax checks and automated tests cover backup validation/merge, calendar dates, filtering, training calculations, storage corruption/quota handling, concurrent-tab conflicts, PKCE, signed JWT validation and rejection cases, DOM control references, and Pages artifact completeness.

Desktop and mobile Chromium user flows are now tested with Playwright, and screenshots have been reviewed. Public ESI character lookup, profiles, SSO discovery, and token-endpoint CORS have also been checked live. See [the feature and verification map](FEATURE-MAP.md) for per-feature coverage. Real character authorization still requires an EVE-registered client and consent from each pilot. The SSO implementation follows CCP's published PKCE flow and validates tokens locally using CCP's JWKS, but that is not a substitute for a live end-to-end login with your registered application.

GitHub Pages is enabled. Controlled browser tests gate deployment; live public-service and published-site smoke tests run after deployment. Browser reports, screenshots, and failure traces are retained as Actions artifacts for seven days.

## Run locally

Node.js 24 and Python 3 are sufficient. The application has no runtime dependencies; Playwright is a development-only browser-test dependency.

```sh
git clone https://github.com/matheusfiorin/eve-journal.git
cd eve-journal
npm ci
npm run check
npm test
npm start
```

Open http://localhost:8000/. Serve over HTTP locally or HTTPS in production; do not open `index.html` as a file.

## GitHub Pages

1. Open repository **Settings → Pages → Build and deployment**.
2. Select **GitHub Actions** as the source.
3. Open **Actions → Deploy GitHub Pages → Run workflow** on `main`.

Subsequent pushes to `main` validate and deploy automatically. Pull requests run validation only. The expected URL is **https://matheusfiorin.github.io/eve-journal/**; the Actions deployment result is the source of truth for publication.

The Pages artifact contains only explicitly listed public app files. No private journal, token, test fixture, or local environment file is packaged.

## Configure the pilots

`config.json` sets public defaults for every visitor:

```json
{
  "title": "EVE Flight Journal",
  "pilots": ["Fiofka", "Decxus"],
  "eveClientId": ""
}
```

**Configure pilots** overrides these defaults in the current browser. It does not change the repository. A client ID is a public identifier; never put a client secret in this project.

## Connect EVE Online

1. Register an application at https://developers.eveonline.com/ that supports a public/native Authorization Code flow with PKCE. Request only `esi-skills.read_skills.v1` and `esi-skills.read_skillqueue.v1`.
2. Register this exact callback, including the trailing slash: `https://matheusfiorin.github.io/eve-journal/`. For development, use a separately registered localhost callback if your application configuration supports it. The Configure pilots dialog displays the callback for the current environment.
3. Put the public client ID in `config.json` or **Configure pilots → Enable private skills & training**.
4. In Overview, connect a pilot and choose that same character in EVE login. Repeat for the other pilot if you both want to authorize this browser session. Each pilot authorizes their own account; do not share EVE passwords.

The app uses PKCE S256 with a one-use state and five-minute callback lifetime. It verifies RS256/ES256 signatures using keys from the fixed CCP JWKS endpoint, plus issuer, audience, expiry, authorized party, character, and scopes. Saved session tokens are revalidated on load. Refresh tokens are discarded. Access tokens live only in `sessionStorage` for this tab and expire after about 20 minutes; reconnect when asked. Disconnect removes the browser token and training view. To revoke the application's grant server-side, use EVE account management.

**Integration constraint:** browser CORS behavior and your registered EVE application's configuration must be verified live. If EVE requires a confidential client or does not permit the browser token exchange for your configuration, use a small OAuth backend. Never expose a client secret to make it work. This version does not provide a backend, shared private training, or unattended updates.

Reference: [current EVE SSO documentation](https://developers.eveonline.com/docs/services/sso/), including Authorization Code with PKCE and JWT validation.

## Storage and recovery

- Saved records: localStorage key `eve-flight-journal:v1`. Older v1 backups remain compatible; focus categories and target dates are optional.
- Unsaved draft: sessionStorage key `eve-flight-draft:v1`, restored in the same tab. This is a convenience, not a backup.
- Browser settings: localStorage key `eve-flight-settings:v1`.
- EVE session: sessionStorage key `eve-sessions`; pending authorization uses `eve-oauth`.
- Exports include saved entries and goals, not drafts, tokens, or settings. Save a draft before exporting if you want it in the backup.
- Import validates the whole file before writing. Matching IDs are replaced only after confirmation. Other records remain intact. There is a 5 MB import limit and a 10,000-record limit.
- If saved data is unreadable, writes are blocked. Use **Journal → Download raw recovery file** to preserve the bytes before repairing browser site data. Exporting an empty replacement is also blocked.
- If another tab changes saved records, reload before saving. Your draft remains in the current tab. The comparison prevents ordinary stale-tab overwrites; localStorage is not a transactional multi-user database.

All scripts hosted on the same origin can access localStorage. Deploy trusted code only. EVE portraits and API requests contact CCP services; notes are never sent with those requests.

## Additional acceptance checks

1. Confirm Fiofka and Decxus resolve to the correct characters and corporations. Refresh with the network unavailable and confirm existing profiles remain visible with an error.
2. Add/edit/complete/filter goals. Write and edit an entry, search by text/pilot/focus, reload an unsaved draft, and test date selection around your local midnight.
3. Export and restore in a separate browser. Check duplicate IDs merge, impossible dates fail, and literal HTML in notes displays safely.
4. Open two tabs, save in one, and confirm the other cannot overwrite the change. Test unavailable/full storage and raw recovery for invalid saved JSON.
5. Register EVE login, connect the correct and incorrect characters, cancel authorization, and test session expiry/disconnect. Compare skill points and queues with the game.
6. Inspect desktop and narrow-screen layouts, keyboard navigation, form validation, and search after edits.
7. Confirm the Pages deployment succeeds and that a private browser window has neither journal entries nor authenticated training data.

Wallet, assets, industry APIs, killboards, screenshot uploads, and shared journal synchronization are not implemented.

EVE Online and related imagery are property of CCP Games. This is an independent fan project, not affiliated with or endorsed by CCP Games.
