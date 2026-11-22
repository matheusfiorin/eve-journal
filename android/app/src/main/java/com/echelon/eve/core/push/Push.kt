package com.echelon.eve.core.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.echelon.eve.EchelonApp
import com.echelon.eve.MainActivity
import com.echelon.eve.R
import com.echelon.eve.core.api.EchelonApi
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingAck
import com.echelon.eve.core.wing.ackWord
import com.echelon.eve.core.wing.aOrAn
import com.echelon.eve.core.wing.activityWord
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Background push for the wing (optional). The Worker's wing room sends an FCM data message to the wingmate's
// registered devices on timer start/end and pings, when its FCM secrets exist. Here Firebase is optional too: the
// google-services plugin is applied only when app/google-services.json exists, and without it FirebaseApp never
// initialises, so every call below is a quiet no-op.

/** Registers this phone's FCM token with the Worker (POST /api/push/register {token}) for each connected pilot. */
class PushRegistrar(private val context: Context, private val api: EchelonApi, private val scope: CoroutineScope, private val tokens: () -> List<String>) {
    val available: Boolean get() = runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    /** Asks Firebase for the token and registers it; call after sign-in and on start. */
    fun refresh() {
        if (!available) return
        scope.launch { runCatching { register(FirebaseMessaging.getInstance().token.await()) } }
    }

    suspend fun register(fcmToken: String) {
        for (session in tokens()) runCatching { api.post<JsonObject>("/api/push/register", session, buildJsonObject { put("token", fcmToken) }) }
    }
}

/**
 * What a data message says, in plain words. The room sends {type, kind, pilot (sender id), from (sender name), label |
 * ping + text | ack | activity}; older rooms sent {kind, from (name), ping} and the first app read {type, from (id), kind}:
 * all three shapes are read. [updates] puts it on the quieter "wing updates" channel instead of "Wingmate calls".
 */
data class PushText(val title: String, val body: String, val updates: Boolean = false) {
    companion object {
        fun of(data: Map<String, String>): PushText? {
            data["title"]?.let { return PushText(it, data["body"].orEmpty()) }
            val from = data["from"]
            val who = Pilot.of(data["pilot"]?.toLongOrNull() ?: from?.toLongOrNull())?.displayName ?: from?.takeIf { it.isNotBlank() && it.toLongOrNull() == null } ?: "Your wingmate"
            val type = data["type"] ?: data["kind"]
            return when (type) {
                "timer.start", "timer.upsert" -> PushText("$who started a timer", data["label"]?.takeIf { it.isNotBlank() } ?: "Timer")
                "timer.end" -> PushText("${data["label"]?.takeIf { it.isNotBlank() } ?: "A timer"} is done", "$who’s timer ended")
                "ping" -> PushText(who, when (data["ping"] ?: data["kind"]) { "undock" -> "Undocking"; "help" -> "Needs help"; "omw" -> "On my way"; "docked" -> "Docked"; else -> data["text"]?.takeIf { it.isNotBlank() } ?: "Ping" })
                "ack" -> PushText("$who: ${ackWord(data["ack"] ?: WingAck.SEEN)}", data["text"]?.takeIf { it.isNotBlank() }?.let { "Answering “$it”" } ?: "Answering your call", updates = true)
                "session.start" -> PushText("$who started ${aOrAn(activityWord(data["activity"] ?: "wing"))} session", "Open the Wing screen to join in", updates = true)
                "session.end" -> PushText("$who ended the session", "The summary is on the Wing screen", updates = true)
                else -> null
            }
        }
    }
}

object WingNotifications {
    /** Calls (pings) and timers: high importance, as before. */
    const val CHANNEL = "wing"
    /** Answers, sessions and "in the same system": the default importance. */
    const val UPDATES = "wing_updates"

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Wingmate calls", NotificationManager.IMPORTANCE_HIGH).apply { description = "Your wingmate’s calls and timers" })
        if (nm.getNotificationChannel(UPDATES) == null) nm.createNotificationChannel(NotificationChannel(UPDATES, "Wing updates", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Answers to your calls, shared sessions, and when your wingmate is in your system" })
    }

    /** Whether notifications can be shown (Android 13+ asks for the permission at run time). */
    fun allowed(context: Context): Boolean = android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(context: Context, text: PushText, tag: String) {
        // Android 13+ needs the notification permission; the Fly feature asks when the first timer starts, the Wing screen offers it too.
        if (!allowed(context)) return
        ensureChannel(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, if (text.updates) UPDATES else CHANNEL).setSmallIcon(R.drawable.ic_emblem).setContentTitle(text.title).setContentText(text.body)
            .setAutoCancel(true).setContentIntent(open).setCategory(if (text.updates) NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_MESSAGE).setColor(0xFFA99BFF.toInt()).build()
        runCatching { NotificationManagerCompat.from(context).notify(tag, 0, n) }
    }
}

/** FCM's entry point: a new token is registered with the Worker; a data message becomes a notification. */
class EchelonMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val c = (application as EchelonApp).container
        c.scope.launch { c.push.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val text = PushText.of(message.data) ?: message.notification?.let { PushText(it.title ?: "Echelon", it.body.orEmpty()) } ?: return
        WingNotifications.show(this, text, message.data["id"] ?: message.messageId ?: "wing")
    }
}
