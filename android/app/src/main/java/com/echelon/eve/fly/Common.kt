package com.echelon.eve.fly

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.echelon.eve.core.data.PilotState
import com.echelon.eve.core.model.Operation
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.theme.Spacing

/** A Fly screen's frame: a scrolling column with the gutter (Paparazzi's tall pages pass scroll = false). */
@Composable
fun FlyPage(modifier: Modifier = Modifier, scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(Spacing.gutter).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        content()
        Spacer(Modifier.size(Spacing.lg))
    }
}

/** Whose data the screen shows: the two wing pilots as chips. */
@Composable
fun PilotPicker(selected: Pilot, onSelect: (Pilot) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Pilot.entries.forEach { p -> ChoiceChip(p.displayName, selected = p == selected, onClick = { onSelect(p) }) }
    }
}

/**
 * Why one pilot's ESI-backed field has nothing to show, in the web's words: not connected here (and not shared), the
 * scope not granted (Reconnect in Settings), not synced yet, or the sync's error. Null when there is data.
 */
fun missing(state: PilotState?, op: Operation?, what: String, sharedByWing: Boolean = false): String? {
    if (sharedByWing) return null
    val name = state?.name ?: "This pilot"
    return when {
        state == null || (!state.connected && state.private == null) -> "$name does not share $what with the wing yet. They turn it on when connecting on their own phone."
        state.problem != null && state.private == null -> state.problem.message
        op == null -> "Not synced yet. Pull down on the Fly hub to sync."
        op.permission == false -> "$name has not allowed Echelon to read $what. Reconnect them in Settings to grant it."
        op.error != null && !op.hasValue -> "EVE did not answer for $what: ${op.error}"
        !op.hasValue -> "Nothing to show yet."
        else -> null
    }
}
