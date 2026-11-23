package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The warning points, the words and channels of each alert, and the alarm scheduling over a fake clock and a fake AlarmManager. */
class TimerAlarmsTest {
    private val t0 = 1_795_000_000_000L

    private fun sleeper(id: String = "s", start: Long = t0, length: Long = GasSleepers.DEFAULT_MS, owner: Pilot = Pilot.Fiofka) =
        newTimer(id, TimerKind.Sleeper, length, owner, start)

    // ---- the sleeper default and warnings ----

    @Test fun theSleeperDefaultIsFifteenMinutesWithAWarningTwoMinutesBefore() {
        assertEquals(15 * MIN, TimerKind.Sleeper.defaultMs)
        assertEquals(listOf(15 * MIN, 17 * MIN, 20 * MIN), TimerKind.Sleeper.presets)
        val t = sleeper()
        assertEquals(listOf(2 * MIN), t.warnings)
        val alerts = alertsOf(t, t0)
        assertEquals(listOf(AlertKind.Warn, AlertKind.End), alerts.map { it.kind })
        assertEquals(t0 + 13 * MIN, alerts[0].at)
        assertEquals(t0 + 15 * MIN, alerts[1].at)
        assertEquals("Sleepers due: warp out", alerts[1].title)
        assertEquals(TimerChannels.WARN, alerts[0].channel)
        assertEquals(TimerChannels.WARP, alerts[1].channel)
    }

    @Test fun eachAlertKindHasItsOwnChannelAndVibrationPattern() {
        val channels = listOf(TimerChannels.WARN, TimerChannels.WARP, TimerChannels.DONE, TimerChannels.CYCLE)
        assertEquals(channels.size, channels.toSet().size)
        assertEquals(channels.size, channels.map { TimerChannels.patternOf(it).toList() }.toSet().size)
        assertTrue(TimerChannels.patternOf(TimerChannels.WARP).sum() > TimerChannels.patternOf(TimerChannels.WARN).sum())
    }

    @Test fun knownSpaceGasIsNotASleeperTimerAndHasNoSleeperWords() {
        val t = newTimer("g", TimerKind.Gas, 20 * MIN, Pilot.Fiofka, t0)
        assertFalse(TimerKind.Gas == TimerKind.Sleeper)
        val end = alertsOf(t, t0).last()
        assertEquals("Gas site is done", end.title)
        assertEquals(TimerChannels.DONE, end.channel)
        assertTrue(alertsOf(t, t0).first().text.startsWith("Gas site: 2 min left"))
    }

    @Test fun warningsAreEditablePerTimerAndLiveInTheMetaSoTheWingmateWarnsToo() {
        val t = sleeper().withWarnings(listOf(MIN, 5 * MIN, 5 * MIN, 0, 99 * MIN))
        assertEquals(listOf(5 * MIN, MIN), t.warnings)
        // They are in the meta the room carries, so a copy that went through the wire still has them.
        val onTheWire = WingTimer(t.id, t.kind, t.label, t.startedAt, t.durationMs, null, t.owner, true, JsonObject(t.meta))
        assertEquals(listOf(5 * MIN, MIN), onTheWire.warnings)
        assertEquals(JsonArray(listOf(JsonPrimitive(300_000L), JsonPrimitive(60_000L))), t.meta[TimerMeta.WARN])
        // No warnings is a choice that is kept, not the default coming back.
        assertEquals(emptyList<Long>(), sleeper().withWarnings(emptyList()).warnings)
        assertEquals(listOf(AlertKind.End), alertsOf(sleeper().withWarnings(emptyList()), t0).map { it.kind })
    }

    @Test fun aPausedTimerRaisesNothingAndAPastWarningIsDropped() {
        assertTrue(alertsOf(sleeper().paused(t0 + MIN), t0 + MIN).isEmpty())
        val alerts = alertsOf(sleeper(), t0 + 14 * MIN)
        assertEquals(listOf(AlertKind.End), alerts.map { it.kind })
        assertEquals(2, allAlerts(sleeper()).size)
        assertEquals(listOf(AlertKind.Warn), dueAlerts(sleeper(), t0 + 14 * MIN, 5 * MIN).map { it.kind })
        assertTrue(dueAlerts(sleeper(), t0 + 30 * MIN, 5 * MIN).isEmpty())
    }

    @Test fun aRestartIsANewAlertKey() {
        val t = sleeper()
        assertTrue(alertsOf(t, t0).map { it.key }.intersect(alertsOf(t.restarted(t0 + MIN), t0).map { it.key }.toSet()).isEmpty())
    }

    @Test fun aRepeatingMiningCycleTicksInsteadOfRinging() {
        val t = newTimer("m", TimerKind.Mining, 98 * SEC, Pilot.Fiofka, t0).withRepeat(true)
        val end = alertsOf(t, t0).single()
        assertEquals(TimerChannels.CYCLE, end.channel)
        assertEquals("Mining cycle: cycle done", end.title)
    }

    @Test fun theProgressBarIsCutAtTheWarningPoints() {
        val plan = ProgressPlan.of(sleeper(), t0 + 5 * MIN)
        assertEquals(900, plan.total)
        assertEquals(300, plan.progress)
        assertEquals(listOf(780, 120), plan.segments)
        assertEquals(listOf(780), plan.points)
        assertEquals(listOf(900), ProgressPlan.of(sleeper().withWarnings(emptyList()), t0).segments)
    }

    @Test fun jSpaceIsSystemIds31MillionTo32Million() {
        assertTrue(GasSleepers.isJSpace(31_000_001)); assertTrue(GasSleepers.isJSpace(31_999_999))
        assertFalse(GasSleepers.isJSpace(30_002_510)); assertFalse(GasSleepers.isJSpace(32_000_000)); assertFalse(GasSleepers.isJSpace(null))
    }

    // ---- the scheduler ----

    private class FakeAlarms(var exact: Boolean = true) : AlarmFacade {
        val set = linkedMapOf<String, Pair<String, Long>>()
        override fun canScheduleExact() = exact
        override fun setExact(alert: TimerAlert) { set[alert.key] = "exact" to alert.at }
        override fun setAlarmClock(alert: TimerAlert) { set[alert.key] = "clock" to alert.at }
        override fun setInexact(alert: TimerAlert) { set[alert.key] = "inexact" to alert.at }
        override fun cancel(key: String) { set.remove(key) }
    }
    private class MemoryLog : ScheduleLog {
        var all = emptyMap<String, Scheduled>()
        override fun read() = all
        override fun write(all: Map<String, Scheduled>) { this.all = all }
    }

    private val fiofka = Pilot.Fiofka.id
    private fun scheduler(alarms: FakeAlarms, log: MemoryLog, now: () -> Long) = AlarmScheduler(alarms, log, now)

    @Test fun theWarningIsExactAndTheEndOfYourOwnTimerIsAnAlarmClock() {
        val alarms = FakeAlarms(); val log = MemoryLog()
        val n = scheduler(alarms, log) { t0 }.sync(listOf(sleeper()), mine = { it.owner == fiofka })
        assertEquals(2, n)
        assertEquals(listOf("exact" to (t0 + 13 * MIN), "clock" to (t0 + 15 * MIN)), alarms.set.values.toList())
        assertEquals(2, log.all.size)
    }

    @Test fun theWingmatesEndIsExactNotAnAlarmClock() {
        val alarms = FakeAlarms()
        scheduler(alarms, MemoryLog()) { t0 }.sync(listOf(sleeper(owner = Pilot.Decxus)), mine = { it.owner == fiofka })
        assertEquals(listOf("exact", "exact"), alarms.set.values.map { it.first })
    }

    @Test fun withoutTheExactAlarmPermissionItFallsBackToInexact() {
        val alarms = FakeAlarms(exact = false)
        scheduler(alarms, MemoryLog()) { t0 }.sync(listOf(sleeper()), mine = { true })
        assertEquals(listOf("inexact", "inexact"), alarms.set.values.map { it.first })
    }

    @Test fun syncingAgainChangesNothingAndTheClockMovesPastWarnings() {
        val alarms = FakeAlarms(); val log = MemoryLog(); var now = t0
        val s = scheduler(alarms, log) { now }
        val t = sleeper()
        s.sync(listOf(t), mine = { true })
        assertEquals(0, s.sync(listOf(t), mine = { true }))
        // The warning has gone off: it is no longer wanted, its entry leaves the log, the end stays.
        now = t0 + 14 * MIN
        assertEquals(1, s.sync(listOf(t), mine = { true }))
        assertEquals(1, alarms.set.size)
        assertEquals(1, log.all.size)
    }

    @Test fun pausingRemovingAndRestartingMoveTheAlarms() {
        val alarms = FakeAlarms(); val log = MemoryLog(); var now = t0
        val s = scheduler(alarms, log) { now }
        val t = sleeper()
        s.sync(listOf(t), mine = { true })
        now = t0 + MIN
        s.sync(listOf(t.paused(now)), mine = { true })
        assertTrue(alarms.set.isEmpty())
        s.sync(listOf(t.paused(now).resumed(t0 + 5 * MIN)), mine = { true })
        assertEquals(listOf(t0 + 17 * MIN, t0 + 19 * MIN), alarms.set.values.map { it.second }.sorted())
        val restarted = t.restarted(t0 + 6 * MIN)
        now = t0 + 6 * MIN
        s.sync(listOf(restarted), mine = { true })
        assertEquals(listOf(t0 + 19 * MIN, t0 + 21 * MIN), alarms.set.values.map { it.second }.sorted())
        s.sync(emptyList(), mine = { true })
        assertTrue(alarms.set.isEmpty())
        assertTrue(log.all.isEmpty())
    }

    @Test fun grantingThePermissionUpgradesTheInexactAlarms() {
        val alarms = FakeAlarms(exact = false); val log = MemoryLog()
        val s = scheduler(alarms, log) { t0 }
        s.sync(listOf(sleeper()), mine = { true })
        alarms.exact = true
        assertEquals(2, s.sync(listOf(sleeper()), mine = { true }))
        assertEquals(listOf("exact", "clock"), alarms.set.values.map { it.first })
    }

    @Test fun afterARebootTheLogIsClearedAndEverythingIsSetAgain() {
        val alarms = FakeAlarms(); val log = MemoryLog()
        val s = scheduler(alarms, log) { t0 }
        s.sync(listOf(sleeper()), mine = { true })
        // The reboot: the system forgot the alarms, and the boot receiver forgets the log before syncing.
        alarms.set.clear(); log.write(emptyMap())
        assertEquals(2, s.sync(listOf(sleeper()), mine = { true }))
        assertEquals(2, alarms.set.size)
    }

    @Test fun cancelAllClearsWhatItSet() {
        val alarms = FakeAlarms(); val log = MemoryLog()
        val s = scheduler(alarms, log) { t0 }
        s.sync(listOf(sleeper(), sleeper("b")), mine = { true })
        s.cancelAll()
        assertTrue(alarms.set.isEmpty()); assertTrue(log.all.isEmpty())
    }

    @Test fun finishedTimersSetNothing() {
        val alarms = FakeAlarms()
        scheduler(alarms, MemoryLog()) { t0 + 16 * MIN }.sync(listOf(sleeper()), mine = { true })
        assertTrue(alarms.set.isEmpty())
    }
}
