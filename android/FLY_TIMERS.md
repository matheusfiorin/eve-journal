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
