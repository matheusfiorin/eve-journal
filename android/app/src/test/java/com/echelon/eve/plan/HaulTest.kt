package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.js.PlannerBridge
import com.echelon.eve.plan.haul.HaulPlan
import com.echelon.eve.plan.haul.HaulResult
import com.echelon.eve.plan.haul.level
import com.echelon.eve.plan.haul.risk
import com.echelon.eve.ui.components.Tone
import kotlinx.coroutines.test.runTest
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.BeforeClass
import org.junit.Test
import java.io.File

/** Plan → Haul routes through the bridge on the fixture map; expected values are Node's for the same calls. */
class HaulTest {
    companion object {
        private lateinit var bridge: PlannerBridge
        @BeforeClass @JvmStatic fun load() = runTest {
            bridge = PlannerBridge(File("src/main/assets/planners.js").readText())
            bridge.loadUniverse(ExploreTest.UNIVERSE)
            bridge.callRaw("market.meta", "{\"meta\":${ExploreTest.META}}")
        }
        @AfterClass @JvmStatic fun close() = bridge.close()
        const val NOW = ExploreTest.NOW
        // One kill on Niarja's gate to Amarr ten minutes ago, by two Catalyst-class ships (type 24690).
        val KILLS = """[{"killmail_time":"${java.time.Instant.ofEpochMilli(NOW - 600_000)}","solar_system_id":30003504,"zkb":{"locationID":50000001,"totalValue":1e8},"victim":{"ship_type_id":648},"attackers":[{"ship_type_id":24690},{"ship_type_id":24690}]}]"""
    }

    private suspend fun plan(args: String) = EchelonJson.decodeFromString(HaulResult.serializer(), bridge.callRaw("haul.plan", args))

    @Test fun plansEveryModeOnHistory() = runTest {
        val r = plan("""{"stops":[30000142,30002187],"value":1e9,"volume":5000,"now":$NOW}""")
        assertEquals("br", r.hull?.key)
        assertEquals(listOf(10000002L, 10000043L), r.regions)
        val safest = r.modes.getValue("safest")
        assertEquals(3, safest.jumps); assertEquals(0.992203, safest.survival, 1e-6); assertEquals(7797371.0, safest.expectedLoss, 1.0)
        assertEquals("safest", r.modes.getValue("balanced").sameAs)
        assertNull(r.live)
    }

    @Test fun liveCampsRaiseTheRisk() = runTest {
        val r = plan("""{"stops":[30000142,30002187],"value":1e9,"volume":5000,"now":$NOW,"kills":$KILLS,"gateTo":{"50000001":30002187}}""")
        assertEquals(listOf(50000001L), r.gates)
        assertEquals(1, r.live?.kills)
        val m = r.modes.getValue("safest")
        assertEquals(0.961106, m.survival, 1e-6)
        val niarja = m.steps.first { it.system.name == "Niarja" }.live!!
        assertEquals(1, niarja.gateKills); assertEquals(listOf(24690L), niarja.ships); assertEquals(NOW - 600_000, niarja.last)
    }

    @Test fun twoStopsAreNeeded() = runTest {
        assertEquals("need-two-stops", plan("""{"stops":[30000142]}""").error)
    }

    @Test fun savedNumbersReadBackWithTheWebsNumber() {
        assertEquals("1500000000", com.echelon.eve.plan.haul.plainNumber(1.5e9)); assertEquals("12.5", com.echelon.eve.plan.haul.plainNumber(12.5))
        assertEquals("", com.echelon.eve.plan.haul.plainNumber(null)); assertEquals("", com.echelon.eve.plan.haul.plainNumber(-3.0))
    }

    @Test fun riskWordsAndMergeMatchTheWeb() {
        assertEquals("<0.1%", risk(0.0004)); assertEquals("0.8%", risk(0.0078)); assertEquals("12%", risk(0.1234))
        assertEquals(Tone.Ok, level(0.004)); assertEquals(Tone.Warn, level(0.02)); assertEquals(Tone.Danger, level(0.2))
        val mine = HaulPlan(listOf("Jita", "Amarr"), updatedAt = 10)
        val theirs = HaulPlan(listOf("Dodixie", "Hek"), updatedAt = 10)
        assertEquals(theirs, HaulPlan.merge(mine, theirs)) // a tie goes to the server
        assertEquals(mine.copy(updatedAt = 11), HaulPlan.merge(mine.copy(updatedAt = 11), theirs))
        assertEquals(mine, HaulPlan.merge(mine, null))
    }
}
