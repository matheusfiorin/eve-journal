# Common rules for every agent working on eve-journal ("Echelon")

Project: an EVE Online console for two pilots (Fiofka, Decxus). The frontend is static ES modules on GitHub Pages
(app.js plus ui/, with pure planners at the repo root). The backend is a Cloudflare Worker (worker/index.js) with D1
(worker/migrations/). An hourly GitHub Actions market pipeline lives in scripts/market-pipeline.mjs. Read README.md,
RESUME.md and worker/README.md first.

## Setup
- Run `git log --oneline -1` and `git status` first. Verify the task's base before editing. Use a feature branch in an
  isolated checkout/worktree; do not reset another checkout or discard changes to match an old task's commit.
- Run `npm ci` if node_modules is missing.

## Conventions
- Dense code style, like the surrounding files. Comments explain why, not what. UI copy is plain, sentence case,
  and has no developer jargon.
- New browser modules go under ui/. A new top-level file must also be added to the copy line in
  .github/workflows/pages.yml; tests/package.test.js checks the import graph, the CSP and duplicate ids.
- New D1 migrations: inspect worker/migrations/ for the current highest number. Use the next free number, and add it to the
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
- The collaborators require one feature branch and PR to main per functionality. Several focused commits may belong
  to that PR. Pushing the feature branch to open/update its PR is authorized; do not merge or push directly to main.
- Keep incomplete deliveries or deliveries with outstanding verification in Draft PRs. Explain the exact scope and
  pending checks. Include the problem/result, key changes, decisions/docs, sources/formulas when relevant, validation,
  compatibility/privacy, risks, limitations, next step, branch and commit. Use .github/PULL_REQUEST_TEMPLATE.md.
- Record actual authorship. Never copy a fixed co-author identity or session URL from an unrelated agent/session.
- Keep decisions and phase status in the feature brief. For Industrial Intelligence, read docs/briefs/industrial-intelligence.md.
- Report:
  - what you did for each item, and anything left undone with the reason
  - files changed
  - exact test results
  - your branch name and final commit hash
