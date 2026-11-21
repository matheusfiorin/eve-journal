package com.echelon.eve.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.theme.Echelon
import kotlinx.coroutines.delay

/** The wall clock, ticking once a second while composed. Tests and previews pass a fixed [now]. */
@Composable
fun rememberNow(now: Long? = null, periodMillis: Long = 1000): Long {
    if (now != null) return now
    var t by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(periodMillis) { while (true) { delay(periodMillis - System.currentTimeMillis() % periodMillis); t = System.currentTimeMillis() } }
    return t
}

/**
 * A countdown to [endsAt] (epoch ms): "4:05" in tabular figures, each changed digit rolling up. With [total] it adds a
 * progress ring around it; [warnUnderMillis] turns it amber, and at zero it reads [doneLabel] in the ok tone.
 */
@Composable
fun Countdown(
    endsAt: Long,
    modifier: Modifier = Modifier,
    now: Long? = null,
    label: String? = null,
    total: Long? = null,
    warnUnderMillis: Long = 60_000,
    doneLabel: String = "Done",
    style: TextStyle = Echelon.type.numLarge,
) {
    val t = rememberNow(now)
    val remaining = endsAt - t
    val c = Echelon.colors
    val tone = when { remaining <= 0 -> Tone.Ok; remaining <= warnUnderMillis -> Tone.Warn; else -> Tone.Neutral }
    val color = if (tone == Tone.Neutral) c.text else tone.color()
    val text = if (remaining <= 0) doneLabel else clock(remaining)
    val spoken = if (remaining <= 0) doneLabel else "${duration(remaining / 1000.0)} left"
    val body: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.semantics(mergeDescendants = true) { contentDescription = spoken }) { RollingText(text, style.copy(color = color)) }
            if (label != null) Text(label, style = Echelon.type.label, color = c.textMuted)
        }
    }
    if (total != null && total > 0) ProgressRing(1f - remaining.coerceIn(0, total).toFloat() / total, modifier, size = androidx.compose.ui.unit.Dp(120f), color = if (tone == Tone.Neutral) c.accent else tone.color()) { body() }
    else Column(modifier, verticalArrangement = Arrangement.Center) { body() }
}

/** Text whose characters roll vertically when they change (only the changed ones move). Reduced motion swaps in place. */
@Composable
fun RollingText(text: String, style: TextStyle) {
    val reduced = Echelon.reduceMotion
    Row {
        text.forEachIndexed { i, ch ->
            androidx.compose.runtime.key(text.length - i) {
                AnimatedContent(ch, transitionSpec = {
                    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (slideInVertically(tween(220)) { -it / 2 } + fadeIn(tween(220))) togetherWith (slideOutVertically(tween(220)) { it / 2 } + fadeOut(tween(160)))
                }, label = "digit") { Text(it.toString(), style = style) }
            }
        }
    }
}
