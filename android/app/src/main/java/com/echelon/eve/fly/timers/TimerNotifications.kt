package com.echelon.eve.fly.timers

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.echelon.eve.MainActivity
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import java.text.DateFormat
import java.util.Date

/**
 * The timer notifications: one ongoing (the next end, counting down in the shade, segmented at the warning points on
 * Android 16) and one alert per warning or end, each kind on its own channel so it can vibrate its own way.
 */
object TimerNotifications {
    const val ONGOING = TimerChannels.ONGOING
    const val DONE = TimerChannels.DONE

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        fun make(id: String, name: String, importance: Int, description: String, pattern: LongArray? = null, alarm: Boolean = false) {
            if (nm.getNotificationChannel(id) != null) return
            nm.createNotificationChannel(NotificationChannel(id, name, importance).apply {
                this.description = description
                setShowBadge(id != ONGOING)
                if (pattern != null) { enableVibration(true); vibrationPattern = pattern } else { enableVibration(false); setSound(null, null) }
                if (alarm) setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            })
        }
        make(ONGOING, "Running timers", NotificationManager.IMPORTANCE_LOW, "The next timer to end, while timers run")
        make(TimerChannels.WARN, "Timer warning", NotificationManager.IMPORTANCE_HIGH, "Shortly before a timer ends, such as two minutes before the Sleepers: two short pulses", TimerChannels.WARN_PATTERN)
        make(TimerChannels.WARP, "Sleepers due: warp out", NotificationManager.IMPORTANCE_HIGH, "The Sleeper timer ended: three long pulses and a short one", TimerChannels.WARP_PATTERN, alarm = true)
        make(DONE, "Timer ended", NotificationManager.IMPORTANCE_HIGH, "A timer reached zero: one firm pulse", TimerChannels.DONE_PATTERN)
        make(TimerChannels.CYCLE, "Mining cycle", NotificationManager.IMPORTANCE_DEFAULT, "A mining cycle ended and the next began: a short tick", TimerChannels.CYCLE_PATTERN)
    }

    internal fun open(context: Context) = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    internal const val ACCENT = 0xFFA58CFF.toInt()
    internal const val WARN_COLOR = 0xFFFFB454.toInt()

    /** The ongoing notification: the next timer and its system ("Gas site in Tama") and a chronometer counting down to its end. */
    fun ongoing(context: Context, next: WingTimer?, running: Int, now: Long, systems: Map<Long, SolarSystem> = emptyMap()): Notification {
        if (Build.VERSION.SDK_INT >= 36 && next != null) runCatching { ProgressNotification.build(context, next, running, now, systems) }.getOrNull()?.let { return it }
        return NotificationCompat.Builder(context, ONGOING)
            .setSmallIcon(R.drawable.ic_stat_echelon).setColor(ACCENT).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH).setContentIntent(open(context)).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .apply {
                if (next == null) setContentTitle("Timers").setContentText("Starting…")
                else {
                    setContentTitle(next.title(systems)).setContentText(ongoingText(next, running))
                        .setStyle(NotificationCompat.BigTextStyle().bigText(ongoingLine(next, running, at(next.endsAt), systems)))
                    setWhen(next.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
                }
            }.build()
    }

    internal fun at(time: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(time))

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

    private fun allowed(context: Context) = !(Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)

    fun update(context: Context, next: WingTimer, running: Int, now: Long, systems: Map<Long, SolarSystem> = emptyMap()) {
        if (!allowed(context)) return
        runCatching { NotificationManagerCompat.from(context).notify(TimerService.ONGOING_ID, ongoing(context, next, running, now, systems)) }
    }

    /**
     * Posts a warning or an end on its own channel. The tag is the alert's key and the notification is only-alert-once,
     * so the service and the exact alarm both posting the same alert makes one buzz and one notification.
     * [who] names the wingmate whose timer it is, when it is not yours.
     */
    fun alert(context: Context, a: TimerAlert, who: String? = null) {
        if (!allowed(context)) return
        ensureChannels(context)
        val cycle = a.channel == TimerChannels.CYCLE
        val n = NotificationCompat.Builder(context, a.channel).setSmallIcon(R.drawable.ic_stat_echelon).setColor(if (a.kind == AlertKind.Warn) WARN_COLOR else ACCENT)
            .setContentTitle(if (who != null) "$who’s: ${a.title}" else a.title).setContentText(a.text).setStyle(NotificationCompat.BigTextStyle().bigText(a.text))
            .setAutoCancel(true).setContentIntent(open(context)).setOnlyAlertOnce(true).setWhen(a.at).setShowWhen(true)
            .setCategory(if (cycle) NotificationCompat.CATEGORY_STATUS else NotificationCompat.CATEGORY_ALARM)
            .setPriority(if (cycle) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            .setVibrate(TimerChannels.patternOf(a.channel)).build()
        runCatching { NotificationManagerCompat.from(context).notify(a.key, ALERT_ID, n) }
    }

    private const val ALERT_ID = 4101
}

/**
 * How the ongoing notification's progress bar is cut: [segments] are the stretches between warning points, in seconds
 * (the last one, the stretch after the final warning, is the urgent one), [points] the warning positions along the
 * bar, and [progress] how far in we are. Pure, so it is tested without Android 16.
 */
data class ProgressPlan(val total: Int, val progress: Int, val segments: List<Int>, val points: List<Int>) {
    companion object {
        fun of(t: WingTimer, now: Long): ProgressPlan {
            val total = (t.durationMs / SEC).toInt().coerceAtLeast(1)
            val marks = t.warnings.map { ((t.durationMs - it) / SEC).toInt() }.filter { it in 1 until total }.sorted()
            val cuts = listOf(0) + marks + total
            val segments = cuts.zipWithNext { a, b -> b - a }
            val elapsed = ((t.durationMs - t.remaining(now)) / SEC).toInt().coerceIn(0, total)
            return ProgressPlan(total, elapsed, segments, marks)
        }
    }
}

/** The Android 16 ongoing notification: Notification.ProgressStyle with a segment per stretch and a point at each warning. */
@RequiresApi(36)
internal object ProgressNotification {
    fun build(context: Context, next: WingTimer, running: Int, now: Long, systems: Map<Long, SolarSystem>): Notification {
        val plan = ProgressPlan.of(next, now)
        val owner = TimerNotifications.ACCENT
        val segments = plan.segments.mapIndexed { i, len ->
            Notification.ProgressStyle.Segment(len).setColor(if (i == plan.segments.lastIndex && plan.segments.size > 1) TimerNotifications.WARN_COLOR else owner)
        }
        val style = Notification.ProgressStyle().setStyledByProgress(false).setProgress(plan.progress).setProgressSegments(segments)
            .setProgressPoints(plan.points.map { Notification.ProgressStyle.Point(it).setColor(TimerNotifications.WARN_COLOR) })
        return Notification.Builder(context, TimerNotifications.ONGOING)
            .setSmallIcon(Icon.createWithResource(context, R.drawable.ic_stat_echelon)).setColor(owner).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STOPWATCH).setContentIntent(TimerNotifications.open(context)).setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentTitle(next.title(systems)).setContentText(TimerNotifications.ongoingText(next, running))
            .setWhen(next.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            .setStyle(style).build()
    }
}
