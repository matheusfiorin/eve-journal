package com.echelon.eve.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import com.echelon.eve.ui.motion.entrance
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.motion.AnimatedNumber
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing

/**
 * A summary figure (the web's readout): a label over a large tabular number that counts to its value, with an
 * optional note under it. [value] null shows "—". Use [display] for text that is not a number ("Docked").
 */
@Composable
fun StatTile(
    label: String,
    value: Double?,
    modifier: Modifier = Modifier,
    kind: Kind = Kind.Count,
    note: String? = null,
    tone: Tone = Tone.Neutral,
    display: String? = null,
) {
    val c = Echelon.colors
    val shape = RoundedCornerShape(Radii.control)
    val color = if (tone == Tone.Neutral) c.text else tone.color()
    val mark = if (tone == Tone.Neutral) c.accent else tone.color()
    Column(modifier.entrance().clip(shape).background(c.surface1).border(1.dp, c.line, shape)
        // The readout's mark: a short stepped bar on the top edge in the tile's tone.
        .drawBehind { val h = 2.dp.toPx(); drawRect(mark, Offset(Spacing.md.toPx(), 0f), Size(14.dp.toPx(), h)); drawRect(mark.copy(alpha = .45f), Offset(Spacing.md.toPx() + 17.dp.toPx(), 0f), Size(5.dp.toPx(), h)) }
        .padding(horizontal = Spacing.md, vertical = 10.dp).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = Echelon.type.label, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (display != null) Text(display, style = Echelon.type.numLarge, color = color, maxLines = 1)
        else AnimatedNumber(value, kind = kind, style = Echelon.type.numLarge, color = color)
        if (note != null) Text(note, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** Tiles in a row that share the width equally (two or three fit a phone). */
@Composable
fun StatRow(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.sm), content = content)
}
