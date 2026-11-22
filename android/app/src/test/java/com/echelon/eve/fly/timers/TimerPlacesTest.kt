package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingCodec
import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A small gate map and timers for the place rules and the goldens: Fiofka in Perimeter, Decxus in Tama. */
object TimerFixtures {
    const val NOW = 1_795_000_000_000L
    const val FORGE = 10000002L; const val CITADEL = 10000033L
    const val PERIMETER = 30000144L; const val JITA = 30000142L; const val NIYABAINEN = 30000143L; const val SOBASEKI = 30001363L
    const val NOURVUKAIKEN = 30002812L; const val TAMA = 30002813L; const val KEDAMA = 30002814L
    private fun s(id: Long, name: String, sec: Double, region: Long, vararg links: Long) = id to SolarSystem(id, name, sec, region, links.toList(), 0, null)
    val systems: Map<Long, SolarSystem> = mapOf(
        s(PERIMETER, "Perimeter", 0.95, FORGE, JITA),
        s(JITA, "Jita", 0.95, FORGE, PERIMETER, NIYABAINEN, SOBASEKI),
        s(SOBASEKI, "Sobaseki", 0.6, FORGE, JITA),
        s(NIYABAINEN, "Niyabainen", 0.9, FORGE, JITA, NOURVUKAIKEN),
        s(NOURVUKAIKEN, "Nourvukaiken", 0.7, CITADEL, NIYABAINEN, TAMA),
        s(TAMA, "Tama", 0.3, CITADEL, NOURVUKAIKEN, KEDAMA),
        s(KEDAMA, "Kedama", 0.4, CITADEL, TAMA),
    )
    val regions = mapOf(FORGE to "The Forge", CITADEL to "The Citadel")
    private fun t(id: String, kind: String, label: String, ago: Long, length: Long, owner: Pilot, system: Long?, paused: Long? = null, shared: Boolean = true) =
        WingTimer(id, kind, label, NOW - ago, length, paused, owner.id, shared).placed(system?.let { TimerSystem(it, systems[it]?.name.orEmpty()) })
    val timers = listOf(
        t("a", "gas", "Ghost site", 12 * MIN, 20 * MIN, Pilot.Fiofka, PERIMETER),
        t("b", "mining", "Mining cycle", 2 * MIN, 3 * MIN, Pilot.Fiofka, PERIMETER, shared = false),
        t("c", "despawn", "Wreck", 30 * MIN, 120 * MIN, Pilot.Decxus, TAMA),
        t("f", "gas", "Gas site", 3 * MIN, 15 * MIN, Pilot.Decxus, TAMA),
        t("d", "cyno", "Cyno", 10 * MIN, 5 * MIN, Pilot.Fiofka, JITA),
        t("e", "generic", "Refit", 20 * MIN, 30 * MIN, Pilot.Fiofka, SOBASEKI, paused = NOW - 5 * MIN),
        t("g", "generic", "Old timer", 8 * MIN, 30 * MIN, Pilot.Fiofka, null),
    )
    val map = TimerMap(systems, here = PERIMETER, wingmateAt = TAMA, regionName = { regions[it] })
}

class TimerPlacesTest {
    private val now = TimerFixtures.NOW
    private val systems = TimerFixtures.systems
    private fun timer(id: String = "a", label: String = "Gas site", length: Long = 10 * MIN, start: Long = now, owner: Pilot = Pilot.Fiofka, paused: Long? = null) =
        WingTimer(id, "gas", label, start, length, paused, owner.id)

    @Test fun theSystemLivesInMetaAndKeepsTheOtherKeys() {
        val base = timer().copy(meta = JsonObject(mapOf("site" to JsonPrimitive("Vital Core Reservoir"))))
        val placed = base.placed(TimerSystem(TimerFixtures.TAMA, "Tama"))
        assertEquals(TimerFixtures.TAMA, placed.systemId)
        assertEquals("Tama", placed.systemName)
        assertEquals("Vital Core Reservoir", placed.meta["site"]?.jsonPrimitive?.content)
        // Moving replaces, clearing removes both keys and nothing else; a blank name is not stored.
        val moved = placed.placed(TimerSystem(TimerFixtures.JITA, " "))
        assertEquals(TimerFixtures.JITA, moved.systemId); assertNull(moved.systemName)
        assertEquals(base, placed.placed(null))
        assertNull(timer().placed(TimerSystem(0, "Nowhere")).systemId)
    }

    @Test fun oldTimersAndOtherShapesStillRead() {
        // No meta at all (an older app's timer), a number sent as a double or a string by another client, a name without an id.
        assertNull(timer().systemId); assertNull(timer().system); assertNull(timer().systemName)
        val json = """{"id":"x","kind":"gas","label":"Gas site","startedAt":$now,"durationMs":60000,"owner":${Pilot.Decxus.id},"meta":{"system":3.0002813E7,"systemName":"Tama"}}"""
        val decoded = WingCodec.json.decodeFromString(WingTimer.serializer(), json)
        assertEquals(TimerSystem(TimerFixtures.TAMA, "Tama"), decoded.system)
        val asText = decoded.copy(meta = JsonObject(mapOf("system" to JsonPrimitive("30002813"))))
        assertEquals(TimerFixtures.TAMA, asText.systemId)
        assertNull(decoded.copy(meta = JsonObject(mapOf("systemName" to JsonPrimitive("Tama")))).systemName)
        // What goes to the room: the id as a number, the name as text.
        val sent = WingCodec.json.encodeToJsonElement(WingTimer.serializer(), timer().placed(TimerSystem(TimerFixtures.TAMA, "Tama"))).jsonObject["meta"]!!.jsonObject
        assertEquals(TimerFixtures.TAMA, sent["system"]!!.jsonPrimitive.long)
        assertEquals("Tama", sent["systemName"]!!.jsonPrimitive.content)
    }

    @Test fun newTimersCarryTheirSystem() {
        val t = newTimer("n", TimerKind.Gas, 20 * MIN, Pilot.Fiofka, now, system = TimerSystem(TimerFixtures.TAMA, "Tama"))
        assertEquals(TimerFixtures.TAMA, t.systemId)
        assertNull(newTimer("m", TimerKind.Gas, 20 * MIN, Pilot.Fiofka, now).systemId)
    }

    @Test fun titlesSayWhere() {
        val tama = timer().placed(TimerSystem(TimerFixtures.TAMA, "Tama"))
        assertEquals("Gas site in Tama", tama.title())
        // The gate map's name wins over the stored one; a label that names the place isn't doubled; no system, just the label.
        assertEquals("Gas site in Tama", timer().placed(TimerSystem(TimerFixtures.TAMA, "tama?")).title(systems))
        assertEquals("Wreck in Tama", timer(label = "Wreck in Tama").placed(TimerSystem(TimerFixtures.TAMA, "Tama")).title())
        assertEquals("Gas site", timer().title(systems))
        assertEquals("Gas site in Tama", draftTitle(TimerKind.Gas, " ", TimerSystem(TimerFixtures.TAMA, "Tama")))
        assertEquals("Ghost site", draftTitle(TimerKind.Gas, "Ghost site", null))
        assertEquals("Cyno", draftTitle(TimerKind.Cyno, "", TimerSystem(1, "")))
    }

    @Test fun notificationsNameTheSystem() {
        val t = timer(owner = Pilot.Decxus).placed(TimerSystem(TimerFixtures.TAMA, "Tama"))
        assertEquals("Gas site in Tama ends at 14:32", TimerNotifications.ongoingLine(t, 1, "14:32"))
        assertEquals("Gas site in Tama ends at 14:32 · 3 running", TimerNotifications.ongoingLine(t, 3, "14:32"))
        assertEquals("Ends at 14:32 · 3 running", TimerNotifications.ongoingText("14:32", 3))
        assertEquals("Decxus’s Gas site in Tama is done", TimerNotifications.doneTitle(t, mine = false))
        assertEquals("Gas site in Tama is done", TimerNotifications.doneTitle(t, mine = true))
        assertEquals("Gas site is done", TimerNotifications.doneTitle(timer(), mine = false).removePrefix("Fiofka’s "))
    }

    @Test fun jumpsWalkTheGates() {
        val j = jumpsFrom(TimerFixtures.PERIMETER, systems)
        assertEquals(0, j[TimerFixtures.PERIMETER]); assertEquals(1, j[TimerFixtures.JITA]); assertEquals(4, j[TimerFixtures.TAMA]); assertEquals(5, j[TimerFixtures.KEDAMA])
        assertEquals(mapOf(TimerFixtures.PERIMETER to 0, TimerFixtures.JITA to 1), jumpsFrom(TimerFixtures.PERIMETER, systems, maxJumps = 1))
        assertTrue(jumpsFrom(null, systems).isEmpty()); assertTrue(jumpsFrom(42, systems).isEmpty())
        assertEquals(listOf(TimerFixtures.PERIMETER, TimerFixtures.JITA, TimerFixtures.NIYABAINEN, TimerFixtures.NOURVUKAIKEN, TimerFixtures.TAMA), gatePath(TimerFixtures.PERIMETER, TimerFixtures.TAMA, systems))
        assertEquals(listOf(TimerFixtures.TAMA), gatePath(TimerFixtures.TAMA, TimerFixtures.TAMA, systems))
        assertTrue(gatePath(TimerFixtures.TAMA, 42, systems).isEmpty())
        assertEquals("here", jumpsText(0)); assertEquals("1 jump", jumpsText(1)); assertEquals("5 jumps", jumpsText(5)); assertNull(jumpsText(null))
    }

    @Test fun suggestionsPutExactThenPrefixThenNearest() {
        val near = jumpsFrom(TimerFixtures.PERIMETER, systems)
        assertEquals(listOf("Tama"), suggestSystems("tam", systems, near).map { it.name })
        // "ni": Niyabainen starts with it; Jita? no. Contains: Perimeter? no. So prefix first, then contains by distance.
        assertEquals(listOf("Niyabainen"), suggestSystems("niy", systems).map { it.name })
        assertEquals(listOf("Kedama", "Tama"), suggestSystems("ama", systems).map { it.name }.sorted())
        assertEquals(listOf("Tama", "Kedama"), suggestSystems("ama", systems, near).map { it.name }) // contains: nearer first
        assertEquals("Jita", suggestSystems("JITA", systems).first().name)
        assertTrue(suggestSystems("  ", systems).isEmpty())
        assertEquals(2, suggestSystems("a", systems, limit = 2).size)
        assertEquals(TimerFixtures.TAMA, systemNamed(" tama ", systems)?.id)
        assertNull(systemNamed("Tam", systems))
    }

    @Test fun theBoardPinsHereThenGoesBySoonestEnd() {
        val j = jumpsFrom(TimerFixtures.PERIMETER, systems)
        val groups = SystemBoard.of(TimerFixtures.timers, now, TimerFixtures.PERIMETER, TimerFixtures.TAMA, systems, j)
        // Here first; then Jita's cyno has ended (finished only), Tama runs (gas ends in 12 min), the unplaced one in 22 min,
        // Sobaseki only paused, Jita only finished.
        assertEquals(listOf(TimerFixtures.PERIMETER, TimerFixtures.TAMA, null, TimerFixtures.SOBASEKI, TimerFixtures.JITA), groups.map { it.systemId })
        val here = groups.first()
        assertTrue(here.here); assertEquals(0, here.jumps); assertEquals(listOf("b", "a"), here.timers.map { it.id })
        val tama = groups[1]
        assertTrue(tama.wingmateHere); assertEquals(4, tama.jumps); assertEquals("Tama", tama.name); assertEquals(listOf("f", "c"), tama.timers.map { it.id })
        assertEquals(now + 12 * MIN, tama.nextEnd(now))
        assertNull(groups[2].name)
        // Here shows even with nothing in it, so a timer can be started there; the wingmate's system only with timers.
        val empty = SystemBoard.of(emptyList(), now, TimerFixtures.PERIMETER, TimerFixtures.TAMA, systems, j)
        assertEquals(listOf(TimerFixtures.PERIMETER), empty.map { it.systemId })
        assertEquals("Perimeter", empty.single().name)
        // Without a gate map the stored name serves.
        assertEquals("Tama", SystemBoard.of(TimerFixtures.timers, now).first { it.systemId == TimerFixtures.TAMA }.name)
    }

    @Test fun theRadarHasEverySystemButYoursNearestFirst() {
        val j = jumpsFrom(TimerFixtures.PERIMETER, systems)
        val groups = SystemBoard.of(TimerFixtures.timers, now, TimerFixtures.PERIMETER, TimerFixtures.TAMA, systems, j)
        val nodes = radarNodes(groups, systems, TimerFixtures.TAMA, j)
        assertEquals(listOf("Jita", "Sobaseki", "Tama"), nodes.map { it.name })
        assertEquals(listOf(1, 2, 4), nodes.map { it.jumps })
        assertTrue(nodes.last().wingmate)
        // The wingmate with no timers still shows as a point.
        val alone = radarNodes(SystemBoard.of(emptyList(), now, TimerFixtures.PERIMETER, TimerFixtures.KEDAMA, systems, j), systems, TimerFixtures.KEDAMA, j)
        assertEquals(listOf("Kedama"), alone.map { it.name }); assertTrue(alone.single().timers.isEmpty())
        assertEquals(0.0, radarAngle(0, 3), 1e-9)
        assertEquals(1, ringStep(3)); assertEquals(2, ringStep(6)); assertEquals(5, ringStep(20)); assertEquals(10, ringStep(40))
    }

    @Test fun theHorizonFitsTheLastEndOnASquareRootAxis() {
        assertEquals(15 * MIN, horizonSpan(emptyList(), now))
        assertEquals(5 * MIN, horizonSpan(listOf(timer(length = 3 * MIN)), now))
        assertEquals(2 * HOUR, horizonSpan(listOf(timer(length = 3 * MIN), timer("b", length = 90 * MIN)), now))
        // Paused and finished timers don't stretch it.
        assertEquals(5 * MIN, horizonSpan(listOf(timer(length = 3 * MIN), timer("p", length = 5 * HOUR, paused = now)), now))
        assertEquals(MAX_TIMER, horizonSpan(listOf(timer(length = 2 * MAX_TIMER)), now))
        assertEquals(0f, horizonX(0, HOUR), 1e-6f); assertEquals(.5f, horizonX(15 * MIN, HOUR), 1e-6f); assertEquals(1f, horizonX(3 * HOUR, HOUR), 1e-6f)
        assertEquals(listOf(5 * MIN, 15 * MIN, 30 * MIN, HOUR), horizonTicks(HOUR).takeLast(4))
        assertEquals(HOUR, horizonTicks(HOUR).last())
        assertEquals(listOf(MIN, 5 * MIN), horizonTicks(5 * MIN))
    }

    @Test fun urgencyRisesTowardTheEnd() {
        assertEquals(1f, urgency(timer(length = 10 * MIN, start = now - 10 * MIN + 1), now), .01f)
        assertEquals(.8f, urgency(timer(length = 2 * MIN, start = now - MIN), now), .01f)
        assertTrue(urgency(timer(length = HOUR), now) < .1f)
        assertEquals(0f, urgency(timer(paused = now), now))
        assertEquals(0f, urgency(timer(length = MIN, start = now - 2 * MIN), now))
    }

    @Test fun labelsTakeTheFirstFreeLane() {
        assertEquals(listOf(0, 1, 0, 2), labelLanes(listOf(.1f, .15f, .5f, .2f), gap = .2f))
        assertEquals(listOf(0, 0, 0), labelLanes(listOf(.0f, .3f, .6f), gap = .2f))
        // More crowded than the lanes: the one whose last label is furthest back.
        assertEquals(3, labelLanes(listOf(.1f, .11f, .12f, .13f), gap = .2f, lanes = 3).toSet().size)
    }
}
