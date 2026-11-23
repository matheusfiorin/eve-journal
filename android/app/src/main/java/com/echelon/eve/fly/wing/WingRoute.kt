package com.echelon.eve.fly.wing

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.push.WingNotifications
import com.echelon.eve.core.wing.SessionPlan
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingMessage
import com.echelon.eve.core.wing.WingPing
import com.echelon.eve.core.wing.jumpsBetween
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.GasOps
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.components.rememberNow
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.motion.HapticMoment
import com.echelon.eve.wing.wingServices
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** How long a wingmate's call counts as new: opening the Wing screen marks newer ones "seen" (a read receipt). */
private const val SEEN_WINDOW_MS = 3_600_000L

@Composable
fun WingRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val now = rememberNow(periodMillis = 5_000)
    if (c == null) { WingScreen(WingUi(ctx.pilot, WingChannel.Status.Idle, emptyMap(), emptyList()), now, WingActions()); return }
    val ch = c.wingChannel
    val services = c.wingServices
    val settings = services.settings
    val status by ch.status.collectAsStateWithLifecycle()
    val presence by ch.presence.collectAsStateWithLifecycle()
    val pings by ch.pings.collectAsStateWithLifecycle()
    val plans by ch.plans.collectAsStateWithLifecycle()
    val statuses by ch.statuses.collectAsStateWithLifecycle()
    val session by ch.session.collectAsStateWithLifecycle()
    val history by ch.sessionHistory.collectAsStateWithLifecycle()
    val sharing by settings.shareStatus.collectAsStateWithLifecycle()
    val activity by settings.activity.collectAsStateWithLifecycle()
    val myRoute by settings.route.collectAsStateWithLifecycle()
    val market by c.market.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    // The live gas of this phone's own operations, smoother than the room's last report, and what the ledger confirms.
    val gasIn by c.fly.gasOps.inputs.collectAsStateWithLifecycle()
    val ledger by c.fly.gasOps.ledger.collectAsStateWithLifecycle()
    val myTimers by c.fly.timers.timers.collectAsStateWithLifecycle()
    var custom by remember { mutableStateOf("") }
    var goal by remember { mutableStateOf("") }
    var shareSystem by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf<String?>(null) }
    var notificationsOff by remember { mutableStateOf(!WingNotifications.allowed(context)) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationsOff = !it }
    val pilot = ctx.pilot
    // Where the flying pilot is: their own snapshot, else what they share with the wing.
    val here = pilot?.let { p -> (c.pilots.state(p).private?.op("location")?.value as? JsonObject)?.get("solar_system_id")?.jsonPrimitive?.content?.toLongOrNull() ?: c.wing.of(p)?.location?.solarSystemId }
    val systems = market.data?.systems.orEmpty()
    val systemName = { id: Long -> systems[id]?.name }
    val mine = pilot?.let { statuses[it.id]?.system } ?: here
    val theirs = pilot?.let { statuses[it.wingmate.id] }
    val items = feed(pings, plans)
    // A call from the wingmate while this screen is open: a tap you can feel. Arriving in your system: two.
    LaunchedEffect(Unit) {
        ch.incoming.collect { m ->
            if (m is WingMessage.Ping && m.pilot != pilot) haptics.play(HapticMoment.Ping)
            // Their answer to one of your calls (not the automatic "seen"): the Ack moment, with the ripple on screen.
            if (m is WingMessage.Ack && m.pilot != pilot && m.kind != WingAck.SEEN) haptics.play(HapticMoment.Ack)
            if (m is WingMessage.StatusUpdate && m.pilot != pilot && m.status?.system != null && m.status.system == mine) haptics.confirm()
        }
    }
    // Read receipts: what the wingmate sent in the last hour is "seen" once it is on this screen.
    LaunchedEffect(items, pilot, status) {
        val p = pilot ?: return@LaunchedEffect
        if (status != WingChannel.Status.Connected) return@LaunchedEffect
        items.filter { it.from == p.wingmate && it.acks[p.id] == null && now - it.at < SEEN_WINDOW_MS }.forEach { ch.ack(p, it.id, WingAck.SEEN) }
    }
    val autopilot: (List<Long>, String) -> Unit = { ids, done ->
        val p = pilot
        val token = p?.let { c.sessions.token(it.id) }
        if (token != null) scope.launch {
            sent = "Sending…"
            sent = try {
                val r = c.api.post<JsonObject>("/api/waypoints", token, buildJsonObject { put("systems", buildJsonArray { ids.forEach { add(JsonPrimitive(it)) } }) })
                "$done: ${plural(r["waypoints"]?.jsonPrimitive?.int ?: ids.size, "waypoint")}."
            } catch (e: ApiError) { e.message ?: "EVE did not take the route." }
        }
    }
    val ping = { p: WingPing ->
        if (pilot != null) {
            val ok = ch.ping(pilot, p)
            haptics.confirm()
            sent = if (ok) "Sent to ${pilot.wingmate.displayName}." else "Queued: it goes out when the wing room reconnects."
        }
    }
    WingScreen(
        WingUi(pilot, status, presence, items, custom, shareSystem, here?.let(systemName), systemName, pilot != null && c.sessions.has(pilot.id), sent,
            statuses = statuses, jumps = jumpsBetween(systems, mine, theirs?.system), jumpsToMateDestination = jumpsBetween(systems, mine, theirs?.destination),
            sharing = sharing, activity = activity, myRoute = myRoute, session = session, history = history, goal = goal,
            notificationsOff = notificationsOff && Build.VERSION.SDK_INT >= 33,
            liveOps = pilot?.let { p -> myTimers.values.filter { it.owner == p.id }.mapNotNull { t -> GasOps.estimate(t, gasIn, now)?.let { t.id to it } }.toMap() }.orEmpty(),
            confirmed = pilot?.let { p -> session?.ops.orEmpty().filter { it.by == p.id }.mapNotNull { op -> GasOps.confirmedUnits(ledger, op, now)?.let { op.id to it } }.toMap() }.orEmpty(),
            suggestedGoal = GasOps.suggestGoal(gasIn, c.fly.timers.lastGasChoice())),
        now,
        WingActions(
            ping = { kind -> ping(WingPing(kind, system = if (shareSystem) here else null)) },
            custom = { custom = it },
            sendCustom = { if (custom.isNotBlank()) { ping(WingPing(WingPing.CUSTOM, custom.trim(), if (shareSystem) here else null)); custom = "" } },
            shareSystem = { shareSystem = it },
            autopilot = { plan ->
                // The whole route up to 40 jumps (routes.js sendable); a longer one sends its destination and EVE finds the way.
                autopilot(if (plan.route.size - 1 <= 40) plan.route.drop(1) else listOf(plan.route.last()), "Autopilot set")
                // Follow mode: the wingmate sees where this pilot is heading (only while the status is shared).
                services.follow(plan.route)
            },
            reconnect = { ch.identityChanged() },
            share = { haptics.select(); settings.setShareStatus(it) },
            activity = { haptics.select(); settings.setActivity(it) },
            stopRoute = { services.stopFollowing() },
            follow = { route -> autopilot(route, "Following ${pilot?.wingmate?.displayName ?: "your wingmate"}"); services.follow(route) },
            ack = { item, kind -> if (pilot != null) { scope.launch { haptics.play(HapticMoment.Ack) }; ch.ack(pilot, item.id, kind) } },
            goal = { goal = it },
            startSession = {
                if (pilot != null) {
                    ch.startSession(pilot, SessionPlan(activity, parseIsk(goal)?.takeIf { it > 0 }, mine))
                    goal = ""; haptics.confirm()
                }
            },
            addIsk = { amount, note -> if (pilot != null) { ch.addIsk(pilot, amount, note); haptics.confirm() } },
            endSession = { if (pilot != null) { ch.endSession(pilot); haptics.confirm() } },
            allowNotifications = { if (Build.VERSION.SDK_INT >= 33) ask.launch(Manifest.permission.POST_NOTIFICATIONS) },
        ),
    )
}

/** The hub's Wing card: the compact session card while one runs, else the plain card. */
@Composable
fun WingHubCard(ctx: ScreenContext, onOpen: () -> Unit) {
    val c = LocalAppContainer.current
    val session = c?.wingChannel?.session?.collectAsStateWithLifecycle()?.value
    val pilot = ctx.pilot
    if (c == null || session == null || pilot == null) { com.echelon.eve.nav.HubCard("Wing", "Calls, shared plans and who is online", com.echelon.eve.ui.EchelonIcons.Wing, onOpen); return }
    SessionMini(session, pilot, onOpen)
}
