package com.echelon.eve.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.motion.entrance
import com.echelon.eve.ui.motion.pressScale
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.ripple
import androidx.compose.runtime.remember
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing

/**
 * A list row (the web's .opp): an optional leading slot (portrait, icon, security badge), a title and up to two
 * supporting lines, and a trailing slot (a figure, a tag). 56 dp minimum so it is a comfortable target. With
 * [onClick] it shows a chevron unless [trailing] is set; pair it with Modifier.sharedContainer for list → detail.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    meta: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = Echelon.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier.entrance().fillMaxWidth().defaultMinSize(minHeight = 56.dp)
            .then(if (onClick != null) Modifier.pressScale(interaction, .985f).clickable(interaction, ripple(color = c.accent), onClick = onClick) else Modifier)
            .padding(horizontal = Spacing.md, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) Box(contentAlignment = Alignment.Center) { leading() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (supporting != null) Text(supporting, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (meta != null) Text(meta, style = Echelon.type.label, color = c.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        when {
            trailing != null -> Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically, content = trailing)
            onClick != null -> Icon(EchelonIcons.Chevron, null, Modifier.size(18.dp), tint = c.textFaint)
        }
    }
}

/** A label and value on one line (the web's share-row / dl pairs), for detail screens. */
@Composable
fun KeyValueRow(label: String, value: String, modifier: Modifier = Modifier, numeric: Boolean = false) {
    val c = Echelon.colors
    Row(modifier.fillMaxWidth().padding(vertical = Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = c.textMuted)
        Text(value, style = if (numeric) Echelon.type.num else MaterialTheme.typography.bodyMedium, color = c.text)
    }
}
