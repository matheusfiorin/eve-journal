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
    /** Timer ends already announced, by id and end time (a restart is a new end). */
    private val rung = mutableSetOf<Pair<String, Long>>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        TimerNotifications.ensureChannels(this)
        ServiceCompat.startForeground(this, ONGOING_ID, TimerNotifications.ongoing(this, null, 0, System.currentTimeMillis()),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        val container = (application as EchelonApp).container
        container.wingChannel.onTimerServiceStarted()
        val store = container.fly.timers
        // Ends already past when the service starts were seen in the app; only new ends ring.
        val start = System.currentTimeMillis()
        store.timers.value.values.filter { it.done(start) }.forEach { rung += it.id to it.endsAt }
        watch = scope.launch {
            store.timers.collectLatest { all ->
                while (true) {
                    val now = System.currentTimeMillis()
                    all.values.filter { it.done(now) && (it.id to it.endsAt) !in rung && now - it.endsAt < RING_WINDOW }.forEach { t ->
                        rung += t.id to t.endsAt
                        TimerNotifications.done(this@TimerService, t, mine = t.owner == container.selectedPilot.value?.id, systems = systems(container))
                    }
                    val board = TimerBoard.of(all.values, now)
                    if (board.next == null) { stop(); return@collectLatest }
                    TimerNotifications.update(this@TimerService, board.next, board.runningCount, now, systems(container))
                    // Wake at the next end, or within a minute to keep the text's "N running" honest.
                    delay((board.next.endsAt - now).coerceIn(250, 60_000))
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

/** The timer notifications: one ongoing (the next end, counting down in the shade) and one alert per finished timer. */
object TimerNotifications {
    const val ONGOING = "timers"
    const val DONE = "timers_done"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(ONGOING) == null) nm.createNotificationChannel(NotificationChannel(ONGOING, "Running timers", NotificationManager.IMPORTANCE_LOW).apply { description = "The next timer to end, while timers run"; setShowBadge(false) })
        if (nm.getNotificationChannel(DONE) == null) nm.createNotificationChannel(NotificationChannel(DONE, "Timer ended", NotificationManager.IMPORTANCE_HIGH).apply { description = "A timer reached zero"; enableVibration(true) })
    }

    private fun open(context: Context) = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** The ongoing notification: the next timer and its system ("Gas site in Tama") and a chronometer counting down to its end. */
    fun ongoing(context: Context, next: WingTimer?, running: Int, now: Long, systems: Map<Long, SolarSystem> = emptyMap()) = NotificationCompat.Builder(context, ONGOING)
        .setSmallIcon(R.drawable.ic_emblem).setColor(0xFFA99BFF.toInt()).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_STOPWATCH).setContentIntent(open(context)).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .apply {
            if (next == null) setContentTitle("Timers").setContentText("Starting…")
            else {
                setContentTitle(next.title(systems)).setContentText(ongoingText(next, running))
                    .setStyle(NotificationCompat.BigTextStyle().bigText(ongoingLine(next, running, at(next.endsAt), systems)))
                setWhen(next.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            }
        }.build()

    private fun at(time: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(time))

    /** "Ends at 14:32 · 3 running" */
    fun ongoingText(next: WingTimer, running: Int): String = ongoingText(at(next.endsAt), running)

    /** "Ends at 14:32 · 3 running", with the end time already formatted. */
    fun ongoingText(at: String, running: Int): String = if (running > 1) "Ends at $at · $running running" else "Ends at $at"

    /** The expanded line: "Gas site in Tama ends at 14:32 · 3 running". */
    fun ongoingLine(next: WingTimer, running: Int, at: String, systems: Map<Long, SolarSystem> = emptyMap()): String =
        "${next.title(systems)} ends at $at" + if (running > 1) " · $running running" else ""

    /** "Gas site in Tama is done" (yours) or "Decxus’s Gas site in Tama is done". */
    fun doneTitle(t: WingTimer, mine: Boolean, systems: Map<Long, SolarSystem> = emptyMap()): String {
        val who = Pilot.of(t.owner)?.displayName
        val what = t.title(systems)
        return if (mine || who == null) "$what is done" else "$who’s $what is done"
    }

    fun update(context: Context, next: WingTimer, running: Int, now: Long, systems: Map<Long, SolarSystem> = emptyMap()) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        runCatching { NotificationManagerCompat.from(context).notify(TimerService.ONGOING_ID, ongoing(context, next, running, now, systems)) }
    }

    /** The alert when a timer ends: [doneTitle], and how long it ran. */
    fun done(context: Context, t: WingTimer, mine: Boolean, systems: Map<Long, SolarSystem> = emptyMap()) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val title = doneTitle(t, mine, systems)
        val n = NotificationCompat.Builder(context, DONE).setSmallIcon(R.drawable.ic_emblem).setColor(0xFFA99BFF.toInt())
            .setContentTitle(title).setContentText("Ran ${clock(t.durationMs)}").setAutoCancel(true).setContentIntent(open(context))
            .setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        runCatching { NotificationManagerCompat.from(context).notify(t.id, DONE_ID, n) }
    }

    private const val DONE_ID = 4101
}
