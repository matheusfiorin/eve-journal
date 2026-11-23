# Fly timers: sleepers, mining numbers, exact alarms

Where the pieces live: `app/src/main/java/com/echelon/eve/fly/timers` (timers, alerts, alarms, mining) and `fly/cockpit` (suggestions, tiles).

## Gas sleeper timer (wormhole gas)

Default **15 min**, warning at **T-2 min** and at the end ("Sleepers due: warp out"). Source notes are in the KDoc of `GasSleepers`:
EVE University wiki "Gas cloud harvesting" (modified 8 Nov 2026): Sleepers spawn "usually about 15-20 minutes" after the site is first
warped to; EVE forums (2018, 2021): the clock starts when the *first* pilot warps in (a wingmate's arrival counts), the Instrumental
site has a second wave about 5 minutes later. CCP gives no figure and no source lists a per-site difference, so one default (the early
end of the range) with 17 and 20 min presets. Known-space gas has no Sleepers: the `Gas` kind is the pilot's own idle/despawn timer.

Warnings live in the timer's `meta.warnMs` (ms before the end), so the wingmate's phone warns too; `meta.site` is `wh` or `ks`.
Each alert kind has its own channel and vibration pattern: `timers_warn` (two short), `timers_warp` (three long and a short, alarm
sound), `timers_done` (one firm), `timers_cycle` (one tick, a repeating mining cycle).

## Mining cycle and hold-full (`MiningCalc`, `MiningLoader`)

Numbers come from ESI dogma (`/universe/types/{id}`, cached 30 days in `dogma-types.json`); the attribute ids and the per-level hull
bonuses were checked against ESI's `/dogma/attributes` and `/dogma/effects` (see the header of `MiningCalc.kt`). Verified by hand for the
user's Venture (2x Gas Cloud Scoop I, Gas Cloud Harvesting IV, Mining IV, Mining Frigate III): cycle 30 s x 0.85 = 25.5 s, yield
10 x 2 = 20 m3 per scoop, 5000 m3 mining hold = 125 cycles = 53 min. (Mining IV is only the prerequisite of the gas skill; scoops
do not require Mining, so it adds nothing.)

Simplifications: crystals, boosters, implants, rigs and overheating are not applied; waste and critical hits are ignored; cargo
expanders do not widen the hold; the ship mines the whole time (no travel, targeting or unloading); the hold is full after the cycle
that carries it past capacity; one Gas Cloud Harvester/scoop may run per Gas Cloud Harvesting level; drones and mining foremen are
not counted. A mixed fit is timed on the kind that brings in the most per minute.

## Live gas estimate and operations (`GasOps`, `GasOperations`)

The core loop of a wormhole gas huff: warp to a site, start the Sleeper timer, watch the Fullerite and its ISK value climb, leave when it
runs out, go to the next site. One timer is one **operation**; a wing-room **session** is the shared goal reached over N operations
("huff 3 sites to reach 500M"). The pieces:

- `fly/timers/GasOps.kt` (pure, `GasOpsTest`): the flying pilot's `GasRate` from `MiningCalc` (the gas groups of the profile: each
  group's module count, cycle and m3 per cycle, summed over modules), `GasOps.estimate` (completed cycles since the timer started, no
  partial cycle; frozen at the timer's end, a pause, or a full hold; units = floor(m3 / unit volume); value = units x price), the price
  choice, the operation sent to the room, the reporting policy and the ledger reconciliation.
- Gas types are the nine Fullerites (`Fullerite`). Type ids and unit volumes were read from ESI `/universe/types/{id}` on 23 Nov 2026
  (group 711, volume = packaged volume): C28 30375 (2 m3), C32 30376 (5), C50 30370 (1), C60 30371 (1), C70 30372 (1), C72 30373 (2),
  C84 30374 (2), C320 30377 (5), C540 30378 (10). The enum's volume is only a fallback: the live number is ESI's `volume`, kept by the
  existing types cache (`DogmaCache`, now storing `volume`; entries saved before that are read again once).
- Price: Jita best buy (the highest buy order at Jita IV - Moon 4, station 60003760, in the market snapshot's The Forge region) when the
  item is in the app's market data, else ESI `/markets/prices` `average_price` (the corp assets' helper, `CorpRepository.prices`). The
  card says which one it used ("Jita best buy" or "ESI average"). The Fullerites are in `market/watchlist.json`, so the pipeline scans them
  and Jita is normally available.
- The pilot picks the site's gas when starting the timer (`GasChips`, stored in the timer's `meta.gas` so the wingmate's phone knows it);
  the default is the last one used (`GasChoice`). It can be changed on the running timer (the gas name on the hero is a menu); the
  estimate then recounts from the timer's start. Mixed sites (two gases) are not modelled: pick the main one.
- `fly/timers/GasOperations.kt`: `OpSync` (pure of Android, `GasOpSyncTest`) turns the flying pilot's own gas timers into session
  operations while a session runs (op id = timer id; only timers started after the session began): created at once, updated at most every
  30 s and only when the units moved (a cycle batch completed), finished (`endedAt`) when the timer ends or is removed. The
  `GasOperations` wrapper keeps the estimate's inputs fresh (rate from the fit and skills, volumes, prices) and ticks every 5 s.
  Without a session nothing is sent, and the hero still counts locally.
- Reconciliation: `SessionReporter` still reports the mining-ledger units. `GasOps.confirmedUnits` reads the ledger rows (ESI mining
  ledger: a total per type and day) for the days an operation covered and the UI shows "EVE confirms N units". The ledger only confirms:
  the operation's value is the estimate, never the ledger (no double counting). Two operations of one gas on one day share the day's number.
- Room protocol (revision 2, additive; `worker/wingroom.js`, `WingCompatTest`, `tests/wingcompat.test.js`): `session.op` upserts an
  operation by id (owner = sender, 60 per session, numbers validated, no push); `session.add` appends ISK added by hand (50 per session, may be
  negative, abs <= 1e13, note <= 80 chars; a positive amount sends the wingmate a short push, no locations). The room keeps `session.ops` and
  `session.adds`, recomputes each pilot's `contrib.mined` and `contrib.added`, and `totals` gain `mined`, `added` and `value = mined + added`
  (`isk` stays the wallet change). An old app ignores the new fields; an old room answers `unknown_type`.
- UI: `GasHero` (Cockpit and Timers): "+410 units" and "~14.8M" in rolling digits, the hold gauge with a particle stream into the fill
  and a flash on each batch, hold %, and the time to a full hold or to the Sleepers, whichever comes first. `SessionCard` (Wing screen):
  value against the goal in a bar striped by pilot colour with a burst when reached, the split gas / added / wallet, the numbered sites
  (the live one breathing) and the adds; `SessionMini` in the Cockpit and the Fly hub; the Add ISK sheet (`AddIskForm`, amounts in the
  `parseIsk` format, a minus corrects, chips +10M/+50M/+100M). Everything animated is drawn in the draw phase from `rememberAmbientClock`.

## Exact alarms (`TimerAlarms.kt`)

`AlarmScheduler` keeps AlarmManager in step with the timers (on every change, on boot, on the exact-alarm permission change): the
flying pilot's own end is `setAlarmClock`, every other alert `setExactAndAllowWhileIdle`, and without `canScheduleExactAlarms()`
everything falls back to `setAndAllowWhileIdle`. `TimerAlarmReceiver` posts the alert with no service running (same notification tag
and only-alert-once as the service, so one buzz); `TimerBootReceiver` reschedules after boot, update and clock change. The Timers
screen shows a rationale card with a deep link to Settings > Alarms & reminders while the permission is missing.

## Wormhole entry and quick access

`/api/live` reads feed `nextSuggestion`: entering a J-space system (31000000-31999999) offers "Start sleeper timer"; undocking in
a mining hull offers the mining timer (repeating, from the fit). Never started automatically. The universe data has no wormhole
class (the gate map is known space), so the card says "J-space" with the system name. Quick Settings tiles: Mining cycle, Gas timer
(start, or show and stop). Static shortcuts: Gas timer, Mining cycle, Cockpit. On Android 16 the ongoing notification uses
`Notification.ProgressStyle` with a segment per stretch and a point at each warning (guarded by `SDK_INT >= 36`).
