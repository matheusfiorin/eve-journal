package com.echelon.eve.fly.cockpit

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.timers.TimerBoard
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.secLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the widget shows, worked out from plain data (WidgetTextTest pins it). */
data class WidgetText(val label: String, val endsAt: Long?, val frozen: String?, val where: String, val cycle: String)

fun widgetText(timers: Collection<WingTimer>, pilot: Pilot?, me: Whereabouts?, now: Long): WidgetText {
    val board = TimerBoard.of(timers, now)
    val next = board.next
    val paused = if (next == null) board.active.firstOrNull() else null
    val label = when {
        next != null -> next.label + (Pilot.of(next.owner)?.takeIf { it != pilot }?.let { " (${it.displayName})" } ?: "") + (if (board.runningCount > 1) " · ${board.runningCount}" else "")
        paused != null -> "${paused.label} (paused)"
        else -> "No timer running"
    }
    val where = when {
        pilot == null -> "Open Echelon and choose who is flying"
        me == null -> pilot.displayName
        else -> listOfNotNull(me.systemName?.let { n -> me.sec?.let { "$n ${secLabel(it)}" } ?: n }, if (me.dockedAt != null) "docked" else "in space", me.shipName?.takeIf { it.isNotBlank() } ?: me.shipTypeName).joinToString(" · ")
    }
    val q = pilot?.let { QuickTimer.of(timers, it, TimerKind.Mining) }
    return WidgetText(label, next?.endsAt, paused?.let { clock(it.remaining(now)) }, where, q?.let { "Mining cycle\n${clock(it.durationMs)}" } ?: "Next mining cycle")
}

/**
 * The home-screen widget: the next timer counting down (a system chronometer, so it ticks without waking the app),
 * where the flying pilot was last read, a button for the next mining cycle and one that opens the cockpit.
 * [watch] (from FlyFeature.start) pushes an update whenever the timers or the last place change and at each end.
 */
class CockpitWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_CYCLE) {
            val done = goAsync()
            val c = CockpitControl.container(context)
            c.scope.launch {
                try { CockpitControl.cycleFromOutside(context, TimerKind.Mining); refresh(context) } finally { done.finish() }
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_CYCLE = "com.echelon.eve.cockpit.CYCLE"

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = runCatching { manager.getAppWidgetIds(ComponentName(context, CockpitWidget::class.java)) }.getOrNull() ?: return
            if (ids.isNotEmpty()) render(context, manager, ids)
        }

        /** Keeps every placed widget current for the life of the process. */
        fun watch(context: Context, scope: CoroutineScope) {
            val c = CockpitControl.container(context)
            scope.launch {
                combine(c.fly.timers.timers, c.fly.cockpit.state, c.selectedPilot) { t, _, _ -> t }.collectLatest { all ->
                    while (true) {
                        refresh(context)
                        // Again just after the next end, so the countdown turns into the following timer.
                        val next = TimerBoard.of(all.values, System.currentTimeMillis()).next ?: break
                        delay((next.endsAt - System.currentTimeMillis()).coerceAtLeast(0) + 500)
                    }
                }
            }
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val c = CockpitControl.container(context)
            val pilot = c.selectedPilot.value
            val live = c.fly.cockpit.state.value
            val now = System.currentTimeMillis()
            val text = widgetText(c.fly.timers.timers.value.values, pilot, live.ui.me.takeIf { live.pilot == pilot }, now)
            val views = RemoteViews(context.packageName, R.layout.cockpit_widget).apply {
                setTextViewText(R.id.cockpit_widget_label, text.label)
                setTextViewText(R.id.cockpit_widget_where, text.where)
                setTextViewText(R.id.cockpit_widget_cycle, text.cycle)
                if (text.endsAt != null) {
                    setViewVisibility(R.id.cockpit_widget_clock, View.VISIBLE)
                    setViewVisibility(R.id.cockpit_widget_static, View.GONE)
                    setChronometer(R.id.cockpit_widget_clock, SystemClock.elapsedRealtime() + (text.endsAt - now), null, true)
                    setChronometerCountDown(R.id.cockpit_widget_clock, true)
                } else {
                    setViewVisibility(R.id.cockpit_widget_clock, View.GONE)
                    setChronometer(R.id.cockpit_widget_clock, SystemClock.elapsedRealtime(), null, false)
                    setViewVisibility(R.id.cockpit_widget_static, if (text.frozen != null) View.VISIBLE else View.GONE)
                    setTextViewText(R.id.cockpit_widget_static, text.frozen ?: "")
                }
                setOnClickPendingIntent(R.id.cockpit_widget_cycle, PendingIntent.getBroadcast(context, 0,
                    Intent(context, CockpitWidget::class.java).setAction(ACTION_CYCLE), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                val open = CockpitActivity.pending(context)
                setOnClickPendingIntent(R.id.cockpit_widget_open, open)
                setOnClickPendingIntent(R.id.cockpit_widget_label, open)
            }
            runCatching { manager.updateAppWidget(ids, views) }
        }
    }
}
