# EVE Flight Journal

A buildless, responsive GitHub Pages application for two EVE Online pilots. Public ESI character profiles, read-only authenticated skills and training queues, local goals, and a private local journal. No dependencies or backend are required for the static application.

## Current status

The application and GitHub Pages workflow are implemented. EVE SSO requires developer registration and live verification with your characters; the OAuth flow has not been tested against a registered EVE application. Source is maintained in https://github.com/matheusfiorin/eve-journal. GitHub Pages deployment and EVE SSO must be verified separately.

## Run locally

Use Node.js 24 and Python 3:

```sh
npm run check
npm test
npm start
```

Open http://localhost:8000/. Serve over HTTP locally or HTTPS in production; do not open index.html as a file.

## Publish beside rs3-leaderboard

The repository is `matheusfiorin/eve-journal`. To publish from a fresh local copy with an authenticated GitHub CLI, use:

```sh
git init -b main
git add .
git commit -m "Create EVE Flight Journal"
git remote add origin https://github.com/matheusfiorin/eve-journal.git
git push -u origin main
```

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**, then run the Deploy GitHub Pages workflow (or push another commit). The expected URL is `https://matheusfiorin.github.io/eve-journal/`; verify the actual deployment URL in Actions. The workflow publishes only the application files, excluding tests and documentation.

Set up to two exact character names in `config.json` to make them the defaults for all visitors. The Configure pilots dialog overrides these settings only in the current browser. `eveClientId` is a public application identifier, never a secret.

## Connect EVE Online

1. Register an EVE developer application at https://developers.eveonline.com/ using a public/native client supporting Authorization Code with PKCE. Request only `esi-skills.read_skills.v1` and `esi-skills.read_skillqueue.v1`.
2. Register the exact callback URL shown in Configure pilots, including the trailing slash. For the proposed repository it is `https://matheusfiorin.github.io/eve-journal/`. Use a separately registered localhost callback for development if supported by your application settings.
3. Put the public client ID in `config.json`, or enter it in Configure pilots. Do not add a client secret anywhere in the frontend or repository.
4. Configure both character names. Select Connect with EVE Online for a pilot and authorize that same character. Repeat for the second pilot in this browser if you want a side-by-side private training view. Each pilot must authorize their own character; do not share EVE passwords.

The implementation uses PKCE S256, one-time state with a ten-minute lifetime, and EVE's authenticated verification endpoint to check the character. Access tokens stay in sessionStorage on this origin; refresh tokens are discarded. Reconnect after expiry. Disconnect removes the browser token and cached training view; revoke the application's access in EVE account management to revoke the server-side grant. Never paste access tokens into a URL or config file.

**Live integration limit:** EVE application type and token-endpoint browser CORS behavior must be verified with your registered application. If that configuration requires a confidential client or does not permit browser token exchange, add a small OAuth backend before enabling training access. Never work around it by exposing a client secret. Public character lookup and the local journal do not need EVE login.

## Privacy and sharing

- Public visitors see default pilot identities, portraits, and corporation names from public ESI endpoints. Their own browser can configure different pilot names.
- Skills and training queues appear only in the browser session that authorized each pilot. They are fetched on load and manual refresh; this application performs no unattended synchronization or public snapshot publishing.
- Goals and journal entries are browser-local, under localStorage key `eve-flight-journal:v1`. They are not synchronized with your friend. All scripts running on this origin can access local data, so only deploy trusted code.
- Export a JSON backup regularly. Restore merges records by stable ID; matching IDs are replaced after confirmation. Backups contain your private notes. Store and share them intentionally. Clearing browser data or switching devices will not preserve the journal automatically.
- There is no wallet, assets, industry, killboard, or screenshot-upload integration in this version.
- Portraits load from CCP's image service. Optional fonts load from Google Fonts with local fallback fonts. EVE API availability and cache behavior determine data freshness.

## Manual acceptance checks

1. Add both exact names; verify character portraits and corporations, and check a nonexistent name produces a clear error.
2. Add and complete a goal. Write an entry, reload, export, and import in another browser; confirm the records persist and merge without duplicates.
3. Verify HTML-like text in entries displays literally.
4. Register the EVE app; connect each pilot, compare total skill points and queue entries with the game, then disconnect. Test cancellation, a mismatched character, expired login state, and token expiry.
5. Open the Pages site on mobile and in a private browser window. Confirm private notes and training data do not appear there.

EVE Online and related imagery are property of CCP Games. This is an independent fan project, not affiliated with or endorsed by CCP Games.
