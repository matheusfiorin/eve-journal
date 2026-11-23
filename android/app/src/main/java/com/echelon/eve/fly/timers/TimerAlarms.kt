package com.echelon.eve.fly.timers

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.echelon.eve.EchelonApp
import com.echelon.eve.MainActivity
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly

// Alerts that do not depend on the foreground service staying alive: each warning and each end is also an alarm in
// AlarmManager, and a receiver posts the notification when it fires. The scheduling rules are pure ([AlarmScheduler]
// over an [AlarmFacade], a fake clock and a [ScheduleLog]) and AlarmSchedulerTest pins them; [SystemAlarms] is the real
// AlarmManager, and the receivers below are the Android end.

/** What the scheduler needs from AlarmManager. [key] names an alarm: the same key is the same alarm (set again it replaces itself). */
interface AlarmFacade {
    /** Android 12+ asks the person to allow exact alarms (a special access); before that always true. */
    fun canScheduleExact(): Boolean
    /** Exact, and allowed while the phone dozes (setExactAndAllowWhileIdle). */
    fun setExact(alert: TimerAlert)
    /** An alarm-clock alarm (setAlarmClock): the system treats it as the person's own, so it shows the alarm icon and fires on time. */
    fun setAlarmClock(alert: TimerAlert)
    /** The fallback without the permission: may be late by minutes (setAndAllowWhileIdle). */
    fun setInexact(alert: TimerAlert)
    fun cancel(key: String)
}

/** What is scheduled, kept across process deaths and reboots: key to (how, when). */
interface ScheduleLog {
    fun read(): Map<String, Scheduled>
    fun write(all: Map<String, Scheduled>)
}

enum class AlarmMode { Clock, Exact, Inexact }
data class Scheduled(val mode: AlarmMode, val at: Long)

/**
 * Keeps AlarmManager in step with the timers: [sync] schedules every alert that is still to come, cancels what is no
 * longer wanted (a paused, removed, restarted or finished timer) and reschedules what changed. Called on every timer
 * change, on boot and when the exact-alarm permission changes.
 *
 * The end of the flying pilot's own timers is an alarm clock when exact alarms are allowed; every other alert is an exact
 * alarm; without the permission everything is inexact, so the alert still arrives, only possibly late.
 */
class AlarmScheduler(private val alarms: AlarmFacade, private val log: ScheduleLog, private val clock: () -> Long = System::currentTimeMillis) {
    /** Alerts further out than this are left until a later sync (alarms are cheap, but a day-long timer can wait). */
    private val horizon = 2 * MAX_TIMER

    fun sync(timers: Collection<WingTimer>, mine: (WingTimer) -> Boolean, systemName: (WingTimer) -> String? = { null }): Int {
        val now = clock()
        val exact = alarms.canScheduleExact()
        val wanted = timers.asSequence().filter { it.pausedAt == null }.flatMap { t -> alertsOf(t, now, systemName(t)).asSequence().map { it to mine(t) } }
            .filter { (a, _) -> a.at - now <= horizon }.associate { (a, own) -> a.key to (a to modeOf(a, own, exact)) }
        val had = log.read()
        var changes = 0
        (had.keys - wanted.keys).forEach { alarms.cancel(it); changes++ }
        wanted.forEach { (key, pair) ->
            val (alert, mode) = pair
            if (had[key] == Scheduled(mode, alert.at)) return@forEach
            when (mode) { AlarmMode.Clock -> alarms.setAlarmClock(alert); AlarmMode.Exact -> alarms.setExact(alert); AlarmMode.Inexact -> alarms.setInexact(alert) }
            changes++
        }
        log.write(wanted.mapValues { (_, p) -> Scheduled(p.second, p.first.at) })
        return changes
    }

    /** Cancels every alarm this scheduler set (the person turned the timers off, or signed out). */
    fun cancelAll() { log.read().keys.forEach(alarms::cancel); log.write(emptyMap()) }

    private fun modeOf(a: TimerAlert, mine: Boolean, exact: Boolean) = when {
        !exact -> AlarmMode.Inexact
        a.kind == AlertKind.End && mine -> AlarmMode.Clock
        else -> AlarmMode.Exact
    }
}

/** The real AlarmManager. An alarm's intent carries the alert, so [TimerAlarmReceiver] can post it with nothing else running. */
class SystemAlarms(private val context: Context) : AlarmFacade {
    private val am: AlarmManager = context.getSystemService(AlarmManager::class.java)

    override fun canScheduleExact(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()

    override fun setExact(alert: TimerAlert) { runCatching { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alert.at, fire(alert)) }.onFailure { setInexact(alert) } }

    override fun setAlarmClock(alert: TimerAlert) {
        val show = PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        runCatching { am.setAlarmClock(AlarmManager.AlarmClockInfo(alert.at, show), fire(alert)) }.onFailure { setInexact(alert) }
    }

    override fun setInexact(alert: TimerAlert) { runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alert.at, fire(alert)) } }

    override fun cancel(key: String) { am.cancel(pending(key, null)) }

    private fun fire(a: TimerAlert) = pending(a.key, a)

    /** The same key makes an equal PendingIntent (the data uri), which is how [cancel] finds it without the extras. */
    private fun pending(key: String, a: TimerAlert?): PendingIntent {
        val i = Intent(context, TimerAlarmReceiver::class.java).setAction(TimerAlarmReceiver.ACTION).setData(Uri.fromParts("echelon-alarm", key, null))
        if (a != null) i.putExtra("timerId", a.timerId).putExtra("kind", a.kind.name).putExtra("remaining", a.remainingMs).putExtra("endsAt", a.endsAt)
            .putExtra("title", a.title).putExtra("text", a.text).putExtra("channel", a.channel).putExtra("owner", a.owner).putExtra("at", a.at)
        return PendingIntent.getBroadcast(context, key.hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/** [ScheduleLog] in SharedPreferences: "key" to "mode:at". */
class PrefsScheduleLog(context: Context) : ScheduleLog {
    private val prefs = context.getSharedPreferences("timer_alarms", Context.MODE_PRIVATE)
    override fun read(): Map<String, Scheduled> = prefs.all.mapNotNull { (k, v) ->
        val (m, at) = (v as? String)?.split(':', limit = 2)?.takeIf { it.size == 2 } ?: return@mapNotNull null
        val mode = AlarmMode.entries.firstOrNull { it.name == m } ?: return@mapNotNull null
        k to Scheduled(mode, at.toLongOrNull() ?: return@mapNotNull null)
    }.toMap()
    override fun write(all: Map<String, Scheduled>) { prefs.edit().clear().apply { all.forEach { (k, s) -> putString(k, "${s.mode.name}:${s.at}") } }.apply() }
}

/** Whether exact alarms are allowed, and where the person turns them on (Settings > Alarms & reminders). */
object ExactAlarms {
    fun allowed(context: Context): Boolean = SystemAlarms(context).canScheduleExact()

    /** The system screen for this app's exact-alarm access; the app's own settings page where that screen does not exist. */
    fun settingsIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
}

/** Reads the app's timers and sets the alarms for them (what boot, a permission change and every timer change do). */
fun resyncAlarms(context: Context, fresh: Boolean = false) {
    val c = (context.applicationContext as EchelonApp).container
    val store = c.fly.timers
    val systems = c.market.state.value.data?.systems.orEmpty()
    val pilot = c.selectedPilot.value
    val log = PrefsScheduleLog(context)
    // After a reboot the system has forgotten every alarm while our log still lists them: forget the log too.
    if (fresh) log.write(emptyMap())
    AlarmScheduler(SystemAlarms(context), log).sync(store.timers.value.values, mine = { it.owner == pilot?.id }, systemName = { it.systemNameIn(systems) })
}

/** An alarm went off: post the warning or the end, even when the service and the app were killed. A repeating cycle starts its next one. */
class TimerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val timerId = intent.getStringExtra("timerId") ?: return
        val kind = AlertKind.entries.firstOrNull { it.name == intent.getStringExtra("kind") } ?: return
        val endsAt = intent.getLongExtra("endsAt", 0)
        val alert = TimerAlert(timerId, kind, intent.getLongExtra("at", 0), intent.getLongExtra("remaining", 0), intent.getStringExtra("title").orEmpty(), intent.getStringExtra("text").orEmpty(),
            intent.getStringExtra("channel") ?: TimerChannels.DONE, endsAt, intent.getLongExtra("owner", 0))
        val pending = goAsync()
        val store = runCatching { (context.applicationContext as EchelonApp).container.fly.timers }.getOrNull()
        // A timer changed since the alarm was set (paused, removed, restarted) is stale: the sync cancels it, but an alarm
        // that already fired races with that, so check the store.
        val current = store?.timers?.value?.get(timerId)
        val stale = current != null && (current.pausedAt != null || current.endsAt != endsAt)
        if (!stale) TimerNotifications.alert(context, alert)
        if (kind == AlertKind.End && !stale) store?.advance(timerId, endsAt)
        runCatching { resyncAlarms(context) }
        pending.finish()
    }

    companion object { const val ACTION = "com.echelon.eve.TIMER_ALARM" }
}

/** After a reboot, an app update or a change of the exact-alarm permission, the alarms are gone or wrong: set them again. */
class TimerBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED, "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" ->
                runCatching { resyncAlarms(context, fresh = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) }
        }
    }
}
