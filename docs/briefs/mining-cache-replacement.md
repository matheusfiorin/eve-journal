# Persisting additions to the mining dogma cache

`DogmaCache` stores fetched type dogma and unit volumes so another process can reuse them without an ESI request.
Its previous temporary-file save used `File.renameTo` and ignored failure, so Windows could keep only the first snapshot.

Use the shared `core/cache/Caches.kt` `atomicWrite` helper after creating the parent directory. This replaces an
existing snapshot with the accumulated type map. Cache keys, expiry, encoding, missing-type retries and ESI calls
are unchanged. This change depends on the shared helper replacement fix in the timer persistence PR.

`MiningLoaderTest.newlyFetchedTypesReplaceAnExistingDiskSnapshotAndSurviveRestart` fetches one type, adds a second,
then reopens with no network data. Both types must be read from disk with zero requests. Fixture records include
volumes, as the decoder intentionally rejects older records without them. The test catches the Windows replacement
regression; a Linux run alone does not demonstrate Windows behaviour.
