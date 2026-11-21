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

/** What a data message says, in plain words. Keys follow the wing protocol: type, from, label/kind/text. */
data class PushText(val title: String, val body: String) {
    companion object {
        fun of(data: Map<String, String>): PushText? {
            data["title"]?.let { return PushText(it, data["body"].orEmpty()) }
            val who = Pilot.of(data["from"]?.toLongOrNull())?.displayName ?: "Your wingmate"
            return when (data["type"]) {
                "timer.start", "timer.upsert" -> PushText("$who started a timer", data["label"] ?: "Timer")
                "timer.end" -> PushText("${data["label"] ?: "A timer"} is done", "$who’s timer ended")
                "ping" -> PushText(who, when (data["kind"]) { "undock" -> "Undocking"; "help" -> "Needs help"; "omw" -> "On my way"; "docked" -> "Docked"; else -> data["text"] ?: "Ping" })
                else -> null
            }
        }
    }
}

object WingNotifications {
    const val CHANNEL = "wing"

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Wingmate", NotificationManager.IMPORTANCE_HIGH).apply { description = "Your wingmate’s timers and pings" })
    }

    fun show(context: Context, text: PushText, tag: String) {
        // Android 13+ needs the notification permission; the Fly feature asks for it when the first timer starts.
        if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        ensureChannel(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_emblem).setContentTitle(text.title).setContentText(text.body)
            .setAutoCancel(true).setContentIntent(open).setCategory(NotificationCompat.CATEGORY_MESSAGE).setColor(0xFFA99BFF.toInt()).build()
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
