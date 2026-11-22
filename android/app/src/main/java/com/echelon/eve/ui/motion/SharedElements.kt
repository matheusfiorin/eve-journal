package com.echelon.eve.ui.motion

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Rect
import com.echelon.eve.ui.theme.LocalReduceMotion
import com.echelon.eve.ui.theme.Radii
import androidx.compose.foundation.shape.RoundedCornerShape

// List → detail motion. The shell wraps its NavHost in [SharedElementsRoot], and each destination's NavHost entry
// provides its AnimatedVisibilityScope with [ProvideNavScope]. A list row and its detail screen then mark the same
// element with the same key:
//
//   ListRow(modifier = Modifier.sharedContainer("system-$id"), …)      // in the list
//   EchelonCard(modifier = Modifier.sharedContainer("system-$id"), …)  // the detail's header card
//
// sharedContainer() morphs the bounds (a container transform); sharedHero() moves one element that looks the same
// in both places, such as a portrait or a title. Both fall back to nothing outside a NavHost (previews, Paparazzi) and
// under reduced motion.

val LocalSharedTransitionScope = compositionLocalOf<SharedTransitionScope?> { null }
val LocalNavAnimatedScope = compositionLocalOf<AnimatedVisibilityScope?> { null }

@Composable
fun SharedElementsRoot(content: @Composable () -> Unit) {
    SharedTransitionLayout { CompositionLocalProvider(LocalSharedTransitionScope provides this) { content() } }
}

@Composable
fun ProvideNavScope(scope: AnimatedVisibilityScope, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalNavAnimatedScope provides scope, content = content)

private val boundsSpring = BoundsTransform { _: Rect, _: Rect -> spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 380f) }

/** A container transform between two places that show the same thing (a row that opens into a detail card). */
fun Modifier.sharedContainer(key: Any): Modifier = composed {
    val shared = LocalSharedTransitionScope.current
    val nav = LocalNavAnimatedScope.current
    if (shared == null || nav == null || LocalReduceMotion.current) this
    else with(shared) {
        this@composed.sharedBounds(rememberSharedContentState(key), nav, boundsTransform = boundsSpring,
            resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds,
            clipInOverlayDuringTransition = OverlayClip(RoundedCornerShape(Radii.panel)))
    }
}

/**
 * Text that changes style on the way (a hub card's title becoming the screen title): the bounds fly across and the two
 * texts cross-fade, each scaled to the bounds instead of re-wrapping.
 */
fun Modifier.sharedText(key: Any): Modifier = composed {
    val shared = LocalSharedTransitionScope.current
    val nav = LocalNavAnimatedScope.current
    if (shared == null || nav == null || LocalReduceMotion.current) this
    else with(shared) {
        this@composed.sharedBounds(rememberSharedContentState(key), nav, boundsTransform = boundsSpring,
            resizeMode = SharedTransitionScope.ResizeMode.scaleToBounds(androidx.compose.ui.layout.ContentScale.FillHeight, androidx.compose.ui.Alignment.CenterStart))
    }
}

/** One element that flies from one screen to the next unchanged (a portrait, an icon, a title). */
fun Modifier.sharedHero(key: Any): Modifier = composed {
    val shared = LocalSharedTransitionScope.current
    val nav = LocalNavAnimatedScope.current
    if (shared == null || nav == null || LocalReduceMotion.current) this
    else with(shared) { this@composed.sharedElement(rememberSharedContentState(key), nav, boundsTransform = boundsSpring) }
}
