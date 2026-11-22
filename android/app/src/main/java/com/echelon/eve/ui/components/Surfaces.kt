package com.echelon.eve.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.NoEntrance
import com.echelon.eve.ui.motion.Starfield
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.pressScale
import com.echelon.eve.ui.theme.Backdrop
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.formationShape

/**
 * The app ground: ink, a plotting grid of dots (every 24 dp, brighter every 96 dp) and a faint glow of the flying
 * pilot's colour from the top, so the whole app is quietly tinted by who is flying. Static: drawn once per size.
 * The OLED backdrop is true black with no grid and no glow.
 */
@Composable
fun GridBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val c = Echelon.colors
    val pilot = Echelon.pilot.color
    val grid = Echelon.backdrop != Backdrop.Oled
    Box(modifier.background(c.bg).drawWithCache {
        val step = 24.dp.toPx()
        val minor = ArrayList<Offset>(); val major = ArrayList<Offset>()
        if (grid) {
            for (i in 0..(size.width / step).toInt()) for (j in 0..(size.height / step).toInt()) {
                (if (i % 4 == 0 && j % 4 == 0) major else minor) += Offset(i * step + step / 2, j * step + step / 2)
            }
        }
        val glow = Brush.radialGradient(listOf(pilot.copy(alpha = .07f), Color.Transparent), center = Offset(size.width * .5f, 0f), radius = size.maxDimension * .6f)
        val dot = 1.2.dp.toPx(); val bigDot = 2.dp.toPx()
        onDrawBehind {
            if (!grid) return@onDrawBehind
            drawRect(glow)
            drawPoints(minor, PointMode.Points, c.bgGrid, strokeWidth = dot, cap = StrokeCap.Round)
            drawPoints(major, PointMode.Points, c.bgGrid.copy(alpha = (c.bgGrid.alpha * 2.2f).coerceAtMost(1f)), strokeWidth = bigDot, cap = StrokeCap.Round)
        }
    }, content = content)
}

/** A hero area (a screen's top, the sign-in screen): the animated Formation starfield when the Space backdrop is on. */
@Composable
fun HeroBackground(modifier: Modifier = Modifier, seed: Int = 7, content: @Composable BoxScope.() -> Unit) {
    if (Echelon.backdrop == Backdrop.Space) Starfield(modifier, seed = seed, content = content) else Box(modifier, content = content)
}

/**
 * The basic panel: surface-1 with a hairline that is brighter along the top (light from above), [Radii.panel] corners.
 * Clickable when [onClick] is set: the accent ripple, and the card sinks a little under the finger ([pressScale]).
 * [tone] tints the ground and border for warnings and errors; [shape] swaps the silhouette (formationShape() for a
 * card that leads somewhere). Enters with the screen's staggered entrance.
 */
@Composable
fun EchelonCard(
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
    onClick: (() -> Unit)? = null,
    padding: Boolean = true,
    shape: Shape = RoundedCornerShape(Radii.panel),
    onClickLabel: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Echelon.colors
    val interaction = remember { MutableInteractionSource() }
    val edge = if (tone == Tone.Neutral) Brush.verticalGradient(listOf(c.lineStrong, c.line, c.line)) else Brush.verticalGradient(listOf(tone.color().copy(alpha = .6f), tone.color().copy(alpha = .3f)))
    Column(
        modifier.entrance()
            .then(if (onClick != null) Modifier.pressScale(interaction) else Modifier)
            .clip(shape).background(if (tone == Tone.Neutral) c.surface1 else tone.soft()).border(1.dp, edge, shape)
            .then(if (onClick != null) Modifier.clickable(interaction, ripple(color = c.accent), onClickLabel = onClickLabel, role = Role.Button, onClick = onClick) else Modifier)
            .then(if (padding) Modifier.padding(Spacing.lg) else Modifier),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) { NoEntrance { content() } }
}

/**
 * The screen's main panel: the one bold element. The Formation silhouette (top-end corner cut at 45°) with its cut
 * edge lit in the brand gradient, a plotter's tick ruler along the top (major every 64 dp, minor every 8 dp), and a
 * ground that lifts from surface-2 at the top to surface-1.
 */
@Composable
fun PrimaryPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Echelon.colors
    val shape = formationShape(Radii.cut, Radii.panel)
    Column(
        modifier.entrance().clip(shape).background(Brush.verticalGradient(listOf(c.surface2, c.surface1)))
            .border(1.dp, Brush.verticalGradient(listOf(c.lineStrong, c.line)), shape)
            .drawBehind {
                val cut = Radii.cut.toPx(); val inset = Radii.panel.toPx(); val w = size.width - cut
                val minor = 8.dp.toPx()
                for (i in 1..((w - inset) / minor).toInt()) { val tall = i % 8 == 0; val x = inset + i * minor; drawLine(if (tall) c.tick else c.line, Offset(x, 0f), Offset(x, (if (tall) 8 else 4).dp.toPx()), 1f) }
                // The cut edge, lit Ion → Flare: the motif's signature.
                drawLine(Brush.linearGradient(c.brand, Offset(w, 0f), Offset(size.width, cut)), Offset(w, 0f), Offset(size.width, cut), 2.dp.toPx(), cap = StrokeCap.Round)
            }.padding(start = Spacing.xl, end = Spacing.xl, top = 24.dp, bottom = Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) { NoEntrance { content() } }
}

/**
 * The Formation motif as a mark: [count] short bars slanted at 45° and stepped like aircraft in echelon, fading back.
 * Section headers lead with it; heroes and the welcome screen use it larger.
 */
@Composable
fun EchelonStripes(modifier: Modifier = Modifier, color: Color = Echelon.colors.accent, count: Int = 3, height: Dp = 10.dp) {
    Canvas(modifier.size(width = height * (count * .6f + .5f), height = height)) {
        val h = size.height; val bar = h * .32f; val gap = h * .6f
        for (i in 0 until count) {
            val x = i * gap
            val p = Path().apply { moveTo(x, h); lineTo(x + h * .5f, 0f); lineTo(x + h * .5f + bar, 0f); lineTo(x + bar, h); close() }
            drawPath(p, color.copy(alpha = 1f - i * (.55f / count)))
        }
    }
}

/**
 * A section heading: the echelon stripes, the title, an optional subtitle, and an action on the right ("See all", a
 * filter). Enters with the screen's staggered entrance.
 */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null, action: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    Row(modifier.entrance().fillMaxWidth().padding(top = Spacing.md, bottom = Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                EchelonStripes(height = 9.dp)
                Spacer(Modifier.width(Spacing.sm))
                Text(title, Modifier.semantics { heading() }, style = androidx.compose.material3.MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (subtitle != null) Text(subtitle, style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        action?.invoke(this)
    }
}

/** A hairline divider in the line colour. */
@Composable
fun Hairline(modifier: Modifier = Modifier, color: Color = Echelon.colors.line) {
    Canvas(modifier.fillMaxWidth().height(1.dp)) { drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
}

/** Centres [content] and caps its width at [Spacing.maxContent], so screens read well on tablets and in landscape. */
@Composable
fun ContentWidth(modifier: Modifier = Modifier, maxWidth: Dp = Spacing.maxContent, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = maxWidth).fillMaxWidth(), content = content)
    }
}
