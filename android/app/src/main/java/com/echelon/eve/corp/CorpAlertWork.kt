package com.echelon.eve.corp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.echelon.eve.EchelonApp
import com.echelon.eve.MainActivity
import com.echelon.eve.R
import com.echelon.eve.core.api.ApiError
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Pilot
import kotlinx.serialization.json.JsonObject
import java.util.concurrent.TimeUnit

// Local corporation alerts: an hourly WorkManager job reads GET /api/corp for each connected pilot's corporation and
// notifies about low fuel and reinforcement (the rules are in CorpAlerts.kt). The Worker builds that snapshot about
// once an hour, so hourly is as fresh as it gets; the job needs a network and runs whether or not the app is open.

/** Where the switches and the already-told keys live. */
interface CorpAlertPrefs {
    fun enabled(kind: AlertKind): Boolean
    fun setEnabled(kind: AlertKind, on: Boolean)
    fun fired(): Set<String>
    fun setFired(keys: Set<String>)
}

fun CorpAlertPrefs.enabledKinds() = AlertKind.entries.filter { enabled(it) }.toSet()

/** SharedPreferences "corp_alerts": every type on by default, and the set of keys already told. */
class SharedCorpAlertPrefs(private val sp: SharedPreferences) : CorpAlertPrefs {
    constructor(context: Context) : this(context.applicationContext.getSharedPreferences("corp_alerts", Context.MODE_PRIVATE))
    override fun enabled(kind: AlertKind) = sp.getBoolean("on:${kind.id}", true)
    override fun setEnabled(kind: AlertKind, on: Boolean) = sp.edit().putBoolean("on:${kind.id}", on).apply()
    override fun fired(): Set<String> = sp.getStringSet("fired", emptySet()).orEmpty().toSet()
    override fun setFired(keys: Set<String>) = sp.edit().putStringSet("fired", keys).apply()
}

/** Switches and told keys in memory: previews, screenshots and tests. */
class InMemoryCorpAlertPrefs(private val off: MutableSet<AlertKind> = mutableSetOf(), private var told: Set<String> = emptySet()) : CorpAlertPrefs {
    override fun enabled(kind: AlertKind) = kind !in off
    override fun setEnabled(kind: AlertKind, on: Boolean) { if (on) off -= kind else off += kind }
    override fun fired() = told
    override fun setFired(keys: Set<String>) { told = keys }
}

/** What one run reads or posts; the real one talks to the app, a test supplies its own. */
interface CorpAlertEnv {
    val prefs: CorpAlertPrefs
    /** The corporation snapshots of the connected pilots (one per corporation), or null when none could be read. */
    suspend fun snapshots(): List<CorpSnapshot>?
    suspend fun names(snapshots: List<CorpSnapshot>): AlertNames
    /** False when notifications are not allowed: nothing is told, and nothing counts as told. */
    fun canNotify(): Boolean
    fun notify(alert: CorpAlert)
}

class CorpAlertWorker(context: Context, params: WorkerParameters, private val env: CorpAlertEnv) : CoroutineWorker(context, params) {
    /** What WorkManager's default factory calls: the real environment. */
    constructor(context: Context, params: WorkerParameters) : this(context, params, AppCorpAlertEnv((context.applicationContext as EchelonApp).container))

    override suspend fun doWork(): Result {
        val enabled = env.prefs.enabledKinds()
        if (enabled.isEmpty()) return Result.success()
        if (!env.canNotify()) return Result.success()
        val snaps = env.snapshots() ?: return if (runAttemptCount < MAX_RETRIES) Result.retry() else Result.success()
        val run = evaluateAlerts(snaps, enabled, env.prefs.fired(), env.names(snaps))
        run.alerts.forEach { env.notify(it) }
        env.prefs.setFired(run.fired)
        return Result.success()
    }

    companion object { const val MAX_RETRIES = 3 }
}

object CorpAlertScheduler {
    const val UNIQUE_NAME = "corp-alerts"

    /** Hourly, only with a network. */
    fun request(): PeriodicWorkRequest = PeriodicWorkRequest.Builder(CorpAlertWorker::class.java, 1, TimeUnit.HOURS)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .addTag(UNIQUE_NAME)
        .build()

    /** Unique work: calling it again (every app start) keeps the schedule it already has. */
    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request())
    }
}

/** The app's side of a run: the connected pilots' sessions, ESI names and the notifications. */
class AppCorpAlertEnv(private val c: com.echelon.eve.AppContainer) : CorpAlertEnv {
    private val context = c.app
    override val prefs: CorpAlertPrefs = SharedCorpAlertPrefs(context)

    override suspend fun snapshots(): List<CorpSnapshot>? {
        val tokens = Pilot.entries.mapNotNull { c.sessions.token(it.id) }
        if (tokens.isEmpty()) return emptyList() // nobody connected: nothing to watch, nothing to retry
        val got = mutableListOf<CorpSnapshot>()
        var failed = false
        for (token in tokens) {
            try { got += CorpSnapshot.of(c.api.get<JsonObject>("/api/corp", token)) }
            catch (e: ApiError) { if (!(e is ApiError.Http && e.status == 404)) failed = true } // 404: that corporation has no snapshot yet
        }
        return if (got.isEmpty() && failed) null else got.distinctBy { it.corporationId }
    }

    override suspend fun names(snapshots: List<CorpSnapshot>): AlertNames {
        c.eveNames.resolve(snapshots.flatMap { s -> s.starbases.value.orEmpty().map { it.type } + s.structures.value.orEmpty().map { it.type } })
        val systems = c.market.state.value.data?.systems
        return AlertNames(type = { c.eveNames.name(it) }, system = { systems?.get(it)?.name })
    }

    override fun canNotify() = android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    override fun notify(alert: CorpAlert) {
        // Checked inline (not through canNotify()) so lint sees the permission check guarding notify().
        if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        ensureChannels(context)
        val id = alert.key.hashCode()
        // A tap opens that tower or structure: MainActivity's "Destination/key/arg" deep link. The request code keeps each pending intent apart.
        val open = PendingIntent.getActivity(context, id, MainActivity.open(context, alert.route), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, if (alert.critical) CHANNEL_ATTACK else CHANNEL_FUEL).setSmallIcon(R.drawable.ic_stat_echelon)
            .setContentTitle(alert.title).setContentText(alert.body).setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
            .setAutoCancel(true).setContentIntent(open).setCategory(NotificationCompat.CATEGORY_STATUS).setColor(0xFFFF7F70.toInt()).setGroup(GROUP)
            .setPriority(if (alert.critical) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT).build()
        runCatching { NotificationManagerCompat.from(context).notify("corp", id, n) }
    }

    companion object {
        const val CHANNEL_FUEL = "corp_fuel"
        const val CHANNEL_ATTACK = "corp_attack"
        const val GROUP = "corp_alerts"
        fun ensureChannels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL_ATTACK) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL_ATTACK, "Corp: urgent", NotificationManager.IMPORTANCE_HIGH).apply { description = "Reinforced towers and structures, and fuel about to run out" })
            if (nm.getNotificationChannel(CHANNEL_FUEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL_FUEL, "Corp: fuel", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Towers and structures running low on fuel" })
        }
    }
}
