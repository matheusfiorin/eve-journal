package com.echelon.eve.wing

import android.content.Context
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.push.PushText
import com.echelon.eve.core.push.WingNotifications
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.WingChannel
import com.echelon.eve.core.wing.WingMessage
import com.echelon.eve.core.wing.WingStatus
import com.echelon.eve.core.wing.ackWord
import com.echelon.eve.core.wing.aOrAn
import com.echelon.eve.core.wing.activityWord
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.fly.wing.pingText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** A notification to show: its words and a tag (one per subject, so a newer one replaces the older). */
data class WingAlert(val text: PushText, val tag: String)

/**
 * Turns the wingmate's live messages into notifications for a pilot ([me]) whose app is in the background but still
 * holds the wing room (a running timer keeps the socket open; with no socket the room pushes through FCM instead).
 * Calls go on "Wingmate calls"; answers, sessions and "in your system" on "Wing updates". Timers are the Fly feature's
 * own notifications and are not repeated here; statuses notify only when the wingmate arrives in your system.
 */
class WingAlerts(private val systemName: (Long) -> String? = { null }) {
    private var nearby: Long? = null

    fun of(m: WingMessage, me: Pilot, mine: WingStatus?): WingAlert? {
        if (m.from == me.id) return null
        val who = Pilot.of(m.from)?.displayName ?: "Your wingmate"
        return when (m) {
            is WingMessage.Ping -> WingAlert(PushText(who, pingText(m.ping) + (m.ping.system?.let { s -> " · ${systemName(s) ?: "system $s"}" } ?: "")), "ping-${m.id}")
            is WingMessage.Ack -> if (m.kind == WingAck.SEEN) null else WingAlert(PushText("$who: ${ackWord(m.kind)}", "Answering your call", updates = true), "ack-${m.ref}")
            is WingMessage.SessionEvent -> session(m.phase, m.session, who)
            is WingMessage.StatusUpdate -> {
                val there = m.status?.system
                val together = there != null && there == mine?.system
                // Once per arrival: staying together, or a status refresh in the same place, says nothing new.
                if (!together) { nearby = null; null }
                else if (nearby == there) null
                else { nearby = there; WingAlert(PushText("$who is in ${systemName(there!!) ?: "your system"}", "You are in the same system", updates = true), "nearby") }
            }
            else -> null
        }
    }

    private fun session(phase: String, s: WingSession, who: String): WingAlert? = when (phase) {
        "start" -> WingAlert(PushText("$who started ${aOrAn(activityWord(s.activity))} session", s.title ?: "Open the Wing screen to see it", updates = true), "session")
        "end" -> WingAlert(PushText("Session ended", "${s.sum.systems} systems, ${s.sum.timers} timers between you", updates = true), "session")
        else -> null
    }
}

/** Shows [WingAlerts] while the app is not in the foreground ([foreground] false). */
class WingNotifier(
    private val context: Context,
    private val scope: CoroutineScope,
    private val channel: WingChannel,
    private val pilot: StateFlow<Pilot?>,
    private val foreground: () -> Boolean,
    private val alerts: WingAlerts,
) {
    fun start(): Job = scope.launch {
        channel.incoming.collect { m ->
            val me = pilot.value ?: return@collect
            val alert = alerts.of(m, me, channel.statuses.value[me.id]) ?: return@collect
            if (!foreground()) WingNotifications.show(context, alert.text, alert.tag)
        }
    }
}
