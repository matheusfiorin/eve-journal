package com.echelon.eve.fly.timers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The mining numbers against hand-computed values. The type data is what ESI returns (2025-09-26 compatibility date,
 * read 23 Nov 2026): Venture 32880, Gas Cloud Scoop I 25266, Miner I 483, Strip Miner I 17482, Hulk 22544, Retriever
 * 17478, Ice Harvester I 16278, Mining Laser Upgrade I 22542.
 */
class MiningCalcTest {
    private val venture = DogmaType(32880, "Venture", 25, 50.0, mapOf(1556 to 5000.0, 207 to 2.0, 1842 to 5.0, 3237 to -5.0, 3239 to 100.0, 182 to 32918.0))
    private val scoop = DogmaType(25266, "Gas Cloud Scoop I", 737, 0.0, mapOf(77 to 10.0, 73 to 30_000.0, 182 to 25544.0))
    private val miner = DogmaType(483, "Miner I", 54, 0.0, mapOf(77 to 10.0, 73 to 15_000.0, 182 to 3386.0))
    private val strip = DogmaType(17482, "Strip Miner I", 464, 0.0, mapOf(77 to 150.0, 73 to 45_000.0, 182 to 3386.0, 183 to 3410.0))
    private val ice = DogmaType(16278, "Ice Harvester I", 464, 0.0, mapOf(77 to 1000.0, 73 to 240_000.0, 182 to 16281.0))
    private val mlu = DogmaType(22542, "Mining Laser Upgrade I", 546, 0.0, mapOf(434 to 5.0))
    private val hulk = DogmaType(22544, "Hulk", 463, 350.0, mapOf(1556 to 11500.0, 3178 to -30.0, 3194 to -4.0, 3197 to 6.0, 3181 to 3.0, 3230 to -15.0, 3193 to -3.0, 3182 to -3.0, 3183 to -3.0, 3226 to -3.0, 3225 to -30.0))
    private val retriever = DogmaType(17478, "Retriever", 463, 450.0, mapOf(1556 to 27500.0, 3177 to 10.0, 3178 to -12.5, 3181 to 3.0, 3187 to 5.0, 3182 to -2.0, 3183 to -2.0, 3225 to -12.5))

    private val user = mapOf(
        Dogma.MINING to 4, Dogma.GAS_CLOUD_HARVESTING to 4, Dogma.MINING_FRIGATE to 3,
    )

    /**
     * The user's Venture: 2× Gas Cloud Scoop I, Gas Cloud Harvesting IV, Mining IV, Mining Frigate III.
     *  cycle   = 30 s x (1 - 5% x 3) = 30 x 0.85 = 25.5 s
     *  yield   = 10 m3 x (1 + 100%) = 20 m3 per scoop, 40 m3 for two
     *  hold    = 5000 m3 mining hold -> ceil(5000 / 40) = 125 cycles x 25.5 s = 3187.5 s = 53.1 min
     * Mining IV is a prerequisite for the gas skill, not a bonus to scoops (they do not require Mining).
     */
    @Test fun theUsersVentureOnGas() {
        val p = MiningCalc.profile(venture, listOf(scoop to 2), emptyList(), user)!!
        assertEquals(Harvest.Gas, p.kind)
        assertEquals(25_500L, p.cycleMs)
        assertEquals(40.0, p.yieldPerCycle, 1e-9)
        assertEquals(5000.0, p.holdM3, 1e-9)
        assertEquals(125, p.cycles)
        assertEquals(3_187_500L, p.holdFullMs)
        assertEquals(40.0 * 60 / 25.5, p.perMinute, 1e-9)
        assertEquals("2× Gas Cloud Scoop I", p.summary)
        assertEquals("Cycle 0:26 · hold full in 53 min", miningLine(p))
        assertEquals("mining hold", p.holdName)
    }

    @Test fun gasCloudHarvestingCapsHowManyScoopsCount() {
        val one = MiningCalc.profile(venture, listOf(scoop to 2), emptyList(), user + (Dogma.GAS_CLOUD_HARVESTING to 1))!!
        assertEquals(20.0, one.yieldPerCycle, 1e-9)
        assertEquals(1, one.groups.single().count)
        assertEquals(2, one.groups.single().fitted)
    }

    /** Ore on the same hull: 10 x 2 (role) x (1 + 5% x 3) x (1 + 5% x 4) = 10 x 2 x 1.15 x 1.2 = 27.6 m3 per 15 s cycle (no hull cycle bonus on ore). */
    @Test fun theUsersVentureOnOre() {
        val p = MiningCalc.profile(venture, listOf(miner to 2), emptyList(), user)!!
        assertEquals(Harvest.Ore, p.kind)
        assertEquals(15_000L, p.cycleMs)
        assertEquals(55.2, p.yieldPerCycle, 1e-9)
        assertEquals(91, p.cycles) // ceil(5000 / 55.2)
        assertEquals(91 * 15_000L, p.holdFullMs)
    }

    /**
     * A Hulk with three Strip Miner I, Mining V, Astrogeology V, Mining Barge V, Exhumers V:
     *  yield = 150 x 1.25 (Mining) x 1.25 (Astrogeology) x (1 + 3% x 5) x (1 + 6% x 5) = 150 x 1.5625 x 1.15 x 1.30 = 350.390625
     *  cycle = 45 s x (1 - 15%) x (1 - 3% x 5) = 45 x 0.85 x 0.85 = 32.5125 s
     *  hold  = 11500 -> three strips 1051.171875 per cycle -> 11 cycles
     */
    @Test fun aHulkWithStripMiners() {
        val skills = mapOf(Dogma.MINING to 5, Dogma.ASTROGEOLOGY to 5, Dogma.MINING_BARGE to 5, Dogma.EXHUMERS to 5)
        val p = MiningCalc.profile(hulk, listOf(strip to 3), emptyList(), skills)!!
        assertEquals(350.390625, p.groups.single().yieldM3, 1e-9)
        assertEquals(45_000 * 0.85 * 0.85, p.groups.single().cycleMs, 1e-6)
        assertEquals(32_512.5, p.cycleMs.toDouble(), 1.0)
        assertEquals(1051.171875, p.yieldPerCycle, 1e-6)
        assertEquals(11, p.cycles)
    }

    /** Laser upgrades stack with the penalty: two at +5% each is 1.05 x (1 + 0.05 x 0.869...) on the yield. */
    @Test fun miningLaserUpgradesStackWithAPenalty() {
        val none = MiningCalc.profile(venture, listOf(miner to 1), emptyList(), user)!!.yieldPerCycle
        val two = MiningCalc.profile(venture, listOf(miner to 1), listOf(mlu, mlu), user)!!.yieldPerCycle
        assertEquals(1.05 * (1 + 0.05 * Math.exp(-((1 / 2.67) * (1 / 2.67)))), two / none, 1e-9)
        assertEquals(1.0, MiningCalc.stacked(emptyList()), 0.0)
    }

    /** Ice: 240 s x (1 - 12.5%) x (1 - 2% x 5) x (1 - 5% x 5) for a Retriever with Ice Harvesting V and Mining Barge V. */
    @Test fun iceCycleUsesTheHullAndTheIceSkill() {
        val ice = ice
        val skills = mapOf(Dogma.ICE_HARVESTING to 5, Dogma.MINING_BARGE to 5)
        val p = MiningCalc.profile(retriever, listOf(ice to 1), emptyList(), skills)!!
        assertEquals(Harvest.Ice, p.kind)
        assertEquals(240_000 * 0.875 * 0.90 * 0.75, p.groups.single().cycleMs, 1e-6)
        // Ice has no yield skill: 1000 m3 per cycle. The Retriever's hold is 27500 x (1 + 5% x 5) = 34375, so 35 cycles.
        assertEquals(1000.0, p.yieldPerCycle, 1e-9)
        assertEquals(34_375.0, p.holdM3, 1e-9)
        assertEquals(35, p.cycles)
    }

    @Test fun theDominantKindIsTheOneThatBringsInTheMostPerMinute() {
        val p = MiningCalc.profile(venture, listOf(scoop to 1, miner to 1), emptyList(), user)!!
        // Gas 20 m3 / 25.5 s = 47.1 per minute; ore 27.6 m3 / 15 s = 110.4 per minute.
        assertEquals(Harvest.Ore, p.kind)
        assertEquals(2, p.groups.size)
    }

    @Test fun aShipWithoutAMiningHoldUsesItsCargo() {
        val barge = venture.copy(attrs = venture.attrs - 1556)
        val p = MiningCalc.profile(barge, listOf(miner to 1), emptyList(), user)!!
        assertEquals(50.0, p.holdM3, 1e-9)
        assertEquals("cargo hold", p.holdName)
    }

    @Test fun noMiningModulesMeansNoProfile() {
        assertNull(MiningCalc.profile(venture, emptyList(), emptyList(), user))
        assertNull(MiningCalc.profile(venture, listOf(DogmaType(1, "Salvager", 1, 0.0, mapOf(182 to 25863.0)) to 1), emptyList(), user))
    }

    @Test fun untrainedSkillsGiveNoBonus() {
        val p = MiningCalc.profile(venture, listOf(miner to 1), emptyList(), emptyMap())!!
        assertEquals(20.0, p.yieldPerCycle, 1e-9)
    }

    @Test fun theTextsRead() {
        assertEquals("1:38", cycleClock(98_000))
        assertEquals("14 min", holdText(14 * 60_000L))
        assertEquals("1 h 5 min", holdText(65 * 60_000L))
        assertEquals("2 h", holdText(120 * 60_000L))
        assertEquals("under a minute", holdText(20_000))
    }
}
