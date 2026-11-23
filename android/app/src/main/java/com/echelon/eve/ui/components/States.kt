package com.echelon.eve.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.motion.StaggerRoot
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.develop
import com.echelon.eve.ui.motion.Springs
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.ColumnScope
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape
import kotlin.math.PI
import kotlin.math.sin

/**
 * The skeleton shimmer: a band of light sweeping diagonally across surface-2, faintly tinted with the accent. Reduced
 * motion (and screenshots) hold it still.
 */
fun Modifier.shimmer(): Modifier = composed {
    val c = Echelon.colors
    val still = Echelon.reduceMotion || LocalInspectionMode.current
    val x = if (still) -1f else rememberInfiniteTransition(label = "shimmer").animateFloat(-1f, 2f, infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Restart), label = "sweep").value
    val band = c.surface3.copy(alpha = 1f)
    val tint = c.accent.copy(alpha = .06f)
    drawBehind {
        val w = size.width
        drawRect(c.surface2)
        if (x > -1f) drawRect(Brush.linearGradient(listOf(c.surface2, band, tint, c.surface2), start = Offset(w * x - w * .25f, 0f), end = Offset(w * x + w * .25f, size.height * 2)))
    }
}

/** A block of skeleton rows while a list loads: a leading square and two text bars per row, widths stepping down. */
@Composable
fun SkeletonRows(modifier: Modifier = Modifier, rows: Int = 4, height: Dp = 40.dp, label: String? = "Loading…") {
    Column(modifier.semantics { contentDescription = label ?: "Loading" }, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (label != null) Text(label, style = Echelon.type.label, color = Echelon.colors.textMuted)
        val widths = listOf(1f, .92f, .84f, .7f, .96f)
        repeat(rows) { i ->
            Row(Modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                if (height >= 32.dp) Box(Modifier.size(height).clip(RoundedCornerShape(Radii.control)).shimmer())
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val bar = if (height >= 32.dp) 12.dp else height
                    Box(Modifier.fillMaxWidth(widths[i % widths.size]).height(bar).clip(RoundedCornerShape(Radii.chip)).shimmer())
                    if (height >= 32.dp) Box(Modifier.fillMaxWidth(widths[i % widths.size] * .55f).height(10.dp).clip(RoundedCornerShape(Radii.chip)).shimmer())
                }
            }
        }
    }
}

/**
 * Skeleton → content, as a morph rather than a pop: while [loading] it shows [skeleton]; then the box's height springs
 * from the skeleton's to the content's while [content] develops in top to bottom behind a scanline (Modifier.develop),
 * and its cards and headers play their staggered entrance (a fresh [StaggerRoot]). Reduced motion fades, without the
 * scanline or the height spring; screenshots show the state they are given.
 */
@Composable
fun LoadingCrossfade(loading: Boolean, modifier: Modifier = Modifier, skeleton: @Composable () -> Unit = { SkeletonRows() }, content: @Composable () -> Unit) {
    val developing = rememberWasLoading(loading)
    val reduced = Echelon.reduceMotion
    Box(modifier.then(if (reduced) Modifier else Modifier.animateContentSize(Springs.nav()))) {
        if (loading) skeleton()
        else Box(if (developing) Modifier.develop() else Modifier) { StaggerRoot("loaded") { content() } }
    }
}

/** True once [loading] has been true while composed: the content that follows should develop in, not just appear. */
@Composable
fun rememberWasLoading(loading: Boolean): Boolean {
    val was = remember { booleanArrayOf(false) }
    if (loading) was[0] = true
    return was[0]
}

/**
 * The results that replace a skeleton on a page (Explore, Trade, the corp screens): a column spaced like the page that
 * develops in when [developing] (see [rememberWasLoading]) and simply appears otherwise.
 */
@Composable
fun Developed(developing: Boolean, modifier: Modifier = Modifier, spacing: Dp = Spacing.lg, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().then(if (developing) Modifier.develop() else Modifier), verticalArrangement = Arrangement.spacedBy(spacing), content = content)
}

/**
 * Nothing to show: a dashed box, the icon on a small Formation tile that floats gently (still with reduced motion and
 * in screenshots), a title, a line of plain copy and an optional action.
 */
@Composable
fun EmptyState(message: String, modifier: Modifier = Modifier, title: String? = null, icon: ImageVector? = null, action: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    Column(modifier.entrance().fillMaxWidth().dashedBorder().padding(horizontal = Spacing.lg, vertical = Spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (icon != null) {
            val still = Echelon.reduceMotion || LocalInspectionMode.current
            val t: State<Float> = if (still) remember { mutableFloatStateOf(0f) } else rememberInfiniteTransition(label = "float").animateFloat(0f, 1f, infiniteRepeatable(tween(3200, easing = LinearEasing)), label = "bob")
            val shape = formationShape(cut = 8.dp, radius = Radii.control)
            Box(Modifier.graphicsLayer { translationY = sin(t.value * 2 * PI.toFloat()) * 3.dp.toPx() }.size(44.dp).clip(shape).background(c.accentSoft).border(1.dp, c.accentLine, shape), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(22.dp), tint = c.accentStrong)
            }
        }
        if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, color = c.text, textAlign = TextAlign.Center)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = c.textMuted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

/**
 * Something failed. The words and the fix differ by cause, like the web's sync line: an expired sign-in offers
 * Reconnect, an outage offers Retry and says how old the data on screen is. A bar in the tone runs down the start edge.
 */
@Composable
fun ErrorState(title: String, message: String, modifier: Modifier = Modifier, tone: Tone = Tone.Danger, action: (@Composable () -> Unit)? = null) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.panel)
    val bar = tone.color()
    Column(modifier.entrance().fillMaxWidth().clip(shape).background(tone.soft()).border(1.dp, tone.color().copy(alpha = .4f), shape)
        .drawBehind { drawRect(bar, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }
        .padding(Spacing.xl).semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
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
