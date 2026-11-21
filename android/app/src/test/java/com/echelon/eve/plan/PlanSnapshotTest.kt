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
    private fun belt(s: Sys, jumps: Int, isk: Double, ore: String, how: String, kills: Int = 0) = com.echelon.eve.plan.mine.Belt(s, jumps, 3, isk, kills, 140, lowsec = s.sec < 0.45,
        ores = listOf(com.echelon.eve.plan.mine.OreAt(ore, isk / 1_000_000 * 70, how, "Jita IV - Moon 4 - Caldari Navy Assembly Plant")))
    val mine = com.echelon.eve.plan.mine.MineResult(
        ready = true,
        me = com.echelon.eve.plan.mine.MinerPlan("Fiofka", true, com.echelon.eve.plan.mine.MineShip(32880, "Venture", current = true, rate = 202.4, hold = 5000.0),
            sys(30000142, "Jita", 0.946, 10000002), listOf(belt(sys(30000133, "Hirtamon", 0.949, 10000002), 2, 1_246_501.0, "Scordite", "compressed"),
                belt(sys(30000144, "Perimeter", 0.95, 10000002), 1, 1_102_000.0, "Veldspar", "compressed", kills = 2), belt(sys(30002813, "Tama", 0.3, 10000002), 2, 2_830_000.0, "Kernite", "raw"))),
        mate = com.echelon.eve.plan.mine.MinerPlan("Decxus", true, com.echelon.eve.plan.mine.MineShip(32880, "Venture", rate = 180.0, hold = 5000.0), sys(30002813, "Tama", 0.3, 10000002)),
        together = com.echelon.eve.plan.mine.Together("apart", sys(30002813, "Tama", 0.3, 10000002), 2),
        ships = listOf(com.echelon.eve.plan.mine.MineShip(17476, "Covetor", flyable = false, rate = 613.0, hold = 9000.0, needs = "Mining Barge I", iskHour = 3_448_779.0),
            com.echelon.eve.plan.mine.MineShip(32880, "Venture", current = true, rate = 202.4, hold = 5000.0, iskHour = 1_246_501.0)),
        train = listOf(com.echelon.eve.plan.mine.MineTrain("Mining", 4, 3, "Miner II: +50% laser yield, and +5% per level")),
        ores = listOf(com.echelon.eve.plan.mine.OreValue("Kernite", 385.4, "raw", 462.5, 195.3, 150.1)),
        ledgers = com.echelon.eve.plan.mine.Ledgers(com.echelon.eve.plan.mine.Ledger("ok", 52_000.0, 4_800_000.0, 6, listOf(com.echelon.eve.plan.mine.LedgerSystem("Hirtamon", 40_000.0, 3_700_000.0, 4))),
            com.echelon.eve.plan.mine.Ledger("no-permission")),
    )
    val build = com.echelon.eve.plan.build.BuildResult(
        ready = true, categories = listOf("Drone", "Frigate", "Charge"),
        summary = com.echelon.eve.plan.build.BuildSummary(56, 64, 30_018_678.0, "Yashunen", 0.0118, true, false, 3, 1, 0.0543, 0.075, 0.03,
            com.echelon.eve.plan.build.Cheaper("Yashunen", 9, 0.0118, 0.1722), 8),
        wing = listOf(com.echelon.eve.plan.build.CrewPlan("Fiofka", listOf(com.echelon.eve.plan.build.Chosen("Warp Disrupt Probe"), com.echelon.eve.plan.build.Chosen("Hobgoblin I", true)), 31_800_000.0, 49_900_000.0, 3, 50_000_000.0),
            com.echelon.eve.plan.build.CrewPlan("Decxus", emptyList(), wallet = 2_000_000.0, slots = 2)),
        picks = listOf(
            com.echelon.eve.plan.build.Pick(1, 1, "Warp Disrupt Probe", "Charge", 5, plan = "Fiofka", flags = listOf(com.echelon.eve.plan.build.Flag("crowded", "Crowded", "10+ stations already list it")),
                profitDay = 30_018_678.0, payback = 10.3, invest = 49_928_404.0, margin = 0.21, me = 10, runs = 40, price = 2_344_200.0, sellers = 6, sellerJumps = 2,
                research = com.echelon.eve.plan.build.Research(0, 10, 96_000.0, 1_200_000.0), unitsPerDay = 254.0, sellPrice = 118_000.0, profitAtZero = 20_000.0,
                broker = com.echelon.eve.plan.build.Broker(0.03, false, "Jita IV - Moon 4 - Caldari Navy Assembly Plant"), daily = 5100.0, listings = 14, trend = 0.04, materialsRegion = "Domain",
                bill = listOf(com.echelon.eve.plan.build.BillRow(34, "Tritanium", 1982, 3.08), com.echelon.eve.plan.build.BillRow(35, "Pyerite", 5616, 14.17)),
                legs = listOf(com.echelon.eve.plan.build.Leg("Buy the blueprint", "Itamo VIII - Core Complexion Inc. Factory", 2), com.echelon.eve.plan.build.Leg("Research to ME 10", "Wuos VI - Zainou Biotech Research Center", 10),
                    com.echelon.eve.plan.build.Leg("Buy materials", "Misaba V - Moon 3 - Zoar and Sons Factory", 52, 4), com.echelon.eve.plan.build.Leg("Sell", "Jita IV - Moon 4 - Caldari Navy Assembly Plant", 9))),
            com.echelon.eve.plan.build.Pick(2, 2, "Rifter", "Frigate", 20, affordable = false, missing = listOf(com.echelon.eve.plan.build.Missing("Spaceship Command", 3)), profitDay = 290_000.0, payback = 13.0, invest = 3_250_000.0, margin = 0.12),
        ),
        guide = com.echelon.eve.plan.build.Guide("Weeks 2–4 · expand", 100_000_000.0, listOf("Run 4–8 BPOs across both pilots.", "Keep every slot busy."), 50_000_000.0,
            listOf(com.echelon.eve.plan.build.TrainSkill("massProduction", "Mass Production", 2, 3, false, "+1 manufacturing slot per level")), fees = 0.105, scc = com.echelon.eve.plan.build.Scc(0.04, 0.02), npcTax = 0.0025),
        library = com.echelon.eve.plan.build.Library(listOf(com.echelon.eve.plan.build.OwnedBp(2456, "bpo", "Owned (ME 10/TE 20)", 10, 20, loc = 60003760)), null),
    )
    private fun place(sys: String, station: String, price: Double = 0.0) = com.echelon.eve.plan.trade.Place(1, station, 1, sys, price)
    val trade = com.echelon.eve.plan.trade.TradeResult(
        ready = true,
        hauls = listOf(com.echelon.eve.plan.trade.Haul(40, "Megacyte", place("Jita", "Jita IV - Moon 4 - Caldari Navy Assembly Plant", 2000.0), place("Abudban", "Abudban IV - Tribal Liberation Force Logistic Support", 2498.0),
                12600, 126.0, 25_200_000.0, 3_914_190.0, 156_567.6, 0, 25),
            com.echelon.eve.plan.trade.Haul(34, "Tritanium", place("Perimeter", "Perimeter II", 3.1), place("Amarr", "Amarr VIII (Oris)", 3.9), 500_000, 5000.0, 1_550_000.0, 380_000.0, 95_000.0, 1, 3)),
        spreads = listOf(com.echelon.eve.plan.trade.Spread(31528, "Medium Hybrid Burst Aerator I", place("Jita", "Jita IV - Moon 4 - Caldari Business Tribunal"), 849_000.0, 1_120_000.0, 0.28, 27.0, 1_180_534.5, 380_000.0, 0)),
        builds = listOf(com.echelon.eve.plan.trade.BuildMargin(587, "Rifter", place("Jita", "Jita IV - Moon 4"), 210_000.0, 12_000.0, 354_000.0, 131_905.0, 0.59, 40.0, 0)),
        index = 0.1722, fees = com.echelon.eve.plan.trade.Fees(0.0668, 0.027, true, 1, 5000.0, 50_000_000.0),
        brokers = listOf(com.echelon.eve.plan.trade.HubFee("Jita", 0.0254, true, 2.0, 5.0), com.echelon.eve.plan.trade.HubFee("Amarr", 0.027)),
    )
    val sellGathered = com.echelon.eve.plan.sell.Gathered(
        ships = listOf(com.echelon.eve.plan.sell.SellShip(2124810474, "Fiofka", "Miner", 32880, 30000142, "Jita", 60003760, "Jita IV - Moon 4 - Caldari Navy Assembly Plant", true)),
        rows = listOf(com.echelon.eve.plan.sell.SellRow("s:1:34", 34, 100000, com.echelon.eve.plan.sell.From("ship", pilot = 2124810474), "Miner’s hold"),
            com.echelon.eve.plan.sell.SellRow("h:1:35", 35, 1000, com.echelon.eve.plan.sell.From("hangar", station = 60003760), "Hangar at Jita IV - Moon 4 - Caldari Navy Assembly Plant", pasted = true)),
        notes = listOf(com.echelon.eve.plan.sell.GatherNote("Decxus", "Decxus has not shared a ship with the wing.")),
        pickup = 60003760, pickupName = "Jita IV - Moon 4 - Caldari Navy Assembly Plant", canPick = true,
    )
    val sell = com.echelon.eve.plan.sell.SellResult(listOf(
        com.echelon.eve.plan.sell.SellPlan("here", "Sell here", listOf("best"), 0, 420_412.5, 0.0, 420_412.5, 0.99,
            ships = listOf(com.echelon.eve.plan.sell.ShipPlan(2124810474, "Miner", listOf(30000142), listOf("Jita"), 0, 420_412.5, "Jita", listOf(com.echelon.eve.plan.sell.Stop(60003760, "Jita IV - Moon 4 - Caldari Navy Assembly Plant", "Jita", 30000142,
                listOf(com.echelon.eve.plan.sell.Pickup(35, 500)), listOf(com.echelon.eve.plan.sell.Sale(34, 100000, 4.5, 416_250.0), com.echelon.eve.plan.sell.Sale(35, 500, 9.0, 4_162.5, true, "Structure in Perimeter", "range 1 jump")))))),
            unsold = listOf(com.echelon.eve.plan.sell.Unsold(35, 500, "no buyer on route", "Jita IV - Moon 4 - Caldari Navy Assembly Plant"))),
        com.echelon.eve.plan.sell.SellPlan("most", "Most ISK", emptyList(), 3, 489_787.5, 3.4, -2_250_774.8, 0.99,
            ships = listOf(com.echelon.eve.plan.sell.ShipPlan(2124810474, "Miner", listOf(30000142, 30000144, 30003504, 30002187), listOf("Jita", "Perimeter", "Niarja", "Amarr"), 3, 489_787.5, "Jita"))),
    ), listOf(com.echelon.eve.plan.sell.SellNote("thin", 35, 500.0, 1.0, "here")))
    private fun g(json: String) = com.echelon.eve.plan.goals.Goal(com.echelon.eve.core.api.EchelonJson.parseToJsonElement(json) as kotlinx.serialization.json.JsonObject, 1)
    val goals = listOf(
        g("""{"id":"1","title":"Fly our first exploration fleet","pilot":"Both pilots","done":false,"category":"Exploration","due":"2026-11-30","steps":[{"text":"Train Astrometrics III","done":true},{"text":"Fit two Herons","done":false}],"notes":"Meet in Jita on Saturday.","updatedAt":1}"""),
        g("""{"id":"2","title":"Build 100 Hobgoblins","pilot":"Fiofka","done":false,"category":"Industry","due":"2026-11-01","target":30000000,"result":12000000,"updatedAt":1}"""),
        g("""{"id":"3","title":"Buy a Venture","pilot":"Decxus","done":true,"category":"Ships","updatedAt":1}"""),
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
    @Test fun mine() = paparazzi.echelon {
        com.echelon.eve.plan.mine.MineScreen(com.echelon.eve.plan.mine.MineUi(Pilot.Fiofka, com.echelon.eve.plan.mine.MineSettings(), PlanFixtures.starts, PlanFixtures.mine, open = 30000133, canSend = true),
            com.echelon.eve.plan.mine.MineActions(), scroll = false)
    }
    @Test fun build() = paparazzi.echelon {
        com.echelon.eve.plan.build.BuildScreen(com.echelon.eve.plan.build.BuildUi("Fiofka", com.echelon.eve.plan.build.BuildSettings(budget = "50m"), PlanFixtures.starts, PlanFixtures.build, open = 1,
            names = mapOf(2456L to "Hobgoblin I Blueprint", 60003760L to "Jita IV - Moon 4 - Caldari Navy Assembly Plant"), mateName = "Decxus"), com.echelon.eve.plan.build.BuildActions(), scroll = false)
    }
    @Test fun trade() = paparazzi.echelon {
        com.echelon.eve.plan.trade.TradeScreen(com.echelon.eve.plan.trade.TradeUi("Fiofka", com.echelon.eve.plan.trade.TradeSettings(cargo = "5000", budget = "50000000"), PlanFixtures.starts, PlanFixtures.trade, open = 0, canSend = true,
            orders = com.echelon.eve.plan.trade.OrdersState(com.echelon.eve.plan.trade.OrdersView(listOf(
                com.echelon.eve.plan.trade.OrderRow("outbid", 0.5, "station", 1, 34, "Tritanium", false, 5.5, 500, 1000, 1, "Jita IV - Moon 4 - Caldari Navy Assembly Plant", 27),
                com.echelon.eve.plan.trade.OrderRow("best", null, null, 2, 35, "Pyerite", true, 9.1, 10_000, 10_000, 1, "Jita IV - Moon 4 - Caldari Navy Assembly Plant", 89)),
                com.echelon.eve.plan.trade.OrderHistory(com.echelon.eve.plan.trade.HistorySummary(filled = 3, expired = 1, sold = 12_400_000.0), emptyList())))),
            com.echelon.eve.plan.trade.TradeActions(), scroll = false)
    }
    @Test fun sell() = paparazzi.echelon {
        com.echelon.eve.plan.sell.SellScreen(com.echelon.eve.plan.sell.SellUi(com.echelon.eve.plan.sell.SellForm(), PlanFixtures.sellGathered,
            mapOf(34L to com.echelon.eve.plan.sell.TypeInfo("Tritanium", 0.01, 0.0), 35L to com.echelon.eve.plan.sell.TypeInfo("Pyerite", 0.01, 0.0), 32880L to com.echelon.eve.plan.sell.TypeInfo("Venture", 0.0, 5000.0)),
            result = PlanFixtures.sell, mode = "here", status = "2 plans · buy orders as of just now · 4 requests to EVE.", canSend = setOf(2124810474)), com.echelon.eve.plan.sell.SellActions(), scroll = false)
    }
    @Test fun goals() = paparazzi.echelon { com.echelon.eve.plan.goals.GoalsScreen(com.echelon.eve.plan.goals.GoalsUi(PlanFixtures.goals, filter = "all", today = "2026-11-21"), com.echelon.eve.plan.goals.GoalsActions(), scroll = false) }
    @Test fun goalForm() = paparazzi.echelon { com.echelon.eve.plan.goals.GoalsScreen(com.echelon.eve.plan.goals.GoalsUi(emptyList(), showForm = true, fields = com.echelon.eve.plan.goals.GoalFields(title = "Fly a fleet", pilot = "Fiofka"), formProblem = "Write the target date as YYYY-MM-DD."), com.echelon.eve.plan.goals.GoalsActions(), scroll = false) }
    @Test fun exploreNoBands() = paparazzi.echelon {
        ExploreScreen(ExploreUi(Pilot.Fiofka, ExploreSettings(bands = emptySet()), PlanFixtures.starts), now, ExploreActions(), canSend = true, scroll = false)
    }
}
