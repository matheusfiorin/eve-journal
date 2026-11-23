package com.echelon.eve.fly.cockpit

import android.app.Activity
import android.graphics.drawable.Icon
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import com.echelon.eve.R
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fly
import com.echelon.eve.fly.timers.TimerKind
import com.echelon.eve.ui.format.clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** The "Gas timer" tile for the flying pilot: active while a gas timer counts, with what is left as the subtitle. */
fun gasTileText(timers: Collection<WingTimer>, pilot: Pilot?, here: Long?, now: Long): TileText {
    if (pilot == null) return TileText(false, "Choose a pilot")
    val t = CockpitControl.gasTimer(timers, pilot, now)
    return when {
        t == null -> TileText(false, if (CockpitControl.gasKindFor(here) == TimerKind.Sleeper) "Tap: start Sleeper timer" else "Tap: start gas timer")
        t.pausedAt != null -> TileText(false, "Paused · ${clock(t.remaining(now))}")
        TimerKind.of(t.kind) == TimerKind.Sleeper -> TileText(true, "Sleepers in ${clock(t.remaining(now))} · tap to stop")
        else -> TileText(true, "${clock(t.remaining(now))} left · tap to stop")
    }
}

/**
 * Quick Settings tile "Gas timer": one tap from the shade starts the Sleeper timer (wormhole space, or when the
 * pilot's place is not known) or the known-space gas timer; while it runs the tile shows the time left and a tap stops it.
 */
class GasTile : TileService() {
    private var scope: CoroutineScope? = null
    private var ticker: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).also { scope = it }
        ticker = s.launch { while (isActive) { render(); delay(1_000) } }
    }

    override fun onStopListening() {
        scope?.cancel(); scope = null; ticker = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        val c = CockpitControl.container(this)
        c.scope.launch {
            val pilot = CockpitControl.flying(c)
            if (pilot != null) CockpitControl.toggleGas(c.fly.timers, pilot)
            render()
            CockpitWidget.refresh(applicationContext)
        }
    }

    private fun render() {
        val tile = qsTile ?: return
        val c = CockpitControl.container(this)
        val pilot = c.selectedPilot.value
        val text = gasTileText(c.fly.timers.timers.value.values, pilot, pilot?.let { c.fly.timers.here(it)?.id }, System.currentTimeMillis())
        tile.label = getString(R.string.gas_tile_label)
        tile.icon = Icon.createWithResource(this, R.drawable.gas_tile_icon)
        tile.state = if (text.active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = text.subtitle
        tile.updateTile()
    }
}

/** The "Gas timer" and "Mining cycle" launcher shortcuts: do it, say what happened in a toast, and leave. No screen. */
class ShortcutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val c = CockpitControl.container(this)
        val action = intent?.action
        c.scope.launch {
            val said = when (action) {
                ACTION_GAS -> CockpitControl.flying(c)?.let { CockpitControl.toggleGas(c.fly.timers, it) } ?: "Open Echelon and choose who is flying"
                ACTION_MINING -> CockpitControl.cycleFromOutside(applicationContext, TimerKind.Mining)
                else -> null
            }
            said?.let { Toast.makeText(applicationContext, it, Toast.LENGTH_SHORT).show() }
            CockpitWidget.refresh(applicationContext)
            finish()
        }
    }

    companion object {
        const val ACTION_GAS = "com.echelon.eve.SHORTCUT_GAS"
        const val ACTION_MINING = "com.echelon.eve.SHORTCUT_MINING"
    }
}
