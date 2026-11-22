package com.echelon.eve.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.echelon.eve.ui.theme.Easings
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.LocalReduceMotion
import com.echelon.eve.ui.theme.Oxanium
import com.echelon.eve.ui.theme.PilotColors

/**
 * The Echelon emblem ("Formation"): Fiofka's dart leading and Decxus's stepped back to the right, in echelon, inside a
 * plotted arc that opens toward their heading, with the Ion → Flare beacon where the arc begins. The same geometry is
 * the launcher icon (res/drawable/ic_launcher_foreground.xml) and the splash. [highlight] dims the other pilot's dart,
 * so the emblem doubles as a "who's flying" mark. With [animate] the formation assembles on first composition: the
 * arc plots itself, the leader then the wingman slide into place, and the beacon lights (skipped with reduced motion
 * and in screenshots).
 */
@Composable
fun Emblem(modifier: Modifier = Modifier, size: Dp = 28.dp, highlight: PilotColors? = null, animate: Boolean = false) {
    val c = Echelon.colors
    val fio = PilotColors.Fiofka.color; val dec = PilotColors.Decxus.color
    val still = !animate || LocalReduceMotion.current || LocalInspectionMode.current
    val t = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(still) { if (!still) t.animateTo(1f, tween(1100, easing = Easings.out)) }
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 32f
        val p = t.value
        fun phase(from: Float, to: Float) = ((p - from) / (to - from)).coerceIn(0f, 1f).let { Easings.emphasized.transform(it) }
        scale(k, k, pivot = Offset.Zero) {
            drawArc(c.lineStrong, 75f, 235f * phase(0f, .55f), false, Offset(2f, 2f), Size(28f, 28f), style = Stroke(1.3f, cap = StrokeCap.Round))
            val lead = phase(.15f, .7f); val wing = phase(.3f, .85f)
            translate(-6f * (1 - lead), 6f * (1 - lead)) {
                drawPath(EmblemPaths.fiofka, (if (highlight == null || highlight == PilotColors.Fiofka) fio else fio.copy(alpha = .35f)).let { it.copy(alpha = it.alpha * lead) })
            }
            translate(-6f * (1 - wing), 6f * (1 - wing)) {
                drawPath(EmblemPaths.decxus, (if (highlight == null || highlight == PilotColors.Decxus) dec else dec.copy(alpha = .35f)).let { it.copy(alpha = it.alpha * wing) })
            }
            val beacon = phase(.7f, 1f)
            if (beacon > 0f) {
                drawCircle(c.flare.copy(alpha = .25f * beacon), 3.4f, Offset(25f, 5.3f))
                drawCircle(Brush.linearGradient(c.brand, Offset(23.5f, 3.8f), Offset(26.5f, 6.8f)), 1.8f * beacon, Offset(25f, 5.3f))
            }
        }
    }
}

/** The emblem and the name side by side: the lockup for the welcome screen, Settings' About and the catalog. */
@Composable
fun Wordmark(modifier: Modifier = Modifier, size: Dp = 40.dp, tagline: String? = null, animate: Boolean = false) {
    val c = Echelon.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(size * .3f)) {
        Emblem(size = size, animate = animate)
        Column {
            Text("ECHELON", style = TextStyle(fontFamily = Oxanium, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, fontSize = (size.value * .52f).sp, lineHeight = (size.value * .6f).sp, letterSpacing = .14.em), color = c.text)
            if (tagline != null) Text(tagline, style = Echelon.type.overline, color = c.textMuted)
        }
    }
}

private object EmblemPaths {
    val fiofka: Path = PathParser().parsePathString("M11 5.5 18 17.5 11 14.5 4 17.5Z").toPath()
    val decxus: Path = PathParser().parsePathString("M21 14.5 28 26.5 21 23.5 14 26.5Z").toPath()
}
