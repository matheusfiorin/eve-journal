package com.echelon.eve.corp

import androidx.work.Data
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import android.content.Context
import android.content.ContextWrapper
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Builders for snapshots in a given state, from the Worker's own fixture. */
object AlertFixture {
    private val base = CorpFixture.snap
    fun tower(id: Long = 1001, hours: Double? = 39.0, state: String = "online") = base.starbases.value!!.single().copy(id = id, fuelHoursLeft = hours, state = state)
    fun structure(id: Long = 1030000000001, days: Double? = 2.0, state: String = "shield_vulnerable") = base.structures.value!!.single().copy(id = id, fuelDaysLeft = days, state = state)
    fun snap(towers: List<Starbase>? = emptyList(), structures: List<Structure>? = emptyList(), corp: Long = 98000001) = base.copy(corporationId = corp,
        starbases = Section(towers, null, false, if (towers == null) "needs role Director or Station Manager" else null),
        structures = Section(structures, null, false, if (structures == null) "needs role Station Manager" else null))
}

class CorpAlertsTest {
    private val all = AlertKind.entries.toSet()

    @Test fun towerIsLowUnder24HoursWhileOnline() {
        assertTrue(AlertFixture.tower(hours = 23.9).isLowFuel())
        assertFalse(AlertFixture.tower(hours = 24.0).isLowFuel())
        assertFalse("an offline tower keeps its fuel", AlertFixture.tower(hours = 5.0, state = "offline").isLowFuel())
        assertFalse("never read is not low", AlertFixture.tower(hours = null).isLowFuel())
    }

    @Test fun structureIsLowUnder3Days() {
        assertTrue(AlertFixture.structure(days = 2.9).isLowFuel())
        assertTrue("out of fuel counts", AlertFixture.structure(days = 0.0).isLowFuel())
        assertFalse(AlertFixture.structure(days = 3.0).isLowFuel())
        assertFalse("no expiry is unknown, not low", AlertFixture.structure(days = null).isLowFuel())
    }

    @Test fun reinforcedIsAStateOfEitherKind() {
        assertTrue(AlertFixture.tower(state = "reinforced").isReinforced())
        assertTrue(AlertFixture.structure(state = "armor_reinforce").isReinforced())
        assertTrue(AlertFixture.structure(state = "hull_reinforce").isReinforced())
        assertFalse(AlertFixture.structure(state = "shield_vulnerable").isReinforced())
        assertEquals(Health.Reinforced, AlertFixture.tower(hours = 3.0, state = "reinforced").health())
    }

    @Test fun eachKindFiresOnItsOwnThreshold() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0), AlertFixture.tower(2, 100.0)), listOf(AlertFixture.structure(10, 1.0), AlertFixture.structure(11, 9.0, "armor_reinforce")))
        val run = evaluateAlerts(listOf(snap), all, emptySet())
        assertEquals(setOf("tower-fuel:98000001:1", "structure-fuel:98000001:10", "reinforced:98000001:structure:11:armor_reinforce"), run.alerts.map { it.key }.toSet())
        assertEquals(run.alerts.map { it.key }.toSet(), run.fired)
        assertEquals("Corp/starbases/1", run.alerts.first { it.kind == AlertKind.TowerFuel }.route)
        assertEquals("Corp/structures/10", run.alerts.first { it.kind == AlertKind.StructureFuel }.route)
    }

    @Test fun anItemTellsOnceWhileTheConditionHolds() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))
        val first = evaluateAlerts(listOf(snap), all, emptySet())
        assertEquals(1, first.alerts.size)
        val second = evaluateAlerts(listOf(snap.copy(updatedAt = snap.updatedAt + 3_600_000)), all, first.fired)
        assertTrue("same tower, still low: silent", second.alerts.isEmpty())
        assertEquals(first.fired, second.fired)
    }

    @Test fun aRefuelRearmsTheItem() {
        val low = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))
        val told = evaluateAlerts(listOf(low), all, emptySet())
        val refuelled = evaluateAlerts(listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 300.0)))), all, told.fired)
        assertTrue(refuelled.alerts.isEmpty()); assertTrue("the key is forgotten", refuelled.fired.isEmpty())
        val dry = evaluateAlerts(listOf(low), all, refuelled.fired)
        assertEquals("a new dry spell is a new alert", 1, dry.alerts.size)
    }

    @Test fun otherItemsAndOtherThresholdsAreIndependent() {
        val one = evaluateAlerts(listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)), listOf(AlertFixture.structure(10, 1.0)))), all, emptySet())
        // A second tower joins; the first tower and the structure stay silent.
        val two = evaluateAlerts(listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 8.0), AlertFixture.tower(2, 7.0)), listOf(AlertFixture.structure(10, .9)))), all, one.fired)
        assertEquals(listOf("tower-fuel:98000001:2"), two.alerts.map { it.key })
        // The same structure goes low then reinforced: the fuel alert was told, the reinforced one is new.
        val hit = evaluateAlerts(listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 8.0), AlertFixture.tower(2, 7.0)), listOf(AlertFixture.structure(10, .9, "armor_reinforce")))), all, two.fired)
        assertEquals(listOf("reinforced:98000001:structure:10:armor_reinforce"), hit.alerts.map { it.key })
    }

    @Test fun aNewReinforcementPhaseIsANewAlert() {
        val armor = evaluateAlerts(listOf(AlertFixture.snap(structures = listOf(AlertFixture.structure(10, 20.0, "armor_reinforce")))), all, emptySet())
        val hull = evaluateAlerts(listOf(AlertFixture.snap(structures = listOf(AlertFixture.structure(10, 20.0, "hull_reinforce")))), all, armor.fired)
        assertEquals(1, hull.alerts.size); assertTrue(hull.alerts.single().body.contains("hull"))
    }

    @Test fun aSwitchedOffTypeIsSilentAndKeepsItsMemory() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)), listOf(AlertFixture.structure(10, 1.0)))
        val told = evaluateAlerts(listOf(snap), all, emptySet())
        val off = evaluateAlerts(listOf(snap), all - AlertKind.TowerFuel, setOf("tower-fuel:98000001:1"))
        assertTrue(off.alerts.none { it.kind == AlertKind.TowerFuel })
        assertTrue("memory of a switched-off type is kept, so switching it on is not a second alert", "tower-fuel:98000001:1" in off.fired)
        // Never told while off: switching on tells once.
        val on = evaluateAlerts(listOf(snap), setOf(AlertKind.TowerFuel), emptySet())
        assertEquals(1, on.alerts.size)
        assertEquals(2, told.alerts.size)
    }

    @Test fun anUnreadSectionNeitherFiresNorRearms() {
        val told = evaluateAlerts(listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))), all, emptySet())
        val blind = evaluateAlerts(listOf(AlertFixture.snap(towers = null)), all, told.fired)
        assertTrue(blind.alerts.isEmpty())
        assertEquals("a role that went missing must not re-arm the tower", told.fired, blind.fired)
    }

    @Test fun twoPilotsInOneCorporationShareOneSnapshot() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))
        assertEquals(1, evaluateAlerts(listOf(snap, snap), all, emptySet()).alerts.size)
        // Different corporations keep separate memory.
        val other = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)), corp = 98000002)
        val both = evaluateAlerts(listOf(snap, other), all, emptySet())
        assertEquals(2, both.alerts.size)
        val clearedOne = evaluateAlerts(listOf(snap, AlertFixture.snap(listOf(AlertFixture.tower(1, 500.0)), corp = 98000002)), all, both.fired)
        assertEquals(setOf("tower-fuel:98000001:1"), clearedOne.fired)
    }

    @Test fun messagesUseNamesWhenKnown() {
        val names = AlertNames(type = { if (it == 12235L) "Caldari Control Tower Medium" else null }, system = { if (it == 30000142L) "Jita" else null })
        val a = conditions(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0))), names).getValue(AlertKind.TowerFuel)!!.single()
        assertEquals("Caldari Control Tower Medium in Jita: about 9 h of fuel left.", a.body)
        val bare = conditions(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))).getValue(AlertKind.TowerFuel)!!.single()
        assertEquals("A tower: about 9 h of fuel left.", bare.body)
    }

    // ── The worker ──

    private class Env(
        override val prefs: CorpAlertPrefs = InMemoryCorpAlertPrefs(), var read: List<CorpSnapshot>? = emptyList(), var allowed: Boolean = true,
    ) : CorpAlertEnv {
        val posted = mutableListOf<CorpAlert>(); var fetches = 0
        override suspend fun snapshots(): List<CorpSnapshot>? { fetches++; return read }
        override suspend fun names(snapshots: List<CorpSnapshot>) = AlertNames()
        override fun canNotify() = allowed
        override fun notify(alert: CorpAlert) { posted += alert }
    }

    private fun worker(env: CorpAlertEnv, attempt: Int = 0): CorpAlertWorker {
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker = CorpAlertWorker(appContext, workerParameters, env)
        }
        return TestListenableWorkerBuilder<CorpAlertWorker>(ContextWrapper(null)).setWorkerFactory(factory).setRunAttemptCount(attempt).build()
    }

    @Test fun theWorkerNotifiesOnceAcrossRuns() = runBlocking {
        val env = Env(read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)), listOf(AlertFixture.structure(10, 1.0)))))
        assertEquals(ListenableWorker.Result.success(), worker(env).doWork())
        assertEquals(2, env.posted.size)
        assertEquals(ListenableWorker.Result.success(), worker(env).doWork())
        assertEquals("the second hour is silent", 2, env.posted.size)
        env.read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 300.0)), listOf(AlertFixture.structure(10, 20.0))))
        worker(env).doWork()
        env.read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 8.0))))
        worker(env).doWork()
        assertEquals("refuelled then dry again: told again", 3, env.posted.size)
    }

    @Test fun theWorkerDoesNothingWithEveryTypeOff() = runBlocking {
        val env = Env(prefs = InMemoryCorpAlertPrefs(off = AlertKind.entries.toMutableSet()), read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))))
        assertEquals(ListenableWorker.Result.success(), worker(env).doWork())
        assertEquals("not even a request", 0, env.fetches); assertTrue(env.posted.isEmpty())
    }

    @Test fun theWorkerHonoursEachToggle() = runBlocking {
        val prefs = InMemoryCorpAlertPrefs(off = mutableSetOf(AlertKind.StructureFuel, AlertKind.Reinforced))
        val env = Env(prefs = prefs, read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)), listOf(AlertFixture.structure(10, 1.0)))))
        worker(env).doWork()
        assertEquals(listOf(AlertKind.TowerFuel), env.posted.map { it.kind })
    }

    @Test fun withoutNotificationPermissionNothingCountsAsTold() = runBlocking {
        val env = Env(read = listOf(AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0)))), allowed = false)
        worker(env).doWork()
        assertTrue(env.posted.isEmpty()); assertTrue(env.prefs.fired().isEmpty())
        env.allowed = true
        worker(env).doWork()
        assertEquals("permission granted later: it tells then", 1, env.posted.size)
    }

    @Test fun aFailedReadRetriesAFewTimesThenGivesUpQuietly() = runBlocking {
        val env = Env(read = null)
        assertEquals(ListenableWorker.Result.retry(), worker(env, attempt = 0).doWork())
        assertEquals(ListenableWorker.Result.success(), worker(env, attempt = CorpAlertWorker.MAX_RETRIES).doWork())
        assertTrue(env.posted.isEmpty())
    }

    @Test fun theJobIsHourlyUniqueAndNeedsANetwork() {
        val r = CorpAlertScheduler.request()
        assertEquals(TimeUnit.HOURS.toMillis(1), r.workSpec.intervalDuration)
        assertEquals(NetworkType.CONNECTED, r.workSpec.constraints.requiredNetworkType)
        assertEquals("corp-alerts", CorpAlertScheduler.UNIQUE_NAME)
        assertTrue(CorpAlertScheduler.UNIQUE_NAME in r.tags)
    }

    @Test fun theSwitchesDefaultOnAndStickInMemory() {
        val p = InMemoryCorpAlertPrefs()
        assertEquals(AlertKind.entries.toSet(), p.enabledKinds())
        p.setEnabled(AlertKind.Reinforced, false)
        assertFalse(p.enabled(AlertKind.Reinforced)); assertNull(null)
    }
}
