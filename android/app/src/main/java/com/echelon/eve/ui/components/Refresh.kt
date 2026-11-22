package com.echelon.eve.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshState
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.rememberHaptics
import com.echelon.eve.ui.theme.Echelon

/**
 * Pull-to-refresh with the Formation indicator: a disc that drops in with the pull while its arc plots toward a full
 * ring (a tick haptic when it crosses the threshold), then spins in the brand gradient while [isRefreshing]. The
 * dart in the middle points the way the content will move. Reduced motion keeps the disc but not the spin.
 */
@Composable
fun EchelonRefreshBox(isRefreshing: Boolean, onRefresh: () -> Unit, modifier: Modifier = Modifier, state: PullToRefreshState = rememberPullToRefreshState(), content: @Composable BoxScope.() -> Unit) {
    val haptics = rememberHaptics()
    PullToRefreshBox(isRefreshing, onRefresh = { haptics.heavy(); onRefresh() }, modifier = modifier, state = state,
        indicator = { RefreshIndicator(state, isRefreshing, Modifier.align(Alignment.TopCenter)) }, content = content)
}

@Composable
private fun RefreshIndicator(state: PullToRefreshState, refreshing: Boolean, modifier: Modifier) {
    val c = Echelon.colors
    val haptics = rememberHaptics()
    val crossed by remember(state) { derivedStateOf { state.distanceFraction >= 1f } }
    LaunchedEffect(crossed) { if (crossed && !refreshing) haptics.tick() }
    val spin: State<Float> = if (refreshing && !Echelon.reduceMotion) rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "spin")
    else remember { mutableFloatStateOf(0f) }
    val brand = c.brand
    Box(
        modifier.graphicsLayer {
            val f = state.distanceFraction.coerceIn(0f, 1.6f)
            translationY = (f * 72.dp.toPx()) - 44.dp.toPx()
            alpha = (f * 2f).coerceIn(0f, 1f)
            val s = .7f + .3f * f.coerceAtMost(1f); scaleX = s; scaleY = s
        }.size(40.dp).clip(CircleShape).background(c.surface2).border(1.dp, c.lineStrong, CircleShape)
            .semantics { if (refreshing) contentDescription = "Refreshing" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(26.dp)) {
            val w = 2.5.dp.toPx()
            val arc = Size(size.width - w, size.height - w)
            val f = state.distanceFraction.coerceIn(0f, 1f)
            val sweep = if (refreshing) 110f else 340f * f
            rotate(spin.value) {
                drawArc(Brush.sweepGradient(brand + brand.first(), center), -90f, sweep, false, Offset(w / 2, w / 2), arc, style = Stroke(w, cap = StrokeCap.Round))
            }
            val d = size.width * .32f; val cx = center.x; val cy = center.y
            drawPath(Path().apply { moveTo(cx, cy + d * .9f); lineTo(cx + d * .7f, cy - d * .6f); lineTo(cx, cy - d * .25f); lineTo(cx - d * .7f, cy - d * .6f); close() }, c.accentStrong.copy(alpha = .9f))
        }
    }
}
