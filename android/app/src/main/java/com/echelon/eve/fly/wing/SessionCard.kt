package com.echelon.eve.fly.wing

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.GasOp
import com.echelon.eve.core.wing.SessionAdd
import com.echelon.eve.core.wing.WingSession
import com.echelon.eve.core.wing.activityLabel
import com.echelon.eve.fly.timers.Fullerite
import com.echelon.eve.fly.timers.GasEstimate
import com.echelon.eve.fly.timers.LiveDot
import com.echelon.eve.fly.timers.pilotColor
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.SecondaryButton
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.Kind
import com.echelon.eve.ui.format.ago
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.format
import com.echelon.eve.ui.format.iskShort
import com.echelon.eve.ui.format.parseIsk
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.motion.RollingNumber
import com.echelon.eve.ui.motion.Springs
import com.echelon.eve.ui.motion.celebrate
import com.echelon.eve.ui.motion.motionSpec
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Radii
import com.echelon.eve.ui.theme.Spacing
import kotlin.math.abs

// The session card: the goal the two pilots reach over N operations. The headline is the value (gas mined by both + ISK added by
// hand) against the goal in a bar striped in each pilot's colour, filling on a spring and bursting when it is reached; under it the
// split (gas, added, wallet), the operations as numbered sites (the live one breathing), and the ISK added by hand with who added it.

/** The most the room accepts for one add (worker/wingroom.js MAX_ISK). */
const val MAX_ADD = 10_000_000_000_000L

/**
 * An amount as typed in the Add ISK sheet: "12.5m", "-2m" (a correction), "1,000,000". Null when it is not an amount, zero, or past
 * what the room accepts. The sign is a leading "-" or "−".
 */
fun parseAmount(text: String): Long? {
    val t = text.trim()
    val neg = t.startsWith("-") || t.startsWith("−")
    val n = parseIsk(t.removePrefix("-").removePrefix("−")) ?: return null
    val v = if (neg) -n else n
    return v.takeIf { it != 0L && abs(it) <= MAX_ADD }
}

/** "Site 1", "Site 2": the operations in the order they started. */
fun siteNames(ops: List<GasOp>): Map<String, String> = ops.sortedBy { it.startedAt }.withIndex().associate { (i, o) -> o.id to "Site ${i + 1}" }

/** The ISK of [s] against its goal, 0 to 1 and beyond; null when there is no goal. */
fun goalProgress(s: WingSession): Float? = s.goal?.takeIf { it > 0 }?.let { (s.sum.value.toFloat() / it) }

val WingSession.reached: Boolean get() = (goalProgress(this) ?: 0f) >= 1f

/** The bar's stripes: each pilot's gas in their colour, then the ISK added by hand, in value. */
fun stripes(s: WingSession, pilot: Pilot): List<Pair<Long, Color>> =
    listOf(pilot, pilot.wingmate).map { s.of(it.id).mined to pilotColor(it.id) } + (s.adds.sumOf { it.amount }.coerceAtLeast(0) to Color.Unspecified)

/**
 * The goal bar: [stripes] in order along a track, scaled so [goal] is the full width, filling on a spring (read in the draw phase
 * only). A glow rides the head while it is below the goal, and a still sheen of the brand gradient marks it when reached.
 */
@Composable
fun GoalBar(stripes: List<Pair<Long, Color>>, goal: Long, modifier: Modifier = Modifier, height: Dp = 12.dp, addedColor: Color = Echelon.colors.accentStrong) {
    val c = Echelon.colors
    val total = stripes.sumOf { it.first }
    val target = if (goal > 0) (total.toFloat() / goal).coerceIn(0f, 1f) else 0f
    val shown = animateFloatAsState(target, motionSpec(Springs.value()), label = "goal fill")
    val track = c.surface3; val ok = c.ok
    Box(modifier.fillMaxWidth().height(height).semantics { contentDescription = "${(target * 100).toInt()} percent of the goal" }.drawWithCache {
        val corner = CornerRadius(size.height / 2)
        // The stripes are square-edged and clipped to the rounded track, so both ends of the bar stay round.
        val clip = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, corner)) }
        val sheen = Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = .35f), Color.Transparent))
        onDrawBehind {
            drawRoundRect(track, cornerRadius = corner)
            val full = size.width * shown.value
            val sum = total.coerceAtLeast(1).toFloat()
            clipPath(clip) {
                var x = 0f
                stripes.forEach { (v, colour) ->
                    if (v <= 0) return@forEach
                    val w = full * (v / sum)
                    drawRect(if (colour == Color.Unspecified) addedColor else colour, Offset(x, 0f), Size(w, size.height))
                    x += w
                }
                if (shown.value >= .999f) { drawRect(sheen, size = size); drawRect(ok.copy(alpha = .6f), size = Size(size.width, 2f)) }
            }
        }
    })
}

/** One of the three numbers under the bar: [label] over a rolling figure. */
@Composable
private fun Split(label: String, value: Long, color: Color, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = Echelon.type.label, color = c.textMuted, maxLines = 1)
        RollingNumber(value.toDouble(), style = Echelon.type.num, color = color, countUp = false, text = { iskShort(it) })
    }
}

/**
 * The session's card for the Wing screen. [live] has the local estimate of the operations this phone is running (by op id), which
 * is smoother than the room's last report; [confirmed] has what EVE's ledger says per op. [onAdd] opens the Add ISK sheet.
 */
@Composable
fun SessionCard(
    s: WingSession, pilot: Pilot, now: Long, systemName: (Long) -> String?, modifier: Modifier = Modifier,
    live: Map<String, GasEstimate> = emptyMap(), confirmed: Map<String, Long> = emptyMap(), canSend: Boolean = true, onAdd: () -> Unit = {}, onEnd: () -> Unit = {},
) {
    val c = Echelon.colors
    val sum = s.sum
    // Operations this phone runs are shown at the local estimate: the room hears of it at most twice a minute.
    val liveValue = s.ops.filter { it.live && it.id in live }.sumOf { (live.getValue(it.id).value) - it.value }
    val value = sum.value + liveValue
    val goal = s.goal?.takeIf { it > 0 }
    val reached = goal != null && value >= goal
    val names = remember(s.ops) { siteNames(s.ops) }
    EchelonCard(modifier.celebrate(reached, key = s.id), tone = if (reached) Tone.Ok else Tone.Accent) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Tag(activityLabel(s.activity), tone = Tone.Accent)
            Text(s.title ?: (activityLabel(s.activity) + (s.where?.let { " in ${systemName(it) ?: "system $it"}" } ?: "")), style = MaterialTheme.typography.titleSmall, color = c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(duration((now - s.startedAt).coerceAtLeast(0) / 1000.0), style = Echelon.type.num, color = c.textMuted)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            RollingNumber(value.toDouble(), style = Echelon.type.numLarge.copy(fontSize = 30.sp, lineHeight = 34.sp), color = c.text, countUp = false, text = { "${iskShort(it)} ISK" })
            if (goal != null) Text("of ${iskShort(goal.toDouble())}", style = Echelon.type.num, color = c.textMuted, modifier = Modifier.padding(bottom = 3.dp))
            Box(Modifier.weight(1f))
            if (goal != null) {
                if (reached) Tag("Goal reached", tone = Tone.Ok) else Text("${((value.toDouble() / goal) * 100).toInt()}%", style = Echelon.type.numLarge, color = c.accentStrong)
            }
        }
        if (goal != null) GoalBar(stripes(s, pilot), goal)
        Row(Modifier.fillMaxWidth().padding(top = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Split("Gas", sum.mined + liveValue, c.text, Modifier.weight(1f))
            Split("Added", sum.added, c.text, Modifier.weight(1f))
            Split("Wallet", sum.isk, if (sum.isk < 0) c.warn else c.textMuted, Modifier.weight(1f))
        }
        if (s.ops.isNotEmpty()) {
            Hairline(Modifier.padding(top = Spacing.xs))
            Text("Operations · ${s.ops.size}", style = Echelon.type.label, color = c.textMuted)
            s.sites.forEach { op -> OpRow(op, names[op.id].orEmpty(), now, live[op.id], confirmed[op.id]) }
        }
        if (s.adds.isNotEmpty()) {
            Hairline(Modifier.padding(top = Spacing.xs))
            Text("Added by hand", style = Echelon.type.label, color = c.textMuted)
            s.adds.sortedByDescending { it.at }.take(3).forEach { AddRow(it, now) }
        }
        Row(Modifier.fillMaxWidth().padding(top = Spacing.sm), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SecondaryButton("Add ISK", onAdd, Modifier.weight(1f), enabled = canSend, leading = { Icon(EchelonIcons.Plus, null, Modifier.size(16.dp)) })
            SecondaryButton("End session", onEnd, Modifier.weight(1f), enabled = canSend)
        }
    }
}

/** One operation: the pilot's dot (breathing while it runs), "Site 3 · C320 · 14 min", and its units and value on the right. */
@Composable
private fun OpRow(op: GasOp, name: String, now: Long, live: GasEstimate?, confirmed: Long?) {
    val c = Echelon.colors
    val units = if (op.live && live != null) live.units else op.units
    val value = if (op.live && live != null) live.value else op.value
    val gas = Fullerite.of(op.gas)?.short ?: "gas"
    val ms = ((op.endedAt ?: now) - op.startedAt).coerceAtLeast(0)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        LiveDot(pilotColor(op.by), op.live, size = 6.dp)
        Column(Modifier.weight(1f)) {
            Text("$name · $gas", style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
            Text(
                listOfNotNull(duration(ms / 1000.0), if (op.live) "running" else null, confirmed?.let { "EVE confirms ${format(it.toDouble())}" }).joinToString(" · "),
                style = Echelon.type.label, color = if (confirmed != null) c.ok else c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            RollingNumber(value.toDouble(), style = Echelon.type.num, color = c.text, countUp = false, text = { iskShort(it) })
            Text("${format(units.toDouble())} units", style = Echelon.type.label, color = c.textMuted)
        }
    }
}

/** "Fiofka +12M · Sold the paste · 3 min ago". */
@Composable
fun AddRow(a: SessionAdd, now: Long, modifier: Modifier = Modifier) {
    val c = Echelon.colors
    val who = Pilot.of(a.by)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(Modifier.size(6.dp).background(pilotColor(a.by), RoundedCornerShape(3.dp)))
        Column(Modifier.weight(1f)) {
            Text("${who?.displayName ?: "Someone"} ${if (a.amount >= 0) "+" else "−"}${iskShort(abs(a.amount).toDouble())}", style = MaterialTheme.typography.titleSmall, color = if (a.amount >= 0) c.text else c.warn, maxLines = 1)
            if (a.note.isNotBlank()) Text(a.note, style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(ago(a.at, now), style = Echelon.type.label, color = c.textFaint)
    }
}

/**
 * The compact card for the Cockpit and the Fly hub: the value against the goal, a thin bar, and "3 sites · 1 running". Tap opens the
 * Wing screen. [pilot] says whose colour comes first in the bar.
 */
@Composable
fun SessionMini(s: WingSession, pilot: Pilot, onOpen: () -> Unit, modifier: Modifier = Modifier, liveValue: Long = 0) {
    val c = Echelon.colors
    val goal = s.goal?.takeIf { it > 0 }
    val value = s.sum.value + liveValue
    val running = s.ops.count { it.live }
    EchelonCard(modifier, tone = if (goal != null && value >= goal) Tone.Ok else Tone.Neutral, onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EchelonIcons.Wing, null, Modifier.size(18.dp), tint = c.accent)
            Text(s.title ?: "${activityLabel(s.activity)} session", style = Echelon.type.label, color = c.textMuted, modifier = Modifier.weight(1f), maxLines = 1)
            Text(listOfNotNull(plural(s.ops.size, "site"), if (running > 0) "$running running" else null).joinToString(" · "), style = Echelon.type.label, color = c.textMuted)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            RollingNumber(value.toDouble(), style = Echelon.type.numLarge, color = c.text, countUp = false, modifier = Modifier.weight(1f), text = { "${iskShort(it)} ISK" })
            if (goal != null) Text("of ${iskShort(goal.toDouble())}", style = Echelon.type.num, color = c.textMuted)
        }
        if (goal != null) GoalBar(stripes(s, pilot), goal, height = 8.dp)
    }
}

/** The quick amounts of the Add ISK sheet, in ISK. */
val QUICK_ADDS = listOf(10_000_000L, 50_000_000L, 100_000_000L)

/** A chip only replaces the field when the resulting amount can still be submitted. */
internal fun quickAddAmount(text: String, increment: Long): String {
    if (increment <= 0 || increment > MAX_ADD) return text
    val next = (parseAmount(text) ?: 0) + increment
    return if (next != 0L && abs(next) <= MAX_ADD) formatAmount(next) else text
}

/**
 * The Add ISK form: the amount (the same format as everywhere: "12.5m", "750k"; a leading minus corrects a mistake), a note, chips
 * that add 10M, 50M or 100M to the amount, and a line saying what will happen. [onAdd] gets the amount and the note.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddIskForm(onAdd: (Long, String) -> Unit, modifier: Modifier = Modifier, initialAmount: String = "", initialNote: String = "", adds: List<SessionAdd> = emptyList(), now: Long = 0) {
    val c = Echelon.colors
    var amount by rememberSaveable { mutableStateOf(initialAmount) }
    var note by rememberSaveable { mutableStateOf(initialNote) }
    val parsed = parseAmount(amount)
    val fieldColors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text("Add ISK to the session", style = Echelon.type.screenTitle, color = c.text)
        Text("ISK that is not in the gas count: a sale, a bounty, or a correction with a minus.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        OutlinedTextField(
            amount, { amount = it.take(20) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Amount, e.g. 12.5m or -2m") },
            supportingText = { Text(when {
                amount.isBlank() -> "Type an amount, or tap a chip."
                parsed == null -> "That is not an amount: try 12.5m, 750k or 1,000,000."
                parsed > 0 -> "Adds ${iskShort(parsed.toDouble())} ISK to the session."
                else -> "Takes ${iskShort(-parsed.toDouble())} ISK off the session."
            }) },
            isError = amount.isNotBlank() && parsed == null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next), colors = fieldColors,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            QUICK_ADDS.forEach { q -> ChoiceChip("+${iskShort(q.toDouble())}", selected = false, onClick = { amount = quickAddAmount(amount, q) }) }
        }
        OutlinedTextField(
            note, { note = it.take(80) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Note (optional)") },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done), colors = fieldColors,
        )
        PrimaryButton(parsed?.let { if (it > 0) "Add ${iskShort(it.toDouble())}" else "Take off ${iskShort(-it.toDouble())}" } ?: "Add ISK", { parsed?.let { onAdd(it, note.trim()) } }, Modifier.fillMaxWidth(), enabled = parsed != null)
        if (adds.isNotEmpty()) {
            Hairline()
            Text("Added so far", style = Echelon.type.label, color = c.textMuted)
            adds.sortedByDescending { it.at }.take(8).forEach { AddRow(it, now) }
        }
    }
}

/** A whole amount as the form's text: "20m", "12.5m", "750k"; whole ISK when it is not round. */
fun formatAmount(v: Long): String {
    val a = abs(v).toDouble()
    val text = when {
        a >= 1e9 && a % 1e7 == 0.0 -> "${trim(a / 1e9)}b"
        a >= 1e6 && a % 1e3 == 0.0 -> "${trim(a / 1e6)}m"
        a >= 1e3 && a % 100 == 0.0 -> "${trim(a / 1e3)}k"
        else -> abs(v).toString()
    }
    return if (v < 0) "-$text" else text
}

private fun trim(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.3f".format(d).trimEnd('0').trimEnd('.')

/** The sheet over the Wing screen holding [AddIskForm]. */
@Composable
fun AddIskSheet(onDismiss: () -> Unit, onAdd: (Long, String) -> Unit, adds: List<SessionAdd>, now: Long) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Echelon.colors.surface1) {
        AddIskForm(onAdd, Modifier.padding(horizontal = Spacing.gutter).padding(bottom = Spacing.xxl), adds = adds, now = now)
    }
}
