# Common rules for every agent working on eve-journal ("Echelon")

Project: an EVE Online console for two pilots (Fiofka, Decxus). The frontend is static ES modules on GitHub Pages
(app.js plus ui/, with pure planners at the repo root). The backend is a Cloudflare Worker (worker/index.js) with D1
(worker/migrations/). An hourly GitHub Actions market pipeline lives in scripts/market-pipeline.mjs. Read README.md,
RESUME.md and worker/README.md first.

## Setup
- Run `git log --oneline -1` first. If HEAD is not the commit named in your task, and `git status` is clean, run
  `git reset --hard <that commit>` and say so in your report.
- Run `npm ci` if node_modules is missing.

## Conventions
- Dense code style, like the surrounding files. Comments explain why, not what. UI copy is plain, sentence case,
  and has no developer jargon.
- New browser modules go under ui/. A new top-level file must also be added to the copy line in
  .github/workflows/pages.yml; tests/package.test.js checks the import graph, the CSP and duplicate ids.
- New D1 migrations: the last existing one is 0006_refresh_holds.sql. Use the next free number, and add it to the
  migration list at the top of tests/worker.test.js.
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
- Commit in your worktree. You may make several commits. Each message ends with exactly these two lines:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P4jJrmLcai2Di9csuDE8sr
- Do NOT push.
- Report:
  - what you did for each item, and anything left undone with the reason
  - files changed
  - exact test results
  - your branch name and final commit hash
