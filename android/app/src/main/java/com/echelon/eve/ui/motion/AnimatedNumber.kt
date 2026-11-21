package com.echelon.eve.ui.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion

/**
 * A number that rolls from its previous value to [value] over 600 ms with an ease-out cubic, like the web's countUps().
 * The first composition starts from [from] (0 by default, so a dashboard "counts up" once); reduced motion jumps.
 * [text] turns the animated value into the label, [format] with [kind] by default.
 */
@Composable
fun AnimatedNumber(
    value: Double?,
    modifier: Modifier = Modifier,
    kind: Kind = Kind.Count,
    from: Double = 0.0,
    style: TextStyle = Echelon.type.num,
    color: Color = Color.Unspecified,
    text: (Double) -> String = { format(it, kind) },
) {
    if (value == null || !value.isFinite()) { Text("—", modifier, style = style, color = color); return }
    val reduced = LocalReduceMotion.current || androidx.compose.ui.platform.LocalInspectionMode.current // previews and screenshots show the end state
    val anim = remember { Animatable(if (reduced) value.toFloat() else from.toFloat()) }
    LaunchedEffect(value, reduced) {
        if (reduced) anim.snapTo(value.toFloat())
        else anim.animateTo(value.toFloat(), tween(600, easing = { 1 - (1 - it) * (1 - it) * (1 - it) }))
    }
    // The end state prints the exact value, not the float the animation carried.
    val shown = if (reduced || anim.value == value.toFloat()) value else anim.value.toDouble()
    Text(text(shown), modifier, style = LocalTextStyle.current.merge(style), color = color, maxLines = 1)
}
