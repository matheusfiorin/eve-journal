package com.echelon.eve.plan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

/** A solar system as the Plan adapters in android/js/plan return it. */
@Serializable data class Sys(val id: Long, val name: String, val sec: Double, val region: Long)

/** A Plan screen's frame: a scrolling column with the gutter (Paparazzi's tall pages pass scroll = false). */
@Composable
fun PlanPage(modifier: Modifier = Modifier, scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(Spacing.gutter).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        content()
        Spacer(Modifier.size(Spacing.lg))
    }
}
