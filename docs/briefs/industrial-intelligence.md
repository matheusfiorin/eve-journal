# Industrial Intelligence: approved scope and normalized catalog

This brief defines the industrial analyser. The existing Build screen remains the starter planner; the new catalogue
is not integrated into it and does not yet price production lots.

## Approved decisions

- Web and Android share one JavaScript engine through the existing QuickJS bridge. Keep the current framework,
  database and hosting.
- Buying, manufacturing and selling use independently configurable facilities. Validate an NPC station first;
  Kisogo/Jita are possibilities, not constants. The exact facility belongs to the first real scenario.
- Discover manufacturable T1 ships through official metadata and recipes, without a fixed ship list or BPO-price cap.
  Enable calculations only for verified classes. Capitals, faction and special variants have explicit classification;
  capitals are not automatically enabled. T2/T3, invention and recursive production are outside the MVP.
- Owned materials have opportunity cost: net sale proceeds subject to depth and fees. Separate economic cost, cash
  outlay and tied-up capital. Raw ore does not replace refined minerals in a recipe.
- Enter logistics per lot with origin/destination and explicit unknowns. Zero requires an entered value. Facility
  bonuses and taxes belong to the facility profile; transport risk remains a separate indicator.
- Explain rankings through economic profit, margin, capital, profit per slot-hour and regional liquidity. No hidden
  weights or assumed fixed market share. Losing or incomplete operations are not positive opportunities.
- Drafts are private. Sharing a revision with the wing is voluntary and has a preview. Preserve its assumptions and
  quotes; recalculation creates a new revision. Do not automatically attach current wallet, inventory or location.

## Phases and status

| Phase | Delivery | Status |
|---|---|---|
| 0A | Internal normalized catalog contract and synthetic tests | Implemented; review corrections preserve invalid references and deterministic ordering |
| 0B | Real HTTP SDE schemas/records and ESI specification review | Partial: eight real files and hashes checked; schema recapture and complete taxonomy review pending |
| 1 | SDE adapter, incremental collection, atomic publication and cache | Planned; requires 0B |
| 2 | One-lot simulator: jobs, ME/TE, economic costs and capital | Planned |
| 3 | Market depth, immediate sale/orders and regional history | Planned |
| 4 | Explainable ranking and conservative/base/optimistic assumptions | Planned |
| 5 | Web/Android Build screens and versioned shared plans | Planned |

Source capture instructions, immutable provenance and preliminary native-field mapping are in
[industrial-source-validation.md](industrial-source-validation.md). Capturing files does not homologate their schemas.
Runtime checks and session evidence belong in the PR description.

## Internal contract: industrial-catalog.js

`buildIndustrialCatalog(snapshot)` is pure: no HTTP, file writes, global clock or DOM. Its input is an internal
normalized contract, not native SDE HTTP/ZIP JSON. A future adapter must validate the source schema and explicitly
map fields. Current unit fixtures are synthetic; they are not evidence of real API compatibility.

The module is not imported by Build, bundled for Android or copied into the Pages artifact yet. Add deployment
packaging when a browser consumer actually imports it. No endpoint, dependency or migration is added.

### Input

- `source`: `provider: 'ccp-sde'`, `tenant: 'tranquility'`, unique `release: YYYYMMDDTHHMMSSZ` and a real ISO
  calendar `retrievedAt` timestamp with an explicit timezone.
- `tables`: `types`, `groups`, `categories`, `blueprints`, each with `release`, normalized string `version` and
  `rows`. Reused tables must be confirmed as part of the selected release, not merely relabelled.
- IDs and quantities are positive safe JavaScript integers. Duplicate record IDs reject the ambiguous generation.
  A missing table object reports `invalid_table`; an actual release mismatch reports `mixed_release`.

| Record | Internal fields |
|---|---|
| Type | `id`, `name`, `groupId`, `published`; ships also need `techLevel` and `variant` |
| Group | `id`, `name`, `categoryId`; ship groups also need `shipClass` |
| Category | `id`, `name`, `kind` (such as `ship`, `material`, `blueprint`) |
| Blueprint | `id`, `manufacturing: null` or a normalized activity |
| Manufacturing | `products: [{typeId, quantity}]`, `materials: [{typeId, quantity}]`, `skills: [{typeId, level}]`, `timeSeconds` |

`variant` distinguishes `standard`, `faction`, `special` and unknown. `shipClass` distinguishes `subcapital`,
`capital` and unknown. Derive these semantic fields from official metadata, including dogma when needed, not
translated names, prices or a pilot's budget. A native `factionID` alone does not establish a faction variant.

### Output and quality

- `version: 1` is the internal contract version, separate from the SDE release and future formula versions.
- `source` preserves provider, tenant, release, normalized retrieval time and all four table versions.
- `entries` are ordered by product/blueprint and retain base quantities, time, skills and classification.
- `recipe-ready` means structurally complete, not profitable, available in a market, verified in game, permitted
  by the pilot's skills/facility or backed by an owned BPO/BPC.
- `incomplete` retains missing/invalid metadata with explicit `issues`. Invalid material IDs stay as
  `{typeId:null, name:null, quantity:...}`; invalid skill IDs/levels stay null in their original slot. Known values
  are retained. Sorting places nulls last and breaks duplicate-ID ties by quantity or skill level.
- `unsupported` means complete but not enabled (capitals). Top-level `issues` diagnose missing classification and
  multi-product recipes; never silently select the first product.
- `excluded` counts non-manufacturable, non-ship, unpublished, non-T1 and nonstandard records. `counts` reports each
  entry state. Missing values do not become zero or financial results.

Intermediate components remain market inputs rather than recursive jobs. Multiple recipes remain distinct by
blueprint. ME/TE and runs of a particular BPC do not belong to this catalogue.

## Source constraints and later acceptance criteria

[SDE HTTP](https://developers.eveonline.com/docs/services/static-data/),
[HTTP SDE announcement](https://developers.eveonline.com/blog/the-sde-over-http-static-data-dynamically),
[ESI compatibility dates](https://developers.eveonline.com/docs/services/esi/overview/).

Resolve latest once, preserve table versions/ETags and publish only a consistent generation. Build numbers are not
unique release IDs. Only the current and previous SDE releases are retained; preserve reproducible subsets and hashes.
HTTP keys are named fields, not ZIP `_key`. Do not globally advance ESI compatibility dates before migrating consumers.

To finish 0B, inspect official manifests, schemas and representative records; record source/release/versions/hashes;
test missing/changed fields and the explicit mapping. Public probes need no personal credentials. Keep CCP notices.

- Unknown adjusted price, cost index, material or book yields incomplete output, never assumed zero cost.
- Round quantities per job; model each BPC instance. Separate slot time, elapsed production and sale delay.
- EIV uses base materials and adjusted prices. Tax parameters require sources/dates; resolve the Alpha discrepancy
  in the game client before approving that profile. Research and manufacturing do not inherit the same tax by assumption.
- Orders require depth and eligibility. History is regional and an advertised price is not realised revenue.
- Define margin/ROI denominators; separate BPO investment from operating expense.
- Reconcile a real lot in EVE before publishing a ranking; do not tune constants to conceal discrepancies.
- Preserve consent rules. The basic engine works with public data and manual parameters.
- Catalog changes require its unit tests and the Node suite. Browser/Android integration adds the corresponding
  import/package checks, parity tests and UI/Android verification.
