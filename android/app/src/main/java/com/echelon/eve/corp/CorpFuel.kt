package com.echelon.eve.corp

import kotlin.math.ceil

// The numbers behind the Corp console: what counts as healthy, low or reinforced (the same lines the Worker's Discord
// alerts and the local alerts use) and how much fuel a refuel takes. Pure, so the alerts, the overview and the planner
// can't disagree and tests can pin them.

object Thresholds {
    /** A tower under this many hours of fuel is low (worker/corp.js POS_FUEL_ALERT_H). */
    const val TOWER_HOURS = 24.0
    /** A structure under this many days of fuel is low (STRUCTURE_FUEL_ALERT_D). */
    const val STRUCTURE_DAYS = 3.0
    /** A tower's fuel gauge is full at this many hours (30 days); a structure's at this many days. */
    const val TOWER_GAUGE_HOURS = 720.0
    const val STRUCTURE_GAUGE_DAYS = 30.0
}

enum class Health { Ok, Low, Reinforced }

private val REINFORCED_STRUCTURE = setOf("armor_reinforce", "hull_reinforce")

fun Structure.isReinforced() = state in REINFORCED_STRUCTURE
fun Starbase.isReinforced() = state == "reinforced"

/** A tower below a day of fuel while it burns (an offline tower keeps what it has). */
fun Starbase.isLowFuel() = state == "online" && (fuelHoursLeft ?: Double.MAX_VALUE) < Thresholds.TOWER_HOURS
/** A structure below three days of fuel (a missing expiry is unknown, not low). */
fun Structure.isLowFuel() = (fuelDaysLeft ?: Double.MAX_VALUE) < Thresholds.STRUCTURE_DAYS

fun Starbase.health() = when { isReinforced() -> Health.Reinforced; isLowFuel() -> Health.Low; else -> Health.Ok }
fun Structure.health() = when { isReinforced() -> Health.Reinforced; isLowFuel() || state == "low_power" -> Health.Low; else -> Health.Ok }

/** How many of a kind are in each state. */
data class HealthCount(val ok: Int = 0, val low: Int = 0, val reinforced: Int = 0) {
    val total get() = ok + low + reinforced
    fun of(h: Health) = when (h) { Health.Ok -> ok; Health.Low -> low; Health.Reinforced -> reinforced }
}
fun Iterable<Health>.tally() = HealthCount(count { it == Health.Ok }, count { it == Health.Low }, count { it == Health.Reinforced })

// ── Refuel ──

/** Fuel blocks are 5 m³ each. */
const val BLOCK_VOLUME_M3 = 5.0

/** The four fuel blocks: a tower burns the one of its race, a structure takes any. */
enum class FuelBlock(val typeName: String) { Nitrogen("Nitrogen Fuel Block"), Hydrogen("Hydrogen Fuel Block"), Helium("Helium Fuel Block"), Oxygen("Oxygen Fuel Block") }

/** Blocks per hour of a tower by size (EVE University, "POS Setup"; the Worker's TOWER_HOURLY). */
fun towerBurn(size: String) = when (size) { "small" -> 10; "medium" -> 20; else -> 40 }

/**
 * The block a tower burns, from its type's name: Amarr (and Blood Raider, Sansha) use Helium, Caldari (Guristas)
 * Nitrogen, Gallente (Serpentis) Hydrogen, Minmatar (Angel, Domination) Oxygen. Null when the name says no race.
 */
fun towerBlock(typeName: String?): FuelBlock? {
    val n = typeName?.lowercase() ?: return null
    return when {
        "amarr" in n || "blood" in n || "sansha" in n -> FuelBlock.Helium
        "caldari" in n || "guristas" in n -> FuelBlock.Nitrogen
        "gallente" in n || "serpentis" in n -> FuelBlock.Hydrogen
        "minmatar" in n || "angel" in n || "domination" in n -> FuelBlock.Oxygen
        else -> null
    }
}

/**
 * Blocks per hour an Upwell structure's online service burns (the structure itself burns none). Rates are the
 * in-game service modules'; a service not listed counts for [DEFAULT_SERVICE_BURN], so the plan errs towards more fuel.
 */
fun serviceBurn(name: String): Int {
    val n = name.lowercase()
    return when {
        "market" in n -> 40
        "supercapital" in n -> 36
        "capital" in n -> 24
        "jump" in n && "gate" in n -> 120
        "manufacturing" in n -> 12
        "research" in n -> 12
        "reprocessing" in n -> 10
        "reactor" in n || "reaction" in n -> 15
        "clone" in n -> 8
        "moon" in n && "drill" in n -> 5
        "cyno" in n -> 24
        else -> DEFAULT_SERVICE_BURN
    }
}
const val DEFAULT_SERVICE_BURN = 10

/** Blocks per hour a structure burns now: its online services; none with no service online. */
fun structureBurn(s: Structure): Int = s.services.filter { it.state == "online" }.sumOf { serviceBurn(it.name) }

/** One tower or structure in a refuel plan. [toAdd] tops it up to the chosen days from what is in the bay now. */
data class RefuelLine(
    val id: Long, val tower: Boolean, val label: String, val burnPerHour: Int, val hoursLeft: Double?, val block: FuelBlock?, val blockName: String,
    val toAdd: Long, val raceUnknown: Boolean = false,
) {
    val volume get() = toAdd * BLOCK_VOLUME_M3
    /** Blocks for the whole stretch, whatever is in the bay. */
    fun total(days: Int) = ceil(burnPerHour * 24.0 * days).toLong()
}

data class RefuelPlan(val days: Int, val lines: List<RefuelLine>) {
    val totalBlocks get() = lines.sumOf { it.toAdd }
    val totalVolume get() = totalBlocks * BLOCK_VOLUME_M3
    /** Blocks to buy by block name, biggest first. */
    val shopping: List<Pair<String, Long>> get() = lines.filter { it.toAdd > 0 }.groupBy({ it.blockName }, { it.toAdd }).map { (n, q) -> n to q.sum() }.sortedByDescending { it.second }
}

/**
 * What it takes to run every tower and structure for [days] more days. A tower's bay is known (hours left from its
 * blocks); a structure's from its fuel expiry. A line needs only the top-up, so a tower with 12 days left plans 2
 * days more for 14. [typeName] names a type; [structureBlock] is the block structures are bought as.
 */
fun refuelPlan(snap: CorpSnapshot, days: Int, typeName: (Long) -> String?, structureBlock: FuelBlock = FuelBlock.Helium): RefuelPlan {
    val towers = snap.starbases.value.orEmpty().map { t ->
        val burn = if (t.state == "online" || t.state == "reinforced") towerBurn(t.size) else 0
        val block = towerBlock(typeName(t.type))
        val left = t.fuelHoursLeft ?: if (burn > 0) t.fuelBlocks.toDouble() / burn else null
        val need = if (burn == 0) 0L else ceil((days * 24.0 - (left ?: 0.0)).coerceAtLeast(0.0) * burn).toLong()
        RefuelLine(t.id, true, typeName(t.type) ?: "Tower ${t.id}", burn, left, block, (block ?: FuelBlock.Helium).typeName, need, raceUnknown = block == null)
    }
    val structures = snap.structures.value.orEmpty().map { s ->
        val burn = structureBurn(s)
        val left = s.fuelDaysLeft?.let { it * 24.0 }
        val need = if (burn == 0) 0L else ceil((days * 24.0 - (left ?: 0.0)).coerceAtLeast(0.0) * burn).toLong()
        RefuelLine(s.id, false, s.name ?: typeName(s.type) ?: "Structure ${s.id}", burn, left, null, structureBlock.typeName, need)
    }
    return RefuelPlan(days, towers.sortedBy { it.hoursLeft ?: Double.MAX_VALUE } + structures.sortedBy { it.hoursLeft ?: Double.MAX_VALUE })
}

/** EVE's multibuy format: one "name quantity" per line, for the market's Multibuy window. */
fun multibuy(plan: RefuelPlan): String = plan.shopping.joinToString("\n") { (name, qty) -> "$name $qty" }
