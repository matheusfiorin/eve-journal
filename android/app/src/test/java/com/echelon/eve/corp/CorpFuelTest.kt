package com.echelon.eve.corp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CorpFuelTest {
    private val names = mapOf(12235L to "Caldari Control Tower Medium", 12236L to "Amarr Control Tower", 35832L to "Astrahus")
    private fun plan(days: Int, snap: CorpSnapshot = CorpFixture.snap, block: FuelBlock = FuelBlock.Helium) = refuelPlan(snap, days, names::get, block)

    @Test fun towersBurnBySizeAndTakeTheirRacesBlock() {
        assertEquals(listOf(10, 20, 40), listOf("small", "medium", "large").map(::towerBurn))
        assertEquals(FuelBlock.Nitrogen, towerBlock("Caldari Control Tower Medium")); assertEquals(FuelBlock.Helium, towerBlock("Dark Blood Control Tower"))
        assertEquals(FuelBlock.Hydrogen, towerBlock("Serpentis Control Tower")); assertEquals(FuelBlock.Oxygen, towerBlock("Minmatar Control Tower Small"))
        assertNull(towerBlock("Control Tower")); assertNull(towerBlock(null))
    }

    @Test fun aTowersTopUpIsWhatTheDaysNeedMinusWhatItHolds() {
        // The fixture's medium tower: 39 h of fuel at 20 blocks an hour. 14 days = 336 h, so 297 h more = 5,940 blocks.
        val line = plan(14).lines.single { it.tower }
        assertEquals(20, line.burnPerHour); assertEquals(5_940L, line.toAdd); assertEquals(FuelBlock.Nitrogen.typeName, line.blockName)
        assertEquals(29_700.0, line.volume, 1e-9)
        assertEquals(6_720L, line.total(14))
        assertEquals(20L * (7 * 24 - 39), plan(7).lines.single { it.tower }.toAdd)
        assertEquals(20L * (30 * 24 - 39), plan(30).lines.single { it.tower }.toAdd)
    }

    @Test fun aTowerWithEnoughFuelNeedsNothing() {
        val full = CorpFixture.snap.copy(starbases = Section(listOf(AlertFixture.tower(hours = 400.0)), null, false, null))
        assertEquals(0L, refuelPlan(full, 14, names::get).lines.single { it.tower }.toAdd)
        assertEquals(20L * (30 * 24 - 400), refuelPlan(full, 30, names::get).lines.single { it.tower }.toAdd)
    }

    @Test fun anOfflineTowerBurnsNothing() {
        val off = CorpFixture.snap.copy(starbases = Section(listOf(AlertFixture.tower(hours = null, state = "offline")), null, false, null))
        val line = refuelPlan(off, 14, names::get).lines.single { it.tower }
        assertEquals(0, line.burnPerHour); assertEquals(0L, line.toAdd)
    }

    @Test fun aStructureBurnsWhatItsOnlineServicesUse() {
        val s = Structure(1, 35832, 30000144, services = listOf(Service("Manufacturing (Standard)", "online"), Service("Market Hub", "offline"), Service("Reprocessing", "online")))
        assertEquals(12 + 10, structureBurn(s))
        assertEquals(40, serviceBurn("Standup Market Hub I")); assertEquals(DEFAULT_SERVICE_BURN, serviceBurn("Something new"))
        // 2 days of fuel (48 h) at 12 blocks an hour, run 7 days: (168 - 48) h x 12 = 1,440.
        val one = CorpFixture.snap.copy(structures = Section(listOf(AlertFixture.structure(days = 2.0).copy(services = listOf(Service("Manufacturing (Standard)", "online")))), null, false, null))
        assertEquals(1_440L, refuelPlan(one, 7, names::get).lines.single { !it.tower }.toAdd)
    }

    @Test fun totalsAndTheMultibuyAddUpPerBlockType() {
        val p = plan(14)
        assertEquals(p.lines.sumOf { it.toAdd }, p.totalBlocks)
        assertEquals(p.totalBlocks * 5.0, p.totalVolume, 1e-9)
        // The tower buys Nitrogen; the structure is bought as the chosen block. The fixture's structure runs Manufacturing (12/h) with 2 days left.
        assertEquals(listOf("Nitrogen Fuel Block 5940", "Helium Fuel Block ${12L * (14 * 24 - 48)}").toSet(), multibuy(p).lines().toSet())
        assertTrue(multibuy(plan(14, block = FuelBlock.Oxygen)).contains("Oxygen Fuel Block"))
    }

    @Test fun theMultibuyIsOneNameAndQuantityPerLineAndSkipsWhatIsCovered() {
        val covered = CorpFixture.snap.copy(starbases = Section(listOf(AlertFixture.tower(hours = 700.0)), null, false, null), structures = Section(emptyList(), null, false, null))
        assertEquals("", multibuy(refuelPlan(covered, 14, names::get)))
        assertTrue(multibuy(plan(30)).lines().all { Regex("""^[A-Za-z ]+ Fuel Block \d+$""").matches(it) })
    }

    @Test fun healthTalliesCountEachState() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 9.0), AlertFixture.tower(2, 300.0), AlertFixture.tower(3, 5.0, "reinforced")), listOf(AlertFixture.structure(10, 1.0), AlertFixture.structure(11, 9.0)))
        assertEquals(HealthCount(1, 1, 1), snap.towerHealth()); assertEquals(HealthCount(1, 1, 0), snap.structureHealth())
        assertNull(AlertFixture.snap(towers = null).towerHealth())
        assertEquals(1_750_000_000.0, CorpFixture.snap.walletTotal()!!, 1e-6)
    }

    @Test fun rolesBecomeInstructions() {
        val notes = roleNotes(CorpFixture.snap)
        assertEquals(listOf("Customs offices"), notes.map { it.section })
        assertTrue(notes.single().text.contains("Director") && notes.single().text.contains("Fiofka"))
        assertTrue(roleNotes(AlertFixture.snap(towers = null)).first().text.contains("Director or Station Manager"))
    }

    @Test fun theFuelBayListsReinforcedThenLowThenTheRest() {
        val snap = AlertFixture.snap(listOf(AlertFixture.tower(1, 300.0), AlertFixture.tower(2, 9.0)), listOf(AlertFixture.structure(10, 20.0, "armor_reinforce"), AlertFixture.structure(11, 5.0)))
        assertEquals(listOf(10L, 2L, 11L, 1L), fuelBay(snap, CorpNames()).map { it.id })
    }
}
