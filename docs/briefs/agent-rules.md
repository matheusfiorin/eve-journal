# Common rules for every agent working on eve-journal ("Echelon")

Project: an EVE Online console for two pilots (Fiofka, Decxus). The frontend is static ES modules on GitHub Pages
(app.js plus ui/, with pure planners at the repo root). The backend is a Cloudflare Worker (worker/index.js) with D1
(worker/migrations/). An hourly GitHub Actions market pipeline lives in scripts/market-pipeline.mjs. Read README.md,
RESUME.md and worker/README.md first.

## Setup
- Run `git log --oneline -1` and `git status` first. Verify the task base before editing. Use an isolated feature
  checkout/worktree for a different base; preserve existing work rather than resetting another checkout.
- Run `npm ci` if node_modules is missing.

## Conventions
- Dense code style, like the surrounding files. Comments explain why, not what. UI copy is plain, sentence case,
  and has no developer jargon.
- New browser modules go under ui/. Before a root module enters the browser import graph, add it to the copy line
  in .github/workflows/pages.yml. Unintegrated modules and Node-only tools need not be published. The package tests
  check the browser import graph, the CSP and duplicate ids.
- New D1 migrations: inspect worker/migrations/ for the current highest number, use the next free number and add it
  to the migration list at the top of tests/worker.test.js.
- Never weaken, skip or loosen a test to make it pass. Fix the cause. Add tests for new behaviour: unit tests in
  tests/, browser tests in e2e/. The mocked backend is in e2e/fixtures.js.
- Keep both pilots' private data private. Nothing about where the pilots are may reach a public surface (public
  endpoints, logs).

## Testing
- `npm run check`, then `npm test`.
- Browser tests must use your own port, because other sessions share 8000 and Playwright silently reuses whatever
  server it finds there:
  `E2E_PORT=<your port> CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --grep-invert LIVE: --trace off --reporter=line --workers 2`
- Run the full browser suite before you finish. A test that fails only under load: rerun it with `--last-failed`
  and report what happened.

## Finishing
- Keep one feature branch and PR per functionality; several focused commits may belong to that PR.
- Commit locally by default. Push a feature branch and open/update its PR only when the task explicitly authorizes
  it (including a request to deliver a PR). Never push directly to main or merge without separate authorization.
- Keep incomplete deliveries or outstanding verification in draft PRs and state what is pending. Use the PR template
  for problem/result, decisions, validation, compatibility/privacy, limits and next steps.
- Record actual authorship. Add co-author/session trailers only when they belong to the current work; do not copy
  a fixed identity or unrelated session URL.
- Keep feature status in its feature brief. Durable setup docs describe reusable steps; PR descriptions hold session
  logs, test counts, machine-specific workarounds and validation evidence.
- Report:
  - what you did for each item, and anything left undone with the reason
  - files changed
  - exact test results
  - your branch name and final commit hash
