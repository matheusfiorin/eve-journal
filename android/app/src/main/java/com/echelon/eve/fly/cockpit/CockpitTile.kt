package com.echelon.eve.fly.cockpit

import android.graphics.drawable.Icon
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.fly.timers.running
import com.echelon.eve.ui.format.clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** The tile's state for the flying pilot: active while their mining cycle runs, its time left as the subtitle. */
data class TileText(val active: Boolean, val subtitle: String)

fun tileText(timers: Collection<WingTimer>, pilot: Pilot?, now: Long): TileText {
    if (pilot == null) return TileText(false, "Choose a pilot")
    val q = QuickTimer.of(timers, pilot, TimerKind.Mining)
    val t = q.reuse
    return when {
        t != null && t.running(now) -> TileText(true, "${clock(t.remaining(now))} left")
        t != null && t.pausedAt != null -> TileText(false, "Paused · ${clock(t.remaining(now))}")
        t != null -> TileText(false, "Tap: restart ${clock(q.durationMs)}")
        else -> TileText(false, "Tap: start ${clock(q.durationMs)}")
    }
}

/**
 * Quick Settings tile "Mining cycle": one tap from the shade (over the game, on a second screen, on a locked phone's
 * shade) restarts the flying pilot's mining timer at the length they use, or starts one. While the shade is open the
 * subtitle counts down. A long press opens the cockpit (CockpitActivity takes ACTION_QS_TILE_PREFERENCES).
 */
class CockpitTile : TileService() {
    private var scope: CoroutineScope? = null
    private var ticker: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).also { scope = it }
        ticker = s.launch {
            while (isActive) { render(); delay(1_000) }
        }
    }

    override fun onStopListening() {
        scope?.cancel(); scope = null; ticker = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        val c = CockpitControl.container(this)
        c.scope.launch {
            CockpitControl.cycleFromOutside(applicationContext, TimerKind.Mining)
            render()
            CockpitWidget.refresh(applicationContext)
        }
    }

    private fun render() {
        val tile = qsTile ?: return
        val c = CockpitControl.container(this)
        val text = tileText(c.fly.timers.timers.value.values, c.selectedPilot.value, System.currentTimeMillis())
        tile.label = getString(R.string.cockpit_tile_label)
        tile.icon = Icon.createWithResource(this, R.drawable.cockpit_tile_icon)
        tile.state = if (text.active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = text.subtitle
        tile.updateTile()
    }
}
