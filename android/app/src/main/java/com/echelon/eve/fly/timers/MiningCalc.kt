package com.echelon.eve.fly.timers

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

// The mining cycle and hold-full time from a fit and skills: pure arithmetic over EVE's own dogma numbers (ESI
// /universe/types/{id}), so a new hull or module needs no code unless it brings a bonus attribute this file does not
// know. MiningCalcTest pins it against hand-computed numbers.
//
// What it does, in EVE's order: a module's base `miningAmount` (77, m3 per cycle) and `duration` (73, ms) are changed by
//  - the hull: its role pre-multiplier on ore yield (207), then its percentage bonuses. The ones that grow with a hull
//    skill (Mining Frigate, Expedition Frigates, Mining Barge, Exhumers) are per level; the "role" ones are flat.
//    Each is a separate +x% / -x% factor, multiplied in.
//  - the skills that act on the module itself: Mining and Astrogeology +5% yield per level (attribute 434 on the skill)
//    to the modules that require them, Ice Harvesting -5% cycle per level (780).
//  - Mining Laser Upgrades (434 on the module), which are stacking-penalised like any module bonus.
// Gas Cloud Harvesting (the skill) gives no yield or cycle bonus: it only allows one harvester per level, which is
// applied as a cap on how many count. Mining IV is therefore a prerequisite for gas, not a bonus to it.
//
// Simplifications (the screen says so): crystals, boosters, implants, rigs and overheating are not applied; waste
// (miningWasteProbability) and critical hits (miningCritChance) average out and are ignored; cargo modules do not widen
// the hold; the ship sits at the rock for the whole time, so travel, targeting and unloading are not counted; the hold is
// full after the cycle that carries it past capacity.
//
// Every attribute id here was checked against ESI (https://esi.evetech.net/dogma/attributes/{id}, 2025-09-26 compatibility
// date) and every per-level hull bonus against the skill's own dogma effects (e.g. 8313/8314 for Mining Frigate: the
// bonus attribute is multiplied by the skill level).

/** A type as ESI describes it: its name, group, cargo capacity and dogma attributes (id to value). */
data class DogmaType(val id: Long, val name: String, val groupId: Long, val capacity: Double, val attrs: Map<Int, Double>) {
    fun a(id: Int): Double? = attrs[id]
    fun a(id: Int, default: Double): Double = attrs[id] ?: default
    /** The skills this type requires (requiredSkill1..3). */
    val requiredSkills: List<Long> get() = listOf(182, 183, 184).mapNotNull { attrs[it]?.toLong() }
}

/** The dogma attribute ids and skill type ids used here. */
object Dogma {
    const val DURATION = 73
    const val MINING_AMOUNT = 77
    const val CAPACITY = 38
    const val MINING_HOLD = 1556
    const val YIELD_MULTIPLIER = 207
    const val MINING_AMOUNT_BONUS = 434
    const val ICE_CYCLE_BONUS = 780

    const val MINING = 3386L
    const val ASTROGEOLOGY = 3410L
    const val GAS_CLOUD_HARVESTING = 25544L
    const val ICE_HARVESTING = 16281L
    const val MINING_FRIGATE = 32918L
    const val EXPEDITION_FRIGATES = 33856L
    const val MINING_BARGE = 17940L
    const val EXHUMERS = 22551L

    /** The skills whose own dogma the calculator reads. */
    val SKILLS = listOf(MINING, ASTROGEOLOGY, GAS_CLOUD_HARVESTING, ICE_HARVESTING, MINING_FRIGATE, EXPEDITION_FRIGATES, MINING_BARGE, EXHUMERS)

    /** A hull bonus attribute: the percentage in [id] applies to [target], times the level of [skill] (null: a flat role bonus). */
    data class Bonus(val id: Int, val target: Target, val skill: Long?)

    enum class Target { OreYield, OreCycle, GasYield, GasCycle, IceCycle, Hold }

    val HULL_BONUSES = listOf(
        // Ore yield
        Bonus(1842, Target.OreYield, MINING_FRIGATE), Bonus(3191, Target.OreYield, EXPEDITION_FRIGATES), Bonus(3181, Target.OreYield, MINING_BARGE),
        Bonus(3197, Target.OreYield, EXHUMERS), Bonus(3177, Target.OreYield, null),
        // Ore cycle
        Bonus(3230, Target.OreCycle, null), Bonus(3193, Target.OreCycle, EXHUMERS),
        // Gas yield (the Venture and Prospect's role bonus) and cycle
        Bonus(3239, Target.GasYield, null),
        Bonus(3237, Target.GasCycle, MINING_FRIGATE), Bonus(3183, Target.GasCycle, MINING_BARGE), Bonus(3226, Target.GasCycle, EXHUMERS), Bonus(3225, Target.GasCycle, null),
        // Ice cycle
        Bonus(3240, Target.IceCycle, MINING_FRIGATE), Bonus(3167, Target.IceCycle, EXPEDITION_FRIGATES), Bonus(3182, Target.IceCycle, MINING_BARGE),
        Bonus(3194, Target.IceCycle, EXHUMERS), Bonus(3178, Target.IceCycle, null),
        // Hold size
        Bonus(3187, Target.Hold, MINING_BARGE), Bonus(3198, Target.Hold, EXHUMERS),
    )
}

enum class Harvest(val label: String) { Ore("Ore"), Gas("Gas"), Ice("Ice") }

/** One kind of mining module in the fit: [count] of them active, each cycling every [cycleMs] for [yieldM3] m3. */
data class MiningGroup(val kind: Harvest, val typeId: Long, val name: String, val count: Int, val fitted: Int, val cycleMs: Double, val yieldM3: Double) {
    /** m3 per minute of the whole group. */
    val perMinute: Double get() = if (cycleMs <= 0) 0.0 else count * yieldM3 * 60_000.0 / cycleMs
}

/** The result for one ship: what to time, and for how long. */
data class MiningProfile(
    val shipName: String,
    val groups: List<MiningGroup>,
    val kind: Harvest,
    /** The cycle to time, ms (the dominant group's; the shortest when its modules differ). */
    val cycleMs: Long,
    /** m3 per cycle of all the dominant kind's modules together. */
    val yieldPerCycle: Double,
    val perMinute: Double,
    val holdM3: Double,
    /** From an empty hold to a full one, ms. */
    val holdFullMs: Long,
    val holdName: String,
) {
    /** "2× Gas Cloud Scoop I" */
    val summary: String get() = groups.filter { it.kind == kind }.joinToString(" + ") { "${it.count}× ${it.name}" }
    val cycles: Int get() = if (yieldPerCycle <= 0) 0 else ceil(holdM3 / yieldPerCycle).toInt()
}

object MiningCalc {
    /**
     * The profile of [ship] with [modules] (type and how many are fitted in high slots) and [upgrades] (Mining Laser
     * Upgrades in low slots), for a pilot with [skills] (skill id to level). [skillTypes] carries the skills' own dogma (the
     * 5% per level); null for a skill takes EVE's 5. Null when no mining module is fitted.
     */
    fun profile(ship: DogmaType, modules: List<Pair<DogmaType, Int>>, upgrades: List<DogmaType>, skills: Map<Long, Int>, skillTypes: Map<Long, DogmaType> = emptyMap()): MiningProfile? {
        fun level(skill: Long) = (skills[skill] ?: 0).coerceIn(0, 5)
        fun skillPct(skill: Long, attr: Int, default: Double) = skillTypes[skill]?.a(attr) ?: default

        // Hull factors: one (1 + x/100) for each bonus the hull has, x scaled by the skill level for per-level ones.
        fun hull(target: Dogma.Target): Double = Dogma.HULL_BONUSES.filter { it.target == target }.fold(1.0) { acc, b ->
            val v = ship.a(b.id) ?: return@fold acc
            acc * (1 + v * (b.skill?.let(::level) ?: 1) / 100.0)
        }
        val roleMultiplier = ship.a(Dogma.YIELD_MULTIPLIER, 1.0)
        val upgradeFactor = stacked(upgrades.mapNotNull { it.a(Dogma.MINING_AMOUNT_BONUS) })

        val groups = modules.mapNotNull { (m, qty) ->
            val base = m.a(Dogma.MINING_AMOUNT) ?: return@mapNotNull null
            val dur = m.a(Dogma.DURATION) ?: return@mapNotNull null
            val needs = m.requiredSkills
            val kind = when {
                Dogma.GAS_CLOUD_HARVESTING in needs -> Harvest.Gas
                Dogma.ICE_HARVESTING in needs -> Harvest.Ice
                Dogma.MINING in needs -> Harvest.Ore
                else -> return@mapNotNull null
            }
            var yieldM3 = base; var cycle = dur
            when (kind) {
                Harvest.Ore -> {
                    yieldM3 *= roleMultiplier * hull(Dogma.Target.OreYield) * upgradeFactor
                    yieldM3 *= 1 + skillPct(Dogma.MINING, Dogma.MINING_AMOUNT_BONUS, 5.0) * level(Dogma.MINING) / 100.0
                    if (Dogma.ASTROGEOLOGY in needs) yieldM3 *= 1 + skillPct(Dogma.ASTROGEOLOGY, Dogma.MINING_AMOUNT_BONUS, 5.0) * level(Dogma.ASTROGEOLOGY) / 100.0
                    cycle *= hull(Dogma.Target.OreCycle)
                }
                Harvest.Gas -> { yieldM3 *= hull(Dogma.Target.GasYield); cycle *= hull(Dogma.Target.GasCycle) }
                Harvest.Ice -> {
                    cycle *= hull(Dogma.Target.IceCycle) * (1 + skillPct(Dogma.ICE_HARVESTING, Dogma.ICE_CYCLE_BONUS, -5.0) * level(Dogma.ICE_HARVESTING) / 100.0)
                }
            }
            // One gas harvester may run per level of Gas Cloud Harvesting.
            val active = if (kind == Harvest.Gas) min(qty, level(Dogma.GAS_CLOUD_HARVESTING)) else qty
            MiningGroup(kind, m.id, m.name, active, qty, cycle, yieldM3)
        }.filter { it.count > 0 }.groupBy { Triple(it.kind, it.typeId, 0) }.values.map { g -> g.first().let { it.copy(count = g.sumOf { x -> x.count }, fitted = g.sumOf { x -> x.fitted }) } }
        if (groups.isEmpty()) return null

        // What to time: the kind that brings in the most per minute.
        val kind = groups.groupBy { it.kind }.maxByOrNull { (_, g) -> g.sumOf { it.perMinute } }!!.key
        val main = groups.filter { it.kind == kind }
        val cycle = main.minOf { it.cycleMs }
        val perCycle = main.sumOf { it.count * it.yieldM3 * cycle / it.cycleMs }
        val perMinute = main.sumOf { it.perMinute }
        val hold = ship.a(Dogma.MINING_HOLD)?.takeIf { it > 0 }?.let { it * hull(Dogma.Target.Hold) } ?: ship.capacity
        val holdName = if (ship.a(Dogma.MINING_HOLD)?.let { it > 0 } == true) "mining hold" else "cargo hold"
        val cycles = if (perCycle <= 0) 0.0 else ceil(hold / perCycle)
        return MiningProfile(ship.name, groups, kind, cycle.roundToLong(), perCycle, perMinute, hold, (cycles * cycle).roundToLong(), holdName)
    }

    /** Stacking-penalised multiplier for percentage bonuses (best first: 1, 0.87, 0.57, 0.28, 0.105 ...). */
    fun stacked(percents: List<Double>): Double = percents.sortedDescending().withIndex().fold(1.0) { acc, (i, p) -> acc * (1 + p / 100.0 * exp(-((i / 2.67) * (i / 2.67)))) }
}

/** "Cycle 1:38 · hold full in 14 min" (cycle in whole seconds, the hold in minutes or hours and minutes). */
fun miningLine(p: MiningProfile): String = "Cycle ${cycleClock(p.cycleMs)} · hold full in ${holdText(p.holdFullMs)}"

fun cycleClock(ms: Long): String {
    val s = max(0L, (ms / 1000.0).roundToLong())
    return "%d:%02d".format(s / 60, s % 60)
}

fun holdText(ms: Long): String {
    val m = (ms / 60_000.0).roundToLong()
    return when { m < 1 -> "under a minute"; m < 60 -> "$m min"; m % 60 == 0L -> "${m / 60} h"; else -> "${m / 60} h ${m % 60} min" }
}
