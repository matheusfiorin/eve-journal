package com.echelon.eve.fly.timers

import com.echelon.eve.core.model.MarketData
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.WingTimer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// The live gas estimate: what a wormhole gas operation (one Sleeper or gas timer) has put in the hold so far, in units and ISK.
// Pure arithmetic over what the app already knows: the flying pilot's harvesting rate (MiningCalc: each module's cycle and m3 per
// cycle), the gas's unit volume (ESI /universe/types volume, through the dogma cache), the prices (Jita best buy from the market data
// when the item is there, else ESI's average price, as the corp assets are valued) and the timer's clock. GasOpsTest pins it.
//
// The estimate counts only completed cycles (a module delivers at the end of a cycle, so a half-done cycle is worth nothing yet) from
// the moment the timer started, and stops growing when the timer ends, is paused, or the hold is full. It is an estimate: the real
// yield depends on the cloud's remaining volume, so SessionReporter's mining-ledger units confirm it but never replace it.

/**
 * The Fullerite gases of wormhole sites, with the unit volume ESI gives each (/universe/types/{id}, read 23 Nov 2026: group 711,
 * volume and packaged volume equal). The volume here is only the fallback until the dogma cache has ESI's own number.
 */
enum class Fullerite(val typeId: Long, val title: String, val volume: Double) {
    C28(30375, "Fullerite-C28", 2.0),
    C32(30376, "Fullerite-C32", 5.0),
    C50(30370, "Fullerite-C50", 1.0),
    C60(30371, "Fullerite-C60", 1.0),
    C70(30372, "Fullerite-C70", 1.0),
    C72(30373, "Fullerite-C72", 2.0),
    C84(30374, "Fullerite-C84", 2.0),
    C320(30377, "Fullerite-C320", 5.0),
    C540(30378, "Fullerite-C540", 10.0);

    /** "C320": the name without the family, for tight places. */
    val short: String get() = title.removePrefix("Fullerite-")

    companion object {
        val ids: List<Long> get() = entries.map { it.typeId }
        fun of(typeId: Long?): Fullerite? = entries.firstOrNull { it.typeId == typeId }
    }
}

/** One kind of harvesting module group in the fit: [count] modules, each delivering [m3PerCycle] every [cycleMs]. */
data class GasModule(val count: Int, val cycleMs: Long, val m3PerCycle: Double)

/**
 * The flying pilot's gas harvesting rate: the gas modules of their current fit and the hold they fill. Built from a [MiningProfile]
 * (so from the fit and skills), summed over modules whatever their cycle times.
 */
data class GasRate(val modules: List<GasModule>, val holdM3: Double) {
    /** Cycles of [module] completed after [activeMs] of harvesting. */
    private fun cycles(m: GasModule, activeMs: Long): Long = if (m.cycleMs <= 0) 0 else max(0, activeMs) / m.cycleMs

    /** The volume harvested after [activeMs], before the hold's limit: completed cycles only. */
    fun m3At(activeMs: Long): Double = modules.sumOf { cycles(it, activeMs) * it.count * it.m3PerCycle }

    /** The shortest cycle: the "batch" size the counter ticks in. */
    val cycleMs: Long get() = modules.minOfOrNull { it.cycleMs } ?: 0

    /** m3 a minute of the whole fit. */
    val perMinute: Double get() = modules.sumOf { if (it.cycleMs <= 0) 0.0 else it.count * it.m3PerCycle * 60_000.0 / it.cycleMs }

    /** The harvesting time at which the hold is full (the cycle that carries it to capacity), or null when it never fills. */
    val holdFullAfterMs: Long? by lazy {
        if (holdM3 <= 0 || perMinute <= 0) return@lazy null
        // m3At is a monotone step function: bisect on time, from a bound a full rate-time plus one slowest cycle away.
        var lo = 0L; var hi = (holdM3 / perMinute * 60_000.0).toLong() + (modules.maxOfOrNull { it.cycleMs } ?: 0) + 1
        while (m3At(hi) < holdM3) hi *= 2
        while (lo < hi) { val mid = (lo + hi) / 2; if (m3At(mid) >= holdM3) hi = mid else lo = mid + 1 }
        lo
    }

    companion object {
        /** The gas modules of [p] (the gas groups of its fit); null when the fit has no gas harvester. */
        fun of(p: MiningProfile?): GasRate? {
            val mods = p?.groups.orEmpty().filter { it.kind == Harvest.Gas && it.count > 0 && it.cycleMs > 0 && it.yieldM3 > 0 }
                .map { GasModule(it.count, it.cycleMs.toLong().coerceAtLeast(1), it.yieldM3) }
            return if (mods.isEmpty() || p == null) null else GasRate(mods, p.holdM3)
        }
    }
}

/** Where a price came from: shown next to the value so the pilot knows how far to trust it. */
enum class PriceSource(val label: String) { JitaBuy("Jita best buy"), EsiAverage("ESI average") }

data class GasPrice(val perUnit: Double, val source: PriceSource)

/** Prices by type: the Jita best buy from the app's market data, and ESI's average price for everything else. */
data class GasPrices(val jitaBuy: Map<Long, Double> = emptyMap(), val average: Map<Long, Double> = emptyMap()) {
    /** Jita's best buy when the market data has one, else ESI's average; null when neither knows the type. */
    fun of(typeId: Long): GasPrice? = jitaBuy[typeId]?.takeIf { it > 0 }?.let { GasPrice(it, PriceSource.JitaBuy) }
        ?: average[typeId]?.takeIf { it > 0 }?.let { GasPrice(it, PriceSource.EsiAverage) }
}

object GasMarket {
    /** The Forge and Jita IV - Moon 4 - Caldari Navy Assembly Plant, where "Jita" prices are read. */
    const val FORGE = 10000002L
    const val JITA_STATION = 60003760L

    /**
     * The best (highest) buy order at Jita's main station for each of [types], from the market snapshot's The Forge region
     * (data.types[id].b = [[station, price, volume], …]); a type with no buy order there is left out.
     */
    fun jitaBestBuy(data: MarketData?, types: Collection<Long>): Map<Long, Double> {
        val region = data?.snapshot?.regions?.firstOrNull { it.region == FORGE }?.data?.get("types") as? JsonObject ?: return emptyMap()
        return types.mapNotNull { id ->
            val buys = (region[id.toString()] as? JsonObject)?.get("b") as? JsonArray ?: return@mapNotNull null
            val best = buys.mapNotNull { row ->
                val r = row as? JsonArray ?: return@mapNotNull null
                if (num(r.getOrNull(0))?.toLong() != JITA_STATION) null else num(r.getOrNull(1))
            }.maxOrNull()
            best?.takeIf { it > 0 }?.let { id to it }
        }.toMap()
    }

    fun prices(data: MarketData?, average: Map<Long, Double>, types: Collection<Long> = Fullerite.ids) = GasPrices(jitaBestBuy(data, types), average)

    private fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.doubleOrNull
}

/** What the estimate needs from the app: the harvesting rate, the gases' unit volumes (ESI's, by type) and the prices. */
data class GasInputs(val rate: GasRate? = null, val volumes: Map<Long, Double> = emptyMap(), val prices: GasPrices = GasPrices()) {
    /** ESI's unit volume of [gas] when the types cache has it, else the verified table's. */
    fun unitVolume(gas: Fullerite): Double = volumes[gas.typeId]?.takeIf { it > 0 } ?: gas.volume
}

/** What an operation has put in the hold at one moment. */
data class GasEstimate(
    val gas: Fullerite,
    /** Harvesting time so far (the timer's running time, never past its end). */
    val activeMs: Long,
    /** Cycle batches completed (of the shortest cycle). */
    val batches: Long,
    val m3: Double,
    val units: Long,
    val value: Long,
    /** The price used (null: no price known, so the value is 0). */
    val price: GasPrice?,
    val unitVolume: Double,
    val holdM3: Double,
    /** Hold capacity reached: the estimate stops here. */
    val holdFull: Boolean,
    /** Time until the hold is full (null: full already, or the timer ends first and so does the harvest). */
    val holdFullInMs: Long?,
    /** Time until the timer's end (Sleepers); null when paused or done. */
    val timerEndInMs: Long?,
    /** Units a cycle batch adds, for the "+N" pop. */
    val unitsPerBatch: Long,
) {
    /** How full the hold is, 0 to 1. */
    val fill: Float get() = if (holdM3 <= 0) 0f else (m3 / holdM3).toFloat().coerceIn(0f, 1f)
    /** Which comes first from now: the hold filling or the timer's end, and in how long (null: neither is ahead). */
    val next: Pair<Boolean, Long>? get() = when {
        holdFullInMs != null && (timerEndInMs == null || holdFullInMs <= timerEndInMs) -> true to holdFullInMs
        timerEndInMs != null -> false to timerEndInMs
        else -> null
    }
}

object GasOps {
    /**
     * Time the timer has actually run: from its start to now, to its pause, or to its end, whichever is first. A resume moves the
     * start forward by the time spent paused (Timers.kt resumed), so a pause never counts.
     */
    fun activeMs(t: WingTimer, now: Long): Long = ((t.pausedAt ?: min(now, t.endsAt)) - t.startedAt).coerceIn(0, t.durationMs)

    /** The estimate for [t] at [now]; null when the timer has no gas, or the fit has no harvesting rate. */
    fun estimate(t: WingTimer, inputs: GasInputs, now: Long): GasEstimate? {
        val running = t.pausedAt == null && !t.done(now)
        val e = estimate(t.gas ?: return null, activeMs(t, now), inputs, if (running) t.remaining(now) else null)
        // A timer that is not counting fills no hold: there is no "hold full in".
        return if (running) e else e?.copy(holdFullInMs = null)
    }

    /** The estimate after [activeMs] of harvesting [gas]; [timerLeftMs] is how long until the Sleepers (null: not running). */
    fun estimate(gas: Fullerite, activeMs: Long, inputs: GasInputs, timerLeftMs: Long? = null): GasEstimate? {
        val rate = inputs.rate ?: return null
        val volume = inputs.unitVolume(gas)
        val raw = rate.m3At(activeMs)
        val full = rate.holdFullAfterMs
        val holdFull = rate.holdM3 > 0 && raw >= rate.holdM3
        val m3 = if (rate.holdM3 > 0) min(raw, rate.holdM3) else raw
        val units = floor(m3 / volume + 1e-9).toLong()
        val price = inputs.prices.of(gas.typeId)
        val value = if (price == null) 0 else Math.round(units * price.perUnit)
        val untilFull = if (holdFull || full == null) null else (full - activeMs).coerceAtLeast(0)
        val perBatch = floor(rate.modules.filter { it.cycleMs == rate.cycleMs }.sumOf { it.count * it.m3PerCycle } / volume + 1e-9).toLong()
        return GasEstimate(gas, activeMs, if (rate.cycleMs > 0) activeMs / rate.cycleMs else 0, m3, units, value, price, volume, rate.holdM3, holdFull, untilFull, timerLeftMs, perBatch)
    }

    /**
     * The operation that goes to the room for [t]: id = the timer's id. [now] decides whether it ended: a finished timer ends at its
     * own end; [stoppedAt] (the timer was removed) ends it there. Without an estimate (no fit yet) it reports zeros, so the site still lists.
     */
    fun op(t: WingTimer, pilot: Long, e: GasEstimate?, now: Long, stoppedAt: Long? = null): GasOp = GasOp(
        id = t.id, by = pilot, timer = t.id, gas = (t.gas ?: e?.gas ?: Fullerite.C320).typeId, startedAt = t.startedAt,
        endedAt = stoppedAt ?: t.endsAt.takeIf { t.done(now) },
        units = e?.units ?: 0, m3 = Math.round((e?.m3 ?: 0.0) * 100) / 100.0, value = e?.value ?: 0,
    )

    // ---- reporting to the room ----

    /** The least time between two reports of one operation: the room hears of an op at most this often (and at its end). */
    const val REPORT_EVERY_MS = 30_000L

    /** What was last sent for an operation. */
    data class Reported(val at: Long, val units: Long, val endedAt: Long?)

    /**
     * Whether to send [op] now: the first time, when it ended, and otherwise when a cycle batch has completed since the last report
     * (the units moved) and at least [REPORT_EVERY_MS] went by. Nothing is sent when nothing changed.
     */
    fun shouldReport(last: Reported?, op: GasOp, now: Long): Boolean = when {
        last == null -> true
        op.endedAt != null && last.endedAt == null -> true
        op.endedAt != null -> false
        op.units == last.units -> false
        else -> now - last.at >= REPORT_EVERY_MS
    }

    // ---- reconciliation with the mining ledger ----

    /** One day of the mining ledger as ESI gives it: [day] is "2026-11-23" (UTC), [quantity] units of [typeId]. */
    data class LedgerRow(val typeId: Long, val day: String, val quantity: Long)

    fun ledgerRows(mining: JsonElement?): List<LedgerRow> = (mining as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        val type = (o["type_id"] as? JsonPrimitive)?.longOrNull ?: return@mapNotNull null
        val day = (o["date"] as? JsonPrimitive)?.content?.take(10) ?: return@mapNotNull null
        val q = (o["quantity"] as? JsonPrimitive)?.longOrNull ?: return@mapNotNull null
        LedgerRow(type, day, q)
    }

    /**
     * The units of [op]'s gas the mining ledger reports for the days the operation covered (the ledger is a day total per type,
     * not a time stamp), or null when it reports none. Two operations of one gas on the same day share the day's number: the ledger
     * cannot tell them apart, so it only ever confirms the estimate, it is never added to it.
     */
    fun confirmedUnits(rows: List<LedgerRow>, op: GasOp, now: Long): Long? {
        val from = day(op.startedAt); val to = day(op.endedAt ?: now)
        return rows.filter { it.typeId == op.gas && it.day >= from && it.day <= to }.sumOf { it.quantity }.takeIf { it > 0 }
    }

    private fun day(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()
}

/** The gas a timer harvests (a Sleeper or gas timer's site), kept in its meta so the wingmate's phone knows it too. */
val WingTimer.gas: Fullerite? get() = Fullerite.of((meta[TimerMeta.GAS] as? JsonPrimitive)?.longOrNull)

fun WingTimer.withGas(gas: Fullerite?): WingTimer = copy(meta = JsonObject(if (gas == null) meta - TimerMeta.GAS else meta + (TimerMeta.GAS to JsonPrimitive(gas.typeId))))

/** Whether this kind of timer is a gas operation: the Sleeper timer of wormhole gas and known space's gas timer. */
val TimerKind.isGas: Boolean get() = this == TimerKind.Sleeper || this == TimerKind.Gas
