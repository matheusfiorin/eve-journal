package com.echelon.eve.fly.timers

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** ESI parsing, the disk cache, reading a fit's rows, the profile end to end, ring heat and the timer's mining line. */
class MiningLoaderTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun esi(id: Long, name: String, group: Long, capacity: Double, vararg attrs: Pair<Int, Double>) = buildJsonObject {
        put("type_id", id); put("name", name); put("group_id", group); put("capacity", capacity)
        put("dogma_attributes", buildJsonArray { attrs.forEach { (a, v) -> add(buildJsonObject { put("attribute_id", a); put("value", v) }) } })
    }

    private val db = mapOf(
        32880L to esi(32880, "Venture", 25, 50.0, 1556 to 5000.0, 207 to 2.0, 1842 to 5.0, 3237 to -5.0, 3239 to 100.0),
        25266L to esi(25266, "Gas Cloud Scoop I", 737, 0.0, 77 to 10.0, 73 to 30_000.0, 182 to 25544.0),
        22542L to esi(22542, "Mining Laser Upgrade I", 546, 0.0, 434 to 5.0),
        3386L to esi(3386, "Mining", 1218, 0.0, 434 to 5.0),
    )

    @Test fun parsesEsiTypes() {
        val t = parseDogmaType(db.getValue(25266))!!
        assertEquals("Gas Cloud Scoop I", t.name)
        assertEquals(10.0, t.a(77)!!, 0.0)
        assertEquals(listOf(25544L), t.requiredSkills)
        assertNull(parseDogmaType(buildJsonObject { put("name", "x") }))
    }

    @Test fun theCacheFetchesOnceKeepsItOnDiskAndRetriesMisses() = runTest {
        val file = tmp.newFile("dogma.json")
        file.delete()
        var calls = 0
        var clock = 1_000L
        val cache = DogmaCache({ id -> calls++; db[id] }, file, clock = { clock })
        assertEquals(2, cache.getAll(listOf(32880, 25266, 999)).size)
        assertEquals(3, calls)
        cache.getAll(listOf(32880, 25266))
        assertEquals(3, calls)
        // A second process reads the file instead of asking ESI.
        val again = DogmaCache({ id -> calls++; null }, file, clock = { clock })
        assertEquals("Venture", again.get(32880)!!.name)
        assertEquals(3, calls)
        // A month later the file is stale and ESI is asked again.
        clock += DogmaCache.MONTH + 1
        assertNull(DogmaCache({ id -> calls++; null }, file, clock = { clock }).get(32880))
        assertEquals(4, calls)
    }

    @Test fun readsHighAndLowSlotRowsFromTheFit() {
        val rows = EchelonJson.parseToJsonElement("[[25266,27,1],[25266,28,1],[22542,11,1],[3170,19,1],[1234,92,1],[999,27,50]]") as JsonArray
        val m = fitModules(rows)
        assertEquals(mapOf(25266L to 2, 999L to 50), m.high)
        assertEquals(mapOf(22542L to 1), m.low)
    }

    @Test fun theProfileEndToEndForTheUsersVenture() = runTest {
        // Rows as the snapshot keeps them: [type, flag, quantity]; the Venture's two scoops are in high slots 0 and 1.
        val fit = com.echelon.eve.fly.RawFit(32880, EchelonJson.parseToJsonElement("[[25266,27,1],[25266,28,1]]") as JsonArray)
        val cache = DogmaCache({ id -> db[id] ?: esi(id, "Skill $id", 1218, 0.0) }, null)
        val loader = MiningFitter(cache)
        val ui = loader.profile(fit, 32880, mapOf(Dogma.MINING to 4, Dogma.GAS_CLOUD_HARVESTING to 4, Dogma.MINING_FRIGATE to 3))
        val p = ui.profile!!
        assertEquals("Cycle 0:26 · hold full in 53 min", miningLine(p))
        assertEquals("2× Gas Cloud Scoop I", p.summary)
        // No mining modules: a note, not a crash.
        val none = loader.profile(com.echelon.eve.fly.RawFit(32880, JsonArray(emptyList())), 32880, emptyMap())
        assertNull(none.profile)
        assertTrue(none.note!!.contains("no mining"))
    }

    // ---- the timer's meta, the ring and the notification bar ----

    private val t0 = 1_795_000_000_000L

    @Test fun aMiningTimerKeepsWhatItWasWorkedOutFromInItsMeta() {
        val draft = TimerDraft(TimerKind.Mining, 25_500, repeat = true, cycleMs = 25_500, holdFullMs = 3_187_500, fit = "Venture: 2× Gas Cloud Scoop I")
        val t = draft.applyTo(newTimer("m", TimerKind.Mining, 25_500, Pilot.Fiofka, t0))
        assertTrue(t.repeats)
        assertEquals("Cycle 0:26 · hold full in 53 min · repeats · Venture: 2× Gas Cloud Scoop I", t.fitLine())
        assertNull(newTimer("x", TimerKind.Generic, MIN, Pilot.Fiofka, t0).fitLine())
        // A sleeper draft records the site.
        assertEquals(GasSleepers.SITE_WH, TimerDraft(TimerKind.Sleeper, 15 * MIN).applyTo(newTimer("s", TimerKind.Sleeper, 15 * MIN, Pilot.Fiofka, t0)).site)
        assertEquals(GasSleepers.SITE_KS, TimerDraft(TimerKind.Gas, 20 * MIN).applyTo(newTimer("g", TimerKind.Gas, 20 * MIN, Pilot.Fiofka, t0)).site)
    }

    @Test fun theRingWarmsTowardsTheWarningAndTurnsRedAtTheEnd() {
        val t = newTimer("s", TimerKind.Sleeper, 15 * MIN, Pilot.Fiofka, t0)
        assertEquals(RingHeat.Calm, ringHeat(t, t0 + 5 * MIN))
        // Warning at 13:00 (2:00 left): amber starts building 30 s earlier.
        assertEquals(0f, ringHeat(t, t0 + 12 * MIN + 29 * SEC).warn, 1e-6f)
        assertEquals(0.5f, ringHeat(t, t0 + 12 * MIN + 45 * SEC).warn, 1e-6f)
        assertEquals(1f, ringHeat(t, t0 + 13 * MIN + 30 * SEC).warn, 1e-6f)
        assertEquals(0f, ringHeat(t, t0 + 14 * MIN + 39 * SEC).last, 1e-6f)
        assertEquals(1f, ringHeat(t, t0 + 15 * MIN - 1).last, 1e-3f)
        assertEquals(RingHeat.Calm, ringHeat(t, t0 + 16 * MIN))
        assertEquals(RingHeat.Calm, ringHeat(t.paused(t0 + 14 * MIN), t0 + 14 * MIN))
        // A timer with no warnings does not warm up.
        assertEquals(RingHeat.Calm, ringHeat(newTimer("m", TimerKind.Mining, 15 * MIN, Pilot.Fiofka, t0), t0 + 14 * MIN))
        assertEquals(0, warningsPassed(t, t0 + 5 * MIN)); assertEquals(1, warningsPassed(t, t0 + 13 * MIN)); assertEquals(1, warningsPassed(t, t0 + 14 * MIN))
    }

    @Test fun aRepeatingTimerAdvancesOnceAtItsEnd() = runTest {
        val file = tmp.newFile("timers.json"); file.delete()
        var now = t0
        val timers = kotlinx.coroutines.flow.MutableStateFlow<Map<String, WingTimer>>(emptyMap())
        val room = object : TimerStore.Room {
            override val timers = timers
            override fun upsert(timer: WingTimer) {}
            override fun remove(id: String, owner: Pilot) {}
        }
        val d = kotlinx.coroutines.test.UnconfinedTestDispatcher(testScheduler)
        val store = TimerStore(kotlinx.coroutines.CoroutineScope(backgroundScope.coroutineContext + d), file, room, clock = { now }, io = d)
        val t = store.start(Pilot.Fiofka, TimerDraft(TimerKind.Mining, 30 * SEC, repeat = true))
        now = t0 + 31 * SEC
        store.advance(t.id, t.endsAt)
        val next = store.timers.value.getValue(t.id)
        assertEquals(t0 + 30 * SEC, next.startedAt)
        assertEquals(t0 + 60 * SEC, next.endsAt)
        // The second caller (service and alarm both fire) finds a timer already advanced and changes nothing.
        store.advance(t.id, t.endsAt)
        assertEquals(next, store.timers.value.getValue(t.id))
        // A plain timer never advances.
        val plain = store.start(Pilot.Fiofka, TimerDraft(TimerKind.Gas, 10 * SEC))
        now = t0 + 61 * SEC
        store.advance(plain.id, plain.endsAt)
        assertEquals(plain.startedAt, store.timers.value.getValue(plain.id).startedAt)
        assertNotNull(store)
    }
}
