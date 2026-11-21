package com.echelon.eve.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.motion.Starfield
import com.echelon.eve.ui.theme.Backdrop
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import com.echelon.eve.ui.theme.cutCornerShape

/** The app ground: the plotting-table grid (48 dp major, 12 dp minor) over the background colour, as body does on the web. */
@Composable
fun GridBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val c = Echelon.colors
    val grid = Echelon.backdrop != Backdrop.Oled
    Box(modifier.background(c.bg).drawBehind {
        if (!grid) return@drawBehind
        // Every fourth 12 dp line is a 48 dp major one.
        val minor = 12.dp.toPx(); val fine = c.bgGrid.copy(alpha = c.bgGrid.alpha / 2)
        for (i in 0..(size.width / minor).toInt()) drawLine(if (i % 4 == 0) c.bgGrid else fine, Offset(i * minor, 0f), Offset(i * minor, size.height))
        for (i in 0..(size.height / minor).toInt()) drawLine(if (i % 4 == 0) c.bgGrid else fine, Offset(0f, i * minor), Offset(size.width, i * minor))
    }, content = content)
}

/** A hero area (a screen's top, the sign-in screen): the animated starfield when the Space backdrop is on. */
@Composable
fun HeroBackground(modifier: Modifier = Modifier, seed: Int = 7, content: @Composable BoxScope.() -> Unit) {
    if (Echelon.backdrop == Backdrop.Space) Starfield(modifier, seed = seed, content = content) else Box(modifier, content = content)
}

/**
 * The basic panel (.panel): surface-1, a hairline border and 6 dp corners. Clickable when [onClick] is set, with the
 * accent ripple. [tone] tints the border for warnings and errors.
 */
@Composable
fun EchelonCard(modifier: Modifier = Modifier, tone: Tone = Tone.Neutral, onClick: (() -> Unit)? = null, padding: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.panel)
    Column(
        modifier.clip(shape).background(if (tone == Tone.Neutral) c.surface1 else tone.soft()).border(1.dp, if (tone == Tone.Neutral) c.line else tone.color().copy(alpha = .4f), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .then(if (padding) Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.lg) else Modifier),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        content = content,
    )
}

/**
 * The screen's main panel (.panel--primary): the one bold element. A plotter's tick ruler runs along the top (major
 * ticks every 64 dp, minor every 8 dp) and the top-right corner is cut at 45°.
 */
@Composable
fun PrimaryPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Echelon.colors
    val shape = cutCornerShape()
    Column(
        modifier.clip(shape).background(c.surface1).drawBehind {
            val cut = Radii.cut.toPx(); val w = size.width - cut
            drawLine(c.tick, Offset(0f, 0f), Offset(w, 0f), 1.dp.toPx())
            val minor = 8.dp.toPx()
            for (i in 0..(w / minor).toInt()) { val tall = i % 8 == 0; drawLine(if (tall) c.tick else c.lineStrong, Offset(i * minor, 0f), Offset(i * minor, (if (tall) 9 else 4).dp.toPx()), 1f) }
            // The cut corner's own hairline, then the border on the other three sides.
            drawLine(c.tick, Offset(w, 0f), Offset(size.width, cut), 1.dp.toPx())
            drawLine(c.line, Offset(size.width - .5f, cut), Offset(size.width - .5f, size.height), 1.dp.toPx())
            drawLine(c.line, Offset(0f, size.height - .5f), Offset(size.width, size.height - .5f), 1.dp.toPx())
            drawLine(c.line, Offset(.5f, 0f), Offset(.5f, size.height), 1.dp.toPx())
        }.padding(start = Spacing.xl, end = Spacing.xl, top = 26.dp, bottom = Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** A section heading with an optional line under it and an action on the right ("See all", a filter). */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null, action: (@Composable RowScope.() -> Unit)? = null) {
    val c = Echelon.colors
    Row(modifier.fillMaxWidth().padding(top = Spacing.sm, bottom = Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, Modifier.semantics { heading() }, style = androidx.compose.material3.MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
