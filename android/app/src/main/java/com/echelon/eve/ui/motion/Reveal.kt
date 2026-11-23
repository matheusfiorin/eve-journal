package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion

// Arrivals that are not entrances.
//  - develop: content that replaces a skeleton is "developed" top to bottom behind a bright scanline (the skeleton's
//    own shimmer, finishing its pass), while the container's height morphs from the skeleton's to the content's
//    (LoadingCrossfade). No pop: the rows appear where the bars were.
//  - parallaxHeader: a screen's hero or header panel drifts up at half the scroll speed, shrinks a hair and fades as
//    the content scrolls over it. Read in the draw phase only (graphicsLayer), so scrolling never recomposes.
// Reduced motion: develop becomes a plain fade (no scanline), parallax stays put. Screenshots show the end state.

/** The develop's clip line at [p] (0–1): the fraction of the height already shown. Pure, for tests. */
fun developLine(p: Float): Float = Easings.emphasized.transform(p.coerceIn(0f, 1f))

/** Develops this element in once, on first composition: a clip that opens downward behind a scanline in [color]. */
fun Modifier.develop(color: Color? = null): Modifier = composed {
    val reduced = LocalReduceMotion.current
    val still = LocalInspectionMode.current
    val line = color ?: Echelon.colors.accent
    val anim = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) { anim.animateTo(1f, tween(if (reduced) Durations.short else Durations.develop)) }
    if (reduced) return@composed graphicsLayer { alpha = anim.value }
    drawWithContent {
        val p = anim.value
        if (p >= 1f) { drawContent(); return@drawWithContent }
        val y = size.height * developLine(p)
        clipRect(bottom = y) { this@drawWithContent.drawContent() }
        val fade = 1f - p
        drawRect(line.copy(alpha = .10f * fade), topLeft = Offset(0f, (y - 18f * density).coerceAtLeast(0f)), size = size.copy(height = 18f * density))
        drawLine(line.copy(alpha = .7f * fade), Offset(0f, y), Offset(size.width, y), 1.5f * density)
    }
}

/** Parallax for a header that is the first row of a lazy list. */
fun Modifier.parallaxHeader(list: LazyListState, depth: Float = .5f): Modifier = composed {
    if (LocalReduceMotion.current) return@composed this
    graphicsLayer {
        val off = if (list.firstVisibleItemIndex == 0) list.firstVisibleItemScrollOffset.toFloat() else size.height
        parallax(off, size.height, depth)
    }
}

/** Parallax for a header at the top of a scrolling column. */
fun Modifier.parallaxHeader(scroll: ScrollState, depth: Float = .5f): Modifier = composed {
    if (LocalReduceMotion.current) return@composed this
    graphicsLayer { parallax(scroll.value.toFloat().coerceAtMost(size.height), size.height, depth) }
}

private fun androidx.compose.ui.graphics.GraphicsLayerScope.parallax(off: Float, height: Float, depth: Float) {
    val f = parallaxFade(off, height)
    translationY = off * depth
    alpha = f
    val s = .97f + .03f * f
    scaleX = s; scaleY = s
}

/** How visible a header scrolled by [offset] of its [height] is: gone by 5/6 of its height. Pure, for tests. */
fun parallaxFade(offset: Float, height: Float): Float = (1f - offset / height.coerceAtLeast(1f) * 1.2f).coerceIn(0f, 1f)
