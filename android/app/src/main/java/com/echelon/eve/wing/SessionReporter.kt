package com.echelon.eve.wing

import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** What this phone knows of a pilot's own wallet and mining ledger (their private snapshot; refreshed every ~10 minutes). */
data class Ledger(val wallet: Double? = null, val units: Long? = null) {
    companion object {
        /** The ESI wallet balance (a number) and the mining ledger (entries with a quantity) as the Worker keeps them. */
        fun of(wallet: JsonElement?, mining: JsonElement?) = Ledger(
            (wallet as? JsonPrimitive)?.doubleOrNull,
            (mining as? JsonArray)?.sumOf { ((it as? JsonObject)?.get("quantity") as? JsonPrimitive)?.longOrNull ?: 0L },
        )
    }
}

/**
 * Reports the flying pilot's part in the running session: the wallet change and the units mined since the session
 * started on this phone (the first time it saw the session, it notes where the pilot stood). Timers and systems are
 * counted by the room itself. A report goes out only when a number changed.
 */
class SessionReporter(
    private val scope: CoroutineScope,
    private val channel: WingChannel,
    private val settings: WingSettings,
    private val pilot: StateFlow<Pilot?>,
    private val ledger: Flow<(Pilot) -> Ledger>,
) {
    private var sent: Triple<String, Long?, Long?>? = null
    private data class Report(val session: WingSession?, val pilot: Pilot?, val ledger: Ledger?, val connected: Boolean)

    fun start(): Job = scope.launch {
        combine(channel.session, pilot, ledger, channel.status) { s, p, l, st -> Report(s, p, p?.let(l), st == WingChannel.Status.Connected) }.distinctUntilChanged().collect { (s, p, l, connected) ->
            if (s == null || p == null || l == null || !connected) return@collect
            val (isk, units) = contribution(settings, s, p, l) ?: return@collect
            val key = Triple("${s.id}:${p.id}", isk, units)
            if (key == sent) return@collect
            // Nothing new against what the room already has.
            val known = s.of(p.id)
            if ((isk == null || isk == known.isk) && (units == null || units == known.units)) { sent = key; return@collect }
            channel.reportContribution(p, isk, units); sent = key
        }
    }

    companion object {
        /** The pilot's ISK and units in [session] measured from their baseline (noted now if this is the first look). */
        fun contribution(settings: WingSettings, session: WingSession, p: Pilot, now: Ledger): Pair<Long?, Long?>? {
            if (now.wallet == null && now.units == null) return null
            val key = "${session.id}:${p.id}"
            val base = settings.baseline(key) ?: Baseline(now.wallet, now.units).also { settings.setBaseline(key, it) }
            val isk = if (now.wallet != null && base.wallet != null) Math.round(now.wallet - base.wallet) else null
            val units = if (now.units != null && base.units != null) (now.units - base.units).coerceAtLeast(0) else null
            return isk to units
        }
    }
}
