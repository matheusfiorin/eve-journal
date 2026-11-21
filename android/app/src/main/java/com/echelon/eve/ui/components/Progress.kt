package com.echelon.eve.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.theme.Echelon

/** A 6 dp bar on surface-3 (the web's progress): animates to [progress] (0–1) on a spring, with a soft glow on the fill. */
@Composable
fun ProgressBar(progress: Float, modifier: Modifier = Modifier, color: Color = Echelon.colors.accent, track: Color = Echelon.colors.surface3, height: Dp = 6.dp) {
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), motionSpec(Springs.value()), label = "progress")
    Canvas(modifier.fillMaxWidth().height(height).semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f) }) {
        val r = CornerRadius(size.height / 2)
        drawRoundRect(track, cornerRadius = r)
        if (p > 0f) {
            drawRoundRect(color.copy(alpha = .25f), topLeft = Offset(0f, -2f), size = Size(size.width * p, size.height + 4f), cornerRadius = CornerRadius(size.height))
            drawRoundRect(color, size = Size(size.width * p, size.height), cornerRadius = r)
        }
    }
}

/**
 * A ring (skill training, fuel left, cycle progress): [progress] 0–1 drawn clockwise from the top, with [content] in the
 * middle (a figure or a countdown).
 */
@Composable
fun ProgressRing(progress: Float, modifier: Modifier = Modifier, size: Dp = 64.dp, stroke: Dp = 5.dp, color: Color = Echelon.colors.accent, track: Color = Echelon.colors.surface3, content: @Composable BoxScope.() -> Unit = {}) {
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), motionSpec(Springs.value()), label = "ring")
    Box(modifier.size(size).semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f) }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val w = stroke.toPx(); val inset = w / 2; val arc = Size(this.size.width - w, this.size.height - w)
            drawArc(track, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            if (p > 0f) drawArc(color, -90f, 360f * p, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        content()
    }
}
