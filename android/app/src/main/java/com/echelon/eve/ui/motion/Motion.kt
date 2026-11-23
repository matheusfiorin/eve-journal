package com.echelon.eve.ui.motion

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.unit.IntOffset
import androidx.navigation.NavBackStackEntry
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.LocalReduceMotion

// Motion specs. Springs for anything a finger moves or that moves between places; tweens (tokens.css durations and
// easings) for fades. Every spec has a reduced form: with reduced motion things appear in place, without travel.

object Springs {
    /** Navigation and container transforms: settles quickly, no bounce. */
    fun <T> nav(): FiniteAnimationSpec<T> = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 500f)
    /** Selection indicators and chips: a slight overshoot, like the web's lock-on. */
    fun <T> select(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow)
    /** Numbers and progress: smooth, no overshoot. */
    fun <T> value(): FiniteAnimationSpec<T> = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow)
    /** Press feedback: stiff and quick, a touch of bounce on release. */
    fun <T> press(): FiniteAnimationSpec<T> = spring(dampingRatio = .6f, stiffness = Spring.StiffnessHigh)
    /** Something arriving that should feel alive (a tab icon popping, a badge appearing): a visible bounce. */
    fun <T> pop(): FiniteAnimationSpec<T> = spring(dampingRatio = .45f, stiffness = Spring.StiffnessMediumLow)
    /** Entrances: settles without overshoot, a little slower than nav. */
    fun <T> enter(): FiniteAnimationSpec<T> = spring(dampingRatio = .82f, stiffness = 320f)
}

/** Picks the reduced spec when the user asked for less motion. */
@Composable
@ReadOnlyComposable
fun <T> motionSpec(full: FiniteAnimationSpec<T>, reduced: FiniteAnimationSpec<T> = snap()): FiniteAnimationSpec<T> =
    if (LocalReduceMotion.current) reduced else full

fun <T> fade(duration: Int = Durations.short): FiniteAnimationSpec<T> = tween(duration, easing = Easings.out)

/**
 * Transitions for NavHost. Forward pushes slide in a fifth of the width on a spring while fading, back pops reverse it,
 * and the predictive back gesture scrubs the same animation. Reduced motion keeps only a short cross-fade.
 */
class NavMotion(private val reduced: Boolean) {
    private val slide = spring<IntOffset>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 500f)
    val enter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) fadeIn(fade(Durations.quick)) else slideInHorizontally(slide) { it / 5 } + fadeIn(fade())
    }
    val exit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) fadeOut(fade(Durations.quick)) else slideOutHorizontally(slide) { -it / 10 } + fadeOut(fade(Durations.quick))
    }
    val popEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) fadeIn(fade(Durations.quick)) else slideInHorizontally(slide) { -it / 10 } + fadeIn(fade())
    }
    val popExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) fadeOut(fade(Durations.quick)) else slideOutHorizontally(slide) { it / 5 } + fadeOut(fade(Durations.quick)) + scaleOut(targetScale = .96f)
    }
    /**
     * Switching destinations is a warp (Warp.kt): the old one rushes past the camera (grows to 108 % and fades), the
     * new one decelerates out of warp (from 92 % on a soft spring) while Modifier.warp draws the streaks. No direction:
     * the tabs are peers. Reduced motion: a short cross-fade.
     */
    val tabEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) fadeIn(fade(Durations.quick)) else fadeIn(tween(Durations.medium, delayMillis = 90, easing = Easings.emphasized)) + scaleIn(spring(dampingRatio = .9f, stiffness = 420f), initialScale = .92f)
    }
    /** A hub giving way to one of its own screens: it only fades, under the card's container transform. */
    val underCard: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = { fadeOut(fade(Durations.quick)) }
    val tabExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) fadeOut(fade(Durations.quick)) else fadeOut(tween(Durations.short, easing = Easings.into)) + scaleOut(tween(Durations.short, easing = Easings.into), targetScale = 1.08f)
    }
}
