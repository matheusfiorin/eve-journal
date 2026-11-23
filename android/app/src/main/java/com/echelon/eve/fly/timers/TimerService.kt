package com.echelon.eve.fly.timers

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.echelon.eve.EchelonApp
import com.echelon.eve.MainActivity
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.ui.format.clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * Keeps timers alive with the app in the background: an ongoing notification counting down to the next end, an alert
 * when any timer reaches zero, and a hold on the wing room so the wingmate's timers keep arriving
 * (WingChannel.onTimerServiceStarted/Stopped). It stops itself once nothing is counting down.
 *
 * A special-use foreground service: Android has no timer type, and a short service is capped at three minutes.
 */
class TimerService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watch: Job? = null
    /** Alerts already announced (warnings and ends), by [TimerAlert.key]: a restart is a new end, so a new key. */
    private val rung = mutableSetOf<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        TimerNotifications.ensureChannels(this)
        ServiceCompat.startForeground(this, ONGOING_ID, TimerNotifications.ongoing(this, null, 0, System.currentTimeMillis()),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        val container = (application as EchelonApp).container
        container.wingChannel.onTimerServiceStarted()
        val store = container.fly.timers
        // Alerts already past when the service starts were seen in the app (or rung by their alarm); only new ones ring.
        val start = System.currentTimeMillis()
        store.timers.value.values.forEach { t -> allAlerts(t).filter { it.at <= start }.forEach { rung += it.key } }
        watch = scope.launch {
            store.timers.collectLatest { all ->
                while (true) {
                    val now = System.currentTimeMillis()
                    val systems = systems(container)
                    val me = container.selectedPilot.value?.id
                    all.values.forEach { t ->
                        dueAlerts(t, now, RING_WINDOW, t.systemNameIn(systems)).filter { rung.add(it.key) }.forEach { a ->
                            // The alarm for the same alert may have rung already: same tag and id, and only-alert-once, so it replaces it quietly.
                            TimerNotifications.alert(this@TimerService, a, who = Pilot.of(t.owner)?.takeIf { t.owner != me }?.displayName)
                            if (a.kind == AlertKind.End) store.advance(t.id, a.endsAt)
                        }
                    }
                    val board = TimerBoard.of(all.values, now)
                    if (board.next == null) { stop(); return@collectLatest }
                    TimerNotifications.update(this@TimerService, board.next, board.runningCount, now, systems)
                    // Wake at the next alert or end, or within a minute to keep the text's "N running" honest.
                    val nextAlert = all.values.flatMap { alertsOf(it, now) }.minOfOrNull { it.at } ?: board.next.endsAt
                    delay((nextAlert - now).coerceIn(250, 60_000))
                }
            }
        }
    }

    /** The gate map's systems, for names in the notifications (empty before the market has loaded; stored names then serve). */
    private fun systems(container: com.echelon.eve.AppContainer) = container.market.state.value.data?.systems.orEmpty()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    private fun stop() {
        running = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        watch?.cancel()
        scope.cancel()
        (application as EchelonApp).container.wingChannel.onTimerServiceStopped()
        running = false
        super.onDestroy()
    }

    companion object {
        const val ONGOING_ID = 4100
        /** An end missed by more than this (the phone was off) is not announced late. */
        private const val RING_WINDOW = 10 * 60_000L
        @Volatile private var running = false

        /** Starts the service if it isn't running. Android refuses a start from the background; the app tries again on its next change. */
        fun ensure(context: Context) {
            if (running) return
            runCatching { ContextCompat.startForegroundService(context, Intent(context, TimerService::class.java)); running = true }
        }
    }
}

