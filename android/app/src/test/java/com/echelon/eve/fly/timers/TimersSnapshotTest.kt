package com.echelon.eve.fly.timers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import org.junit.Rule
import org.junit.Test

/** The timers by place: the board, the radar and horizon, the form and the hub card. A fixed `now` keeps them still. */
class TimersSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val now = TimerFixtures.NOW
    private val f = TimerFixtures

    @Test fun board() = paparazzi.echelon {
        TimersScreen(Pilot.Fiofka, f.timers, now, TimerActions(), scroll = false, map = f.map, formOpen = false)
    }

    /** The horizon and the jump radar at full size. */
    @Test fun places() = paparazzi.echelon {
        val jumps = jumpsFrom(f.PERIMETER, f.systems)
        val groups = SystemBoard.of(f.timers, now, f.PERIMETER, f.TAMA, f.systems, jumps)
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            HorizonStrip(f.timers, now, f.systems)
            JumpRadar(groups.first(), radarNodes(groups, f.systems, f.TAMA, jumps), now, Pilot.Decxus)
        }
    }

    /** The first cards at full size: here with a ring opened (its controls), the wingmate's system, the unplaced timers. */
    @Test fun systemCards() = paparazzi.echelon {
        val jumps = jumpsFrom(f.PERIMETER, f.systems)
        val groups = SystemBoard.of(f.timers, now, f.PERIMETER, f.TAMA, f.systems, jumps)
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            groups.take(3).forEach { g ->
                SystemCard(g, Pilot.Fiofka, now, g.systemId?.let { f.systems[it]?.sec }, g.systemId?.let { f.systems[it] }?.let { f.regions[it.region] }, TimerActions(),
                    onAdd = if (g.systemId != null) ({}) else null, onMove = {}, selected = "a", systems = f.systems)
            }
        }
    }

    /** Decxus flying in Tama: their timers are theirs, Fiofka's wear Fiofka's colour, Perimeter is 4 jumps out. */
    @Test fun decxusInTama() = paparazzi.echelon(pilot = PilotColors.Decxus) {
        TimersScreen(Pilot.Decxus, f.timers.filter { it.shared }, now, TimerActions(), scroll = false, formOpen = false, selected = "c",
            map = TimerMap(f.systems, here = f.TAMA, wingmateAt = f.PERIMETER, regionName = { f.regions[it] }))
    }

    /** Nothing running yet: the form open, starting in Perimeter where Fiofka is, and the empty card for here. */
    @Test fun startHere() = paparazzi.echelon {
        TimersScreen(Pilot.Fiofka, emptyList(), now, TimerActions(), scroll = false, map = f.map)
    }

    /** Typing another system: the suggestions, nearest first, with security and jumps. */
    @Test fun formSuggestions() = paparazzi.echelon {
        val jumps = jumpsFrom(f.PERIMETER, f.systems)
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PrimaryPanel { TimerForm(Pilot.Fiofka, f.map, jumps, SystemBoard.of(f.timers, now, f.PERIMETER, f.TAMA, f.systems, jumps), null, onStart = {}, query = "ama") }
        }
    }

    @Test fun hubCard() = paparazzi.echelon {
        Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TimersCard(f.timers, now, f.systems, onOpen = {})
            TimersCard(emptyList(), now, f.systems, onOpen = {})
        }
    }
}
