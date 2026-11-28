# Industrial Intelligence: source validation (0B)

Status: partial real capture received; full schema and taxonomy review is pending. Eight files have verified hashes.
The four SDE schemas were blocked by the initial redirect rule; recapture with the corrected tool is required.
The internal catalog contract is not native CCP JSON. A source adapter is a later step.

## Official sources and capture contract

- [HTTP SDE](https://developers.eveonline.com/docs/services/static-data/): resolve
  `https://sde.evetech.net/tranquility/latest/` once, then use the exact release for schemas and record probes.
  Build numbers do not identify releases; only the current and previous releases are retained.
- [SDE announcement](https://developers.eveonline.com/blog/the-sde-over-http-static-data-dynamically).
- [ESI compatibility](https://developers.eveonline.com/docs/services/esi/overview/): the diagnostic tool uses
  `2026-11-19` in the header and query parameter, without changing existing consumers' compatibility dates.
  The [OpenAPI migration announcement](https://developers.eveonline.com/blog/changing-specs-from-swagger-to-openapi)
  links to `https://esi.evetech.net/meta/openapi.json`. The capture adds `?compatibility_date=2026-11-19`.
  Do not substitute [removed Swagger specs](https://developers.eveonline.com/blog/goodbye-swagger-removing-the-last-remnants).

`scripts/capture-industrial-contracts.mjs` makes public GET requests without SSO, pilot data or pipeline writes.
It does not normalize records, publish a snapshot or homologate schemas.

```sh
node scripts/capture-industrial-contracts.mjs --output ../industrial-captures
```

The output root is required. Each run creates a unique subdirectory without overwriting earlier evidence.
`--release YYYYMMDDTHHMMSSZ` pins a known retained release; repeated `--record TABLE:ID` adds up to 24 probes and
their table schemas. If a release disappears, start another capture instead of mixing generations.

Initial schemas are types/groups/categories/blueprints. Initial record probes are types:587, types:691,
blueprints:691, groups:25, categories:6 and categories:9. These are investigation examples, not a ship allowlist or
complete classification coverage. Add missing recipe references and representative classes after inspecting the source.

## Resource identity and provenance

The manifest selects the release and each table version. SDE resources record their table/version/release alongside
the requested/final URL, redirects, UTC retrieval time, byte count, SHA-256 and selected public cache/content headers.
The original manifest preserves the native metadata. A missing table version leaves the capture incomplete.

Only same-origin redirects are followed. A schema can additionally resolve to exactly
`https://sde.evetech.net/blobs/<that table's manifest version>.schema.json`; another hash, query, origin or release
is rejected. Record requests do not receive this exception. The table version is not claimed to be the hash of schema
bytes: the saved schema has its own independently calculated digest.

Hashes cover the exact saved bytes after Fetch decompression, not the gzip/brotli transport. Invalid JSON within
the size limit is retained for inspection. Cookies and authentication headers are not recorded. Limits are 30 seconds
per request, six redirect iterations, 8 MiB decoded per response and 32 MiB saved response bytes per run; no automatic
429 retry. Network/HTTP/validation failures produce an incomplete report and exit code 1; local write errors abort.

Even `status: captured` keeps `homologation: pending-review`. Select minimal official fixtures after review;
do not commit bulk captures or treat successful downloads as schema compatibility.

## First real capture: immutable evidence

Captured by the collaborator at `2026-11-28T00:37:06.039Z`, release `20261127T110709Z`, build `3754864`.
All eight file hashes were recalculated and matched. The manifest, six SDE records and OpenAPI were received.

The collaborator supplied an HTTP 302 Location for types.schema.json:
`/blobs/3dc7b00c365b3ad41774beffb27a741036745e8eae3f8b4ae0aff70f57fbc8d4.schema.json`.
It matches the types table version. The initial exact-URL rule was too restrictive; the corrected tool binds this
schema alias to the selected manifest version. Raw captured files are preserved in the capture directory.

| Table | Manifest version |
|---|---|
| `types` | `3dc7b00c365b3ad41774beffb27a741036745e8eae3f8b4ae0aff70f57fbc8d4` |
| `groups` | `82e6a9786ac87d5390cb585850ae343530d53455ae82f602a35f6f633a6dbe35` |
| `categories` | `d18645f30d42450d55a25d8e8cd1c9f57e16fd491c97b00f2233d5daec10fa43` |
| `blueprints` | `cb15f95c63521cd3226716044514417a72dadf9fbca266f6eee328840a4ca3af` |

| Saved file | SHA-256 |
|---|---|
| `sde-manifest.json` | `fa18b25dd11cc2fc45fe009b0879429ffa8f8ce76b52b98aa9b56a39d2a1b996` |
| `types-587.json` | `c4ea36237e2dc2526b2c55d20339b451657e164b76fab7d79b1a38b379678e5f` |
| `types-691.json` | `f01ba41121df884e633b5ae2e1c61cd4e63e98e857c6df884dc978d5879bfa5a` |
| `blueprints-691.json` | `e17eb40df79f9365aa8600acc1804f7a5f108040661cf1785317088398f77f76` |
| `groups-25.json` | `684f0e7ec216f63565f55e4e010172e0d93e1ead17581ca45628a73281c56b17` |
| `categories-6.json` | `429c79e137e287ee8b1d241047ef15959387ee3f5f3bee20d4589ec8ac3710bb` |
| `categories-9.json` | `76048c72285886d65dbbd3cbe1e11cc3b39a9403b7be0813923e49e9f7af5fff` |
| `esi-openapi.json` | `2fb6fe45c1e8f1830f97d86f266472bb1f237b58aa70d749b4ba8112ff5a1e04` |

## Preliminary mapping, pending schema review

- `tables` is keyed by table name, with `version`, `record.schemaUrl`, `record.urlTemplate` and
  `jsonl.recordSchemaUrl`. Selected links in this manifest use the exact release.
- Native IDs are `typeID`, `groupID`, `categoryID` and `blueprintTypeID`; names are language objects.
  Explicit normalization is necessary; do not assume Portuguese translations exist.
- Rifter/type 587 has techLevel 1, metaGroupID 1, metaLevel 0 and factionID 500002. A factionID's presence alone must
  not classify a standard T1 hull as a faction variant. Official taxonomy still needs validation.
- Blueprint 691 uses `activities.manufacturing`, with materials/products/skills/time and item `typeID` fields.
  It produces one type 587, needs types 34/35/36/37 and skill 3380, and has time 6000. Capture referenced records
  and confirm schema semantics/units before using it in calculations.
- The received OpenAPI is 3.1.0, with info.version and response compatibility header equal to 2026-11-19.
  It describes industry systems/facilities, market prices, regional orders and regional history; operational
  responses from those routes have not been captured by this tool.
- Adjusted/average prices and facility tax are optional in that specification. Missing values remain unknown,
  never zero. Regional orders have page/X-Pages, remaining/minimum volume and range constraints.

## Completing 0B

1. Obtain complete real files, confirm one release, all table versions, resource identities and hashes.
2. Inspect schema keys/required/optional fields and explicitly map publication, names, classifications, recipes,
   quantities, skills and time. An absent activity is not a complete empty recipe.
3. Establish official metadata for T1/T2/T3, faction/special and capital/subcapital, including dogma when needed.
   Add representative real positive and negative records, without classifying by translated names or prices.
4. Confirm ESI units, pagination, freshness, limits and dependencies for the later pricing/index/facility/book/history stages.
5. Select minimal real fixtures with provenance, then test missing/changed fields and mapping against the schema.
   Only then finish 0B and begin the source adapter, incremental cache and atomic publication.

Current capture tests use synthetic HTTP fixtures. Catalog tests use synthetic internal records. Runtime results and
environment-specific diagnostics belong in the PR description, not in this source contract.
