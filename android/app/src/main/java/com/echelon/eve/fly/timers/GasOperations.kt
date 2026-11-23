package com.echelon.eve.fly.timers

import com.echelon.eve.AppContainer
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.corp.corp
import com.echelon.eve.fly.fly
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the room's operations in step with the flying pilot's gas timers. While a session runs, a Sleeper or gas timer started
 * after it began is an operation (op id = timer id): it is created at once, updated at most every [GasOps.REPORT_EVERY_MS] while its
 * estimate moves, and finished when the timer ends or is removed (stopped). Pure of Android: the callbacks are what the app wires,
 * and GasOpSyncTest drives it with a clock.
 */
class OpSync(
    private val pilot: () -> Pilot?,
    private val session: () -> WingSession?,
    private val timers: () -> Collection<WingTimer>,
    private val inputs: () -> GasInputs,
    private val report: (Pilot, GasOp) -> Unit,
) {
    private val reported = HashMap<String, GasOps.Reported>()
    /** The last operation seen per timer id, so a removed timer can still be finished with what it had. */
    private val seen = HashMap<String, GasOp>()
    private var forSession: String? = null

    fun tick(now: Long) {
        val s = session(); val me = pilot()
        if (s == null || me == null || !s.active) { reported.clear(); seen.clear(); forSession = null; return }
        if (forSession != s.id) { reported.clear(); seen.clear(); forSession = s.id }
        val mine = timers().filter { it.owner == me.id && TimerKind.of(it.kind).isGas && it.startedAt >= s.startedAt }.associateBy { it.id }
        val ins = inputs()
        for (t in mine.values) {
            val op = GasOps.op(t, me.id, GasOps.estimate(t, ins, now), now)
            seen[t.id] = op
            if (GasOps.shouldReport(reported[t.id], op, now)) { report(me, op); reported[t.id] = GasOps.Reported(now, op.units, op.endedAt) }
        }
        // A timer taken off the board ends its operation where it stood.
        for (id in seen.keys.filter { it !in mine }) {
            val last = seen.remove(id) ?: continue
            if (last.endedAt == null) { report(me, last.copy(endedAt = now)); reported[id] = GasOps.Reported(now, last.units, now) }
        }
    }
}

/**
 * The gas operations of the app: the live estimate's inputs (the pilot's rate, the gases' ESI volumes, the prices) kept up to date,
 * the sync of the pilot's operations to the wing room, and the mining ledger's confirmation. One per container ([fly]).
 */
class GasOperations(private val c: AppContainer) {
    private val _inputs = MutableStateFlow(GasInputs())
    /** What the estimate is worked out from; screens collect it and call [GasOps.estimate] with their clock. */
    val inputs: StateFlow<GasInputs> = _inputs.asStateFlow()
    private val _ledger = MutableStateFlow<List<GasOps.LedgerRow>>(emptyList())
    /** The flying pilot's mining ledger rows (their private snapshot), to confirm an operation's units. */
    val ledger: StateFlow<List<GasOps.LedgerRow>> = _ledger.asStateFlow()
    private var started = false

    private val sync = OpSync({ c.selectedPilot.value }, { c.wingChannel.session.value }, { c.fly.timers.timers.value.values }, { _inputs.value },
        { p, op -> c.wingChannel.reportOp(p, op) })

    /** Runs once from the app start: refreshes the inputs when the pilot, their fit or the market change, and ticks the sync. */
    fun start() {
        if (started) return
        started = true
        c.scope.launch {
            // The ledger rows follow the synced snapshot of the flying pilot.
            combine(c.pilots.pilots, c.selectedPilot) { list, p -> list.firstOrNull { it.pilot == p }?.private?.op("mining")?.value }.map { GasOps.ledgerRows(it) }.collect { _ledger.value = it }
        }
        c.scope.launch {
            combine(c.market.state, c.corp.prices, c.fly.mining.state, c.selectedPilot) { m, avg, mining, p -> Triple(GasMarket.prices(m.data, avg), p?.let { mining[it]?.profile }, p) }
                .collect { (prices, profile, _) -> _inputs.value = _inputs.value.copy(rate = GasRate.of(profile), prices = prices) }
        }
        c.scope.launch {
            while (true) {
                runCatching { work() }
                delay(TICK_MS)
            }
        }
    }

    private suspend fun work() {
        val me = c.selectedPilot.value ?: return
        val gasTimers = c.fly.timers.timers.value.values.filter { it.owner == me.id && TimerKind.of(it.kind).isGas }
        if (gasTimers.isNotEmpty()) {
            // The estimate needs the fit's rate, the gases' volumes and the average prices once something is counting.
            if (c.fly.mining.state.value[me] == null) c.fly.mining.load(me)
            val types = c.fly.mining.types.getAll(Fullerite.ids)
            _inputs.value = _inputs.value.copy(volumes = types.mapValues { it.value.volume })
            runCatching { c.corp.refreshPrices() }
        }
        // Also with no gas timer left: a timer taken off the board finishes its operation here.
        sync.tick(System.currentTimeMillis())
    }

    companion object { const val TICK_MS = 5_000L }
}

/** The container's gas operations; started with the app (EchelonApp via WingServices). */
val AppContainer.gas: GasOperations get() = fly.gasOps
