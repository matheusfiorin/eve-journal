package com.echelon.eve.fly.cockpit

import android.content.Context
import com.echelon.eve.AppContainer
import com.echelon.eve.EchelonApp
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.GasSleepers
import com.echelon.eve.fly.timers.MiningProfile
import com.echelon.eve.fly.timers.SEC
import com.echelon.eve.fly.timers.TimerDraft
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.fly.timers.TimerSystem
import com.echelon.eve.fly.timers.TimerStore
import com.echelon.eve.ui.format.plural
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The one-tap actions the cockpit, the home-screen widget and the Quick Settings tile share. */
object CockpitControl {
    /**
     * The next cycle of [kind] for [pilot]: restarts their last timer of that kind at its own length (the mining
     * cycle they set up), or starts a new one at the kind's default. Only TimerStore's public calls are used.
     */
    fun cycle(store: TimerStore, pilot: Pilot, kind: TimerKind): WingTimer? {
        val q = QuickTimer.of(store.timers.value.values, pilot, kind)
        return if (q.reuse != null) { store.restart(q.reuse.id); store.timers.value[q.reuse.id] }
        else store.start(pilot, kind, q.durationMs)
    }

    /**
     * Starts what [s] suggests for [pilot], on one tap: the Sleeper gas timer in the wormhole system with its default
     * length and warnings, or a repeating mining timer at the fit's cycle (or the kind's default without a fit).
     */
    fun startSuggestion(store: TimerStore, pilot: Pilot, s: Suggestion, mining: MiningProfile?): WingTimer = when (s) {
        is Suggestion.Wormhole -> store.start(pilot, TimerDraft(TimerKind.Sleeper, GasSleepers.DEFAULT_MS, shared = true, system = TimerSystem(s.systemId, s.name.orEmpty()), warnings = listOf(GasSleepers.WARN_MS)))
        is Suggestion.Mining -> store.start(pilot, TimerDraft(TimerKind.Mining, mining?.cycleMs?.coerceAtLeast(10 * SEC) ?: TimerKind.Mining.defaultMs, repeat = true,
            cycleMs = mining?.cycleMs, holdFullMs = mining?.holdFullMs, fit = mining?.let { "${it.shipName}: ${it.summary}" }))
    }

    /** The flying pilot, waiting for the saved choice when the process has just started (a widget tap on a cold app). */
    suspend fun flying(c: AppContainer): Pilot? = c.selectedPilot.value ?: runCatching { c.prefs.selectedPilot.first() }.getOrNull()

    fun container(context: Context): AppContainer = (context.applicationContext as EchelonApp).container

    /** The cycle from outside the app (widget, tile). Returns what to say, for the tile's subtitle or a toast. */
    suspend fun cycleFromOutside(context: Context, kind: TimerKind): String {
        val c = container(context)
        val pilot = flying(c) ?: return "Open Echelon and choose who is flying"
        val t = cycle(c.fly.timers, pilot, kind) ?: return "Could not start the timer"
        return "${t.label} started"
    }

    /**
     * Sets EVE's autopilot through POST /api/waypoints: the first system clears the old route (worker/index.js). A
     * route longer than 40 jumps sends its destination only and EVE finds the way, as the Wing screen does.
     */
    suspend fun autopilot(c: AppContainer, pilot: Pilot, systems: List<Long>): String {
        val token = c.sessions.token(pilot.id) ?: return "${pilot.displayName} is not connected on this phone."
        val ids = if (systems.size <= 40) systems else listOf(systems.last())
        if (ids.isEmpty()) return "No route to send."
        return try {
            val r = c.api.post<JsonObject>("/api/waypoints", token, buildJsonObject { put("systems", buildJsonArray { ids.forEach { add(JsonPrimitive(it)) } }) })
            val n = r["waypoints"]?.jsonPrimitive?.int ?: ids.size
            if (n == 1) "Destination set in EVE." else "Autopilot set: ${plural(n, "waypoint")}."
        } catch (e: ApiError) { e.message ?: "EVE did not take the route." }
    }
}
