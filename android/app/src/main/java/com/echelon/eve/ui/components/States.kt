package com.echelon.eve.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

/** The skeleton shimmer (.skel): a band of surface-3 sweeping across surface-2. Reduced motion holds it still. */
fun Modifier.shimmer(): Modifier = composed {
    val c = Echelon.colors
    val reduced = Echelon.reduceMotion
    val x = if (reduced) .5f else rememberInfiniteTransition(label = "shimmer").animateFloat(-1f, 2f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "sweep").value
    drawBehind {
        val w = size.width
        drawRect(c.surface2)
        if (!reduced) drawRect(Brush.linearGradient(listOf(c.surface2, c.surface3, c.surface2), start = Offset(w * x - w * .2f, 0f), end = Offset(w * x + w * .2f, 0f)))
    }
}

/** A block of skeleton rows while a list loads (widths step down like the web's .skel-rows). */
@Composable
fun SkeletonRows(modifier: Modifier = Modifier, rows: Int = 4, height: Dp = 40.dp, label: String? = "Loading…") {
    Column(modifier.semantics { contentDescription = label ?: "Loading" }, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (label != null) Text(label, style = Echelon.type.label, color = Echelon.colors.textMuted)
        val widths = listOf(1f, 1f, .92f, .84f, .7f)
        repeat(rows) { i -> Box(Modifier.fillMaxWidth(widths[i % widths.size]).height(height).clip(RoundedCornerShape(Radii.control)).shimmer()) }
    }
}

/** Nothing to show (.empty): a dashed box with a line of plain copy and an optional action. */
@Composable
fun EmptyState(message: String, modifier: Modifier = Modifier, title: String? = null, icon: ImageVector? = null, action: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    Column(modifier.fillMaxWidth().dashedBorder().padding(horizontal = Spacing.lg, vertical = Spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (icon != null) Icon(icon, null, tint = c.textFaint)
        if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, color = c.text, textAlign = TextAlign.Center)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = c.textMuted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

/**
 * Something failed (.state--error). The words and the fix differ by cause, like the web's sync line: an expired sign-in
 * offers Reconnect, an outage offers Retry and says how old the data on screen is.
 */
@Composable
fun ErrorState(title: String, message: String, modifier: Modifier = Modifier, tone: Tone = Tone.Danger, action: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.panel)
    Column(modifier.fillMaxWidth().clip(shape).background(tone.soft()).border(1.dp, tone.color().copy(alpha = .4f), shape).padding(Spacing.xl).semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(EchelonIcons.Alert, null, tint = tone.color())
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.text)
        }
        Text(message, style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        action?.invoke()
    }
}

private fun Modifier.dashedBorder(): Modifier = composed {
    val color = Echelon.colors.lineStrong
    drawBehind {
        val r = Radii.panel.toPx()
        drawRoundRect(color, cornerRadius = androidx.compose.ui.geometry.CornerRadius(r), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))))
    }
}
