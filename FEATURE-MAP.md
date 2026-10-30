# Feature and verification map

This document separates actual public-service checks, browser tests using controlled EVE responses, and checks that require a player account. Automated screenshots, traces, and HTML reports are uploaded by GitHub Actions. Test fixtures contain generated signing keys and synthetic training data, never player credentials.

## Application features

| Feature | Browser coverage | External dependency |
| --- | --- | --- |
| Fiofka / Decxus public character lookup | Public profile and LIVE dashboard tests | Real ESI IDs confirmed: 2124810474 / 2124815118 |
| Portraits, corporation, birthday, age, security status | Public profile test; LIVE published screenshot | Real CCP services; screenshots are evidence of the rendered page |
| Section navigation and overview shortcuts | Public profiles/navigation test | None |
| Local overview totals, next goal, latest entry | Overview reflects local history test | Browser storage |
| Missing-character error and disabled login | Unknown characters test | Controlled ESI response |
| Refresh with previous data retained on failure | Public refresh failure test | Controlled outage |
| Pilot configuration and duplicate-name validation | Settings test | Browser storage |
| EVE application setup and callback display | Missing client ID test | Official developer registration requires authenticated EVE account |
| PKCE authorization URL, scopes, state and callback | Connect produces PKCE request test; RFC vector unit test | Controlled navigation; real EVE endpoint metadata verified |
| Code exchange, signature verification, session restore and URL cleanup | Authorization callback test + signed-token unit tests | Simulated EVE token service; real player authorization is pending |
| Mismatched state, wrong character, cancelled consent | Dedicated callback browser tests | Simulated authorization responses |
| Refresh tokens discarded; session-only access tokens | Callback and export browser tests | No long-lived token persistence |
| Training points, active skill, queue end and paused skills | Connected pilots browser test | Synthetic private ESI data until pilots authorize |
| Empty queue and training permission failure | Empty queue / authorization-error tests | Synthetic private ESI data |
| Searchable skills, trained/active levels | Connected pilots skill-list browser test | Synthetic private ESI data |
| Disconnect and expiry clearing private views | Disconnect / expiry tests | Browser tab session |
| Goal create, edit, complete, reopen, delete | Goal lifecycle browser test | Local only |
| Goal pilot, focus, target date and completion filters | Goal lifecycle + backup field tests | Local only |
| Journal create, edit, cancel, delete and reload persistence | Journal lifecycle / cancel edit tests | Local only |
| Text search combined with pilot and category | Journal filter browser test | Local only |
| Draft reload recovery and discard | Draft recovery browser test | Same tab only |
| Local-calendar dates | Local date and invalid-calendar-date unit tests | Browser timezone |
| Literal HTML in notes and titles | Browser markup-injection test + escaping unit test | None |
| Backup export with no tokens/settings | Download browser test | Saved entries and goals only; drafts are not exported |
| Backup merge, stable IDs and malformed-file rejection | Backup merge browser test + validation unit tests | Imported local JSON |
| Corrupt-storage lock and raw recovery download | Corrupt-storage browser test + storage tests | Browser storage |
| Stale-tab overwrite protection | Stale-save browser test + two-store unit test | Optimistic localStorage comparison, not a database transaction |
| Storage quota/error handling | Storage unit tests | Browser quota failures cannot silently advance saved state |
| Desktop and narrow-screen layout | Both Chromium projects + overflow checks/screenshots | Does not imply Safari or Firefox compatibility |
| Pages packaging and automatic deployment | Packaging test + workflow deployment | GitHub Pages enabled |
| Published site and API availability | Post-deployment LIVE browser/API tests | Actual deployed URL, ESI and SSO CORS |

## Verified browser audit

The final local run passed **70 desktop/mobile browser scenarios** and **33 unit/data/authentication checks**. The browser run exercises real rendered forms, navigation, downloads, reloads, and tab storage against controlled API responses. Desktop and mobile overview/journal screenshots were reviewed.

The audit found and fixed broken skill-list filtering and missing author options for newly saved Both pilots entries. Non-overview sections now omit the large introduction so the journal and training controls remain near the top, particularly on mobile. Developer registration now offers copy-ready callback and scope details.

The local live API checks passed, but local browser navigation to the published HTTPS site encountered the environment proxy's certificate-authority error. Certificate verification was not disabled. The separate post-deployment live-site job runs in GitHub's browser environment to verify the deployed page and real EVE services.

## Live observations

On 2026-10-30:

- The published HTML returned HTTP 200 at `https://matheusfiorin.github.io/eve-journal/`.
- ESI resolved both exact character names to the IDs above.
- Character endpoints returned public profiles and corporation IDs for both pilots.
- EVE SSO discovery advertised Authorization Code, PKCE S256, and the official JWKS endpoint.
- The token endpoint's browser preflight returned HTTP 204 with `Access-Control-Allow-Origin: *` and POST allowed.
- Opening `https://developers.eveonline.com/applications` without an authenticated EVE session redirected to EVE account login. GitHub authentication does not authorize application registration in EVE.

## Deliberate limits

- Actual pilot consent, real skills/queue values, and successful token exchange with a registered client are **not verified** by simulated OAuth tests.
- The client ID has not been created: developer application registration requires the owner's EVE login, which is unavailable in this session. The required callback and scopes are already implemented and tested.
- Notes and goals are local to each browser. They are not a shared journal, and the dashboard does not publicly publish private training data.
- Wallet, assets, industry, fitting tools, screenshot uploads, and killboards are not implemented.
- Reports will mark failures rather than treating a successful upload or a unit-test count as proof that all features work.

## Run and inspect

```sh
npm ci
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:live
npx playwright show-report
```

`test:e2e` executes controlled scenarios on desktop and mobile Chromium. `test:live` runs against the published Pages URL and real public EVE services. GitHub Actions runs the controlled suite before deployment and the live suite after deployment. Reports and screenshots are retained as workflow artifacts for seven days.
