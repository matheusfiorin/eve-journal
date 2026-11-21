package com.echelon.eve.plan

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.explore.ExploreActions
import com.echelon.eve.plan.explore.ExploreLoop
import com.echelon.eve.plan.explore.ExploreResult
import com.echelon.eve.plan.explore.ExploreRow
import com.echelon.eve.plan.explore.ExploreScreen
import com.echelon.eve.plan.explore.ExploreSettings
import com.echelon.eve.plan.explore.ExploreUi
import com.echelon.eve.plan.explore.Explorer
import com.echelon.eve.plan.explore.Shortcut
import com.echelon.eve.plan.explore.TrainStep
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import org.junit.Rule
import org.junit.Test

/** Fixed data for the Plan goldens. */
object PlanFixtures {
    const val NOW = 1_795_000_000_000L
    private val regions = mapOf(10000016L to "Lonetrek", 10000002L to "The Forge", 10000033L to "The Citadel")
    val region = { id: Long -> regions[id] ?: "" }
    private fun sys(id: Long, name: String, sec: Double, region: Long = 10000016) = Sys(id, name, sec, region)
    val explore = ExploreResult(
        start = sys(30000142, "Jita", 0.946, 10000002),
        rows = listOf(
            ExploreRow(sys(30041407, "Ichinumi", 0.878), 3, 27, 0.0, 0.85, 1.0, deadEnd = true, pirates = "Guristas", score = 100),
            ExploreRow(sys(30031407, "Hitanishio", 0.947), 4, 22, 0.0, 0.87, 1.0, deadEnd = true, pirates = "Guristas", score = 93),
            ExploreRow(sys(30021392, "Kappas", 0.87), 3, 50, 0.0, 0.75, 1.0, deadEnd = true, pirates = "Guristas", score = 89),
            ExploreRow(sys(30001379, "Raussinen", 0.71, 10000033), 6, 140, 1.2, 0.52, 0.74, pirates = "Guristas", score = 41),
            ExploreRow(sys(30002780, "Mahtista", 0.65, 10000033), 7, 210, 0.0, 0.42, 1.0, visited = NOW - 5 * 3_600_000, pirates = "Guristas", score = 12),
        ),
        loop = ExploreLoop(listOf(sys(30021392, "Kappas", 0.87), sys(30001379, "Raussinen", 0.71, 10000033), sys(30031407, "Hitanishio", 0.947), sys(30041407, "Ichinumi", 0.878), sys(30002780, "Mahtista", 0.65, 10000033)),
            emptyList(), 29, 0.9997, 89),
        explorer = Explorer("Heron", "Caldari", 605, 2),
        train = listOf(TrainStep("hacking", 0, 3, "Data sites: more virus coherence", "Hacking"), TrainStep("archaeology", 1, 3, "Relic sites: more virus coherence", "Archaeology")),
        visited = 1, trafficHours = 30.0,
    )
    private fun step(s: Sys, p: Double, stop: Boolean = false, live: com.echelon.eve.plan.haul.HaulLive? = null) = com.echelon.eve.plan.haul.HaulStep(s, stop, p, if (s.sec >= 0.45) "hi" else "low", 3, 1200, live)
    val haul = com.echelon.eve.plan.haul.HaulResult(
        hull = com.echelon.eve.plan.haul.HaulHull("dst", "Deep space transport", 62500.0, "Heavy tank and a warp-core bonus."), suggested = "dst",
        modes = mapOf(
            "safest" to com.echelon.eve.plan.haul.HaulMode(listOf(sys(30000142, "Jita", 0.946, 10000002), sys(30002187, "Amarr", 1.0, 10000043)), emptyList(), 45, 0.9921, 3_900_000.0, 49.5),
            "balanced" to com.echelon.eve.plan.haul.HaulMode(listOf(sys(30000142, "Jita", 0.946, 10000002), sys(30002187, "Amarr", 1.0, 10000043)), emptyList(), 35, 0.9889, 5_500_000.0, 38.5,
                steps = listOf(step(sys(30000142, "Jita", 0.946, 10000002), 0.0002, true), step(sys(30000144, "Perimeter", 0.95, 10000002), 0.0011),
                    step(sys(30003504, "Niarja", 0.5, 10000043), 0.031, live = com.echelon.eve.plan.haul.HaulLive(4, 3, NOW - 9 * 60_000, dictor = true, ships = listOf(24690))),
                    step(sys(30002187, "Amarr", 1.0, 10000043), 0.0004, true))),
            "shortest" to com.echelon.eve.plan.haul.HaulMode(unreachable = listOf(sys(30000142, "Jita", 0.946, 10000002), sys(30002187, "Amarr", 1.0, 10000043))),
        ),
        live = com.echelon.eve.plan.haul.HaulLiveSummary(23), killDays = 7,
    )
    val starts = listOf(30000144L to "Perimeter · here", 30000142L to "Jita", 30002187L to "Amarr", 30002659L to "Dodixie", 30002510L to "Rens", 30002053L to "Hek")
    val shortcuts = listOf(Shortcut("Thera", sys(30000210, "Sirppala", 0.83), 6, "large", 14.0, "ABC-123"), Shortcut("Turnur", sys(30002813, "Tama", 0.3, 10000002), 2, "medium", 3.0, lowsec = true))
}

class PlanSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val now = PlanFixtures.NOW

    @Test fun explore() = paparazzi.echelon {
        ExploreScreen(ExploreUi(Pilot.Fiofka, ExploreSettings(from = 30000142), PlanFixtures.starts, PlanFixtures.explore, shortcuts = PlanFixtures.shortcuts, regionName = PlanFixtures.region, open = 30041407),
            now, ExploreActions(), canSend = true, scroll = false)
    }
    @Test fun haul() = paparazzi.echelon {
        com.echelon.eve.plan.haul.HaulScreen(com.echelon.eve.plan.haul.HaulUi(com.echelon.eve.plan.haul.HaulForm(value = "500m", volume = "20000"), PlanFixtures.haul,
            liveNote = "Live: 23 kills in the last hour across 6 regions from zKillboard.", names = mapOf(24690L to "Catalyst"), canSend = true, pilotName = "Fiofka"),
            now, com.echelon.eve.plan.haul.HaulActions(), scroll = false)
    }
    @Test fun exploreNoBands() = paparazzi.echelon {
        ExploreScreen(ExploreUi(Pilot.Fiofka, ExploreSettings(bands = emptySet()), PlanFixtures.starts), now, ExploreActions(), canSend = true, scroll = false)
    }
}
