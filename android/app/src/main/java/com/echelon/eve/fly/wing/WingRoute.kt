package com.echelon.eve.fly.wing

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.motion.rememberHaptics
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Composable
fun WingRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val now = rememberNow(periodMillis = 30_000)
    if (c == null) { WingScreen(WingUi(ctx.pilot, com.echelon.eve.core.wing.WingChannel.Status.Idle, emptyMap(), emptyList()), now, WingActions()); return }
    val ch = c.wingChannel
    val status by ch.status.collectAsStateWithLifecycle()
    val presence by ch.presence.collectAsStateWithLifecycle()
    val pings by ch.pings.collectAsStateWithLifecycle()
    val plans by ch.plans.collectAsStateWithLifecycle()
    val market by c.market.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var custom by remember { mutableStateOf("") }
    var shareSystem by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf<String?>(null) }
    val pilot = ctx.pilot
    // Where the flying pilot is: their own snapshot, else what they share with the wing.
    val here = pilot?.let { p -> (c.pilots.state(p).private?.op("location")?.value as? JsonObject)?.get("solar_system_id")?.jsonPrimitive?.content?.toLongOrNull() ?: c.wing.of(p)?.location?.solarSystemId }
    val systemName = { id: Long -> market.data?.systems?.get(id)?.name }
    // A call from the wingmate while this screen is open: a tap you can feel.
    LaunchedEffect(Unit) { ch.incoming.collect { m -> if (m is com.echelon.eve.core.wing.WingMessage.Ping && m.pilot != pilot) haptics.heavy() } }
    val ping = { p: WingPing ->
        if (pilot != null) {
            val ok = ch.ping(pilot, p)
            haptics.confirm()
            sent = if (ok) "Sent to ${pilot.wingmate.displayName}." else "Queued: it goes out when the wing room reconnects."
        }
    }
    WingScreen(
        WingUi(pilot, status, presence, feed(pings, plans), custom, shareSystem, here?.let(systemName), systemName, pilot != null && c.sessions.has(pilot.id), sent),
        now,
        WingActions(
            ping = { kind -> ping(WingPing(kind, system = if (shareSystem) here else null)) },
            custom = { custom = it },
            sendCustom = { if (custom.isNotBlank()) { ping(WingPing(WingPing.CUSTOM, custom.trim(), if (shareSystem) here else null)); custom = "" } },
            shareSystem = { shareSystem = it },
            autopilot = { plan ->
                val p = pilot ?: return@WingActions
                val token = c.sessions.token(p.id) ?: return@WingActions
                // The whole route up to 40 jumps (routes.js sendable); a longer one sends its destination and EVE finds the way.
                val ids = if (plan.route.size - 1 <= 40) plan.route.drop(1) else listOf(plan.route.last())
                scope.launch {
                    sent = "Sending…"
                    sent = try {
                        val r = c.api.post<JsonObject>("/api/waypoints", token, buildJsonObject { put("systems", buildJsonArray { ids.forEach { add(JsonPrimitive(it)) } }) })
                        "Autopilot set: ${plural(r["waypoints"]?.jsonPrimitive?.int ?: ids.size, "waypoint")}."
                    } catch (e: ApiError) { e.message ?: "EVE did not take the route." }
                }
            },
            reconnect = { ch.identityChanged() },
        ),
    )
}
