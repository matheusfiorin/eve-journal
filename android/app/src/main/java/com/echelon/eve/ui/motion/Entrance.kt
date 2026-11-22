package com.echelon.eve.ui.motion

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.theme.Durations
import com.echelon.eve.ui.theme.LocalReduceMotion
import kotlinx.coroutines.delay

// Entrances and press feedback: the two motions every screen gets for free.
//
// Staggered entrance. The shell wraps each hub and each sub-screen in a [StaggerRoot]. Inside one, every
// Modifier.entrance() (EchelonCard, PrimaryPanel, SectionHeader, StatTile rows, empty and error states already carry it)
// takes the next slot and rises 16 dp into place while fading in, [Durations.stagger] ms after the one before. Only
// what composes in the root's first [StaggerClock.WINDOW_MS] animates: rows that scroll in later, and a screen you come
// back to, are simply there. Reduced motion and screenshots (inspection mode) render everything in place.

/** Hands out entrance slots to the elements of one screen while its entrance window is open. */
class StaggerClock internal constructor(private val active: Boolean, private val startedAt: Long) {
    private var next = 0
    /** True while elements composing now should still animate in. */
    val open: Boolean get() = active && SystemClock.uptimeMillis() - startedAt < WINDOW_MS
    /** The next slot (capped, so a long screen's last cards don't wait). */
    fun take(): Int = (next++).coerceAtMost(MAX_SLOTS)

    companion object {
        const val WINDOW_MS = 700L
        const val MAX_SLOTS = 10
        /** The delay of a slot: linear, then capped. Pure, for tests. */
        fun delayOf(slot: Int): Long = slot.coerceIn(0, MAX_SLOTS).toLong() * Durations.stagger
    }
}

val LocalStagger = staticCompositionLocalOf<StaggerClock?> { null }

/**
 * Opens a staggered entrance for [content]. [key] identifies the screen: the entrance plays once per key and not again
 * when the user comes back to it (the "played" flag is saved with the back stack).
 */
@Composable
fun StaggerRoot(key: Any = Unit, content: @Composable () -> Unit) {
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    var played by rememberSaveable(key.toString()) { mutableStateOf(false) }
    val clock = remember(key) { StaggerClock(active = !played && !still, startedAt = SystemClock.uptimeMillis()) }
    LaunchedEffect(key) { delay(StaggerClock.WINDOW_MS); played = true }
    CompositionLocalProvider(LocalStagger provides clock, content = content)
}

/** Stops entrances below this point (a card's own content enters with the card, not after it). */
@Composable
fun NoEntrance(content: @Composable () -> Unit) = CompositionLocalProvider(LocalStagger provides null, content = content)

/**
 * Fades and lifts this element into place: in the next slot of the nearest [StaggerRoot], or at [index] (× the stagger
 * delay) when given. Outside a root, only an explicit [index] animates. Costs one graphics layer while it plays.
 */
fun Modifier.entrance(index: Int? = null, distance: androidx.compose.ui.unit.Dp = 16.dp): Modifier = composed {
    val clock = LocalStagger.current
    val still = LocalReduceMotion.current || LocalInspectionMode.current
    val slot = remember {
        when {
            still -> null
            clock != null -> if (clock.open) index ?: clock.take() else null
            else -> index
        }
    }
    if (slot == null) return@composed this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(StaggerClock.delayOf(slot))
        progress.animateTo(1f, spring(dampingRatio = .82f, stiffness = 320f))
    }
    graphicsLayer {
        val p = progress.value
        alpha = p.coerceIn(0f, 1f)
        translationY = (1f - p) * distance.toPx()
    }
}

/**
 * Press and hover feedback for anything clickable: it sinks to [pressedScale] on a stiff spring while pressed, and
 * lifts a hair on hover (mouse, stylus). Pass the same [interactionSource] as the clickable. Reduced motion keeps
 * only the ripple.
 */
fun Modifier.pressScale(interactionSource: InteractionSource, pressedScale: Float = .97f): Modifier = composed {
    if (LocalReduceMotion.current) return@composed this
    val pressed by interactionSource.collectIsPressedAsState()
    val hovered by interactionSource.collectIsHoveredAsState()
    val target = when { pressed -> pressedScale; hovered -> 1.01f; else -> 1f }
    val scale by animateFloatAsState(target, spring(dampingRatio = .6f, stiffness = if (pressed) Spring.StiffnessHigh else Spring.StiffnessMedium), label = "press")
    graphicsLayer { scaleX = scale; scaleY = scale }
}
