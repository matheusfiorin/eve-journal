package com.echelon.eve.fly.skills

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SkillQueueItem
import com.echelon.eve.fly.FlyPage
import com.echelon.eve.fly.PilotPicker
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.Countdown
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.Hairline
import com.echelon.eve.ui.components.ListRow
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.format.compactNumber
import com.echelon.eve.ui.format.left
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import java.time.Instant

/** One queue entry, with its dates parsed (epoch ms). */
data class QueueEntry(val skillId: Long, val level: Int, val start: Long?, val finish: Long?)

/**
 * The queue as the web reads it (model.js queueState): entries in queue order, the one training now (its start is
 * past and its finish ahead), and when the whole queue runs out. A queue whose last finish is past is idle.
 */
data class QueueState(val entries: List<QueueEntry>, val training: QueueEntry?, val ends: Long?) {
    val idle: Boolean get() = training == null

    companion object {
        fun of(queue: List<SkillQueueItem>, now: Long): QueueState {
            val entries = queue.sortedBy { it.queuePosition }.map { QueueEntry(it.skillId, it.finishedLevel, it.startDate?.let(::parse), it.finishDate?.let(::parse)) }
                .filter { it.finish == null || it.finish > now }
            val training = entries.firstOrNull { it.start != null && it.finish != null && it.start <= now }
            return QueueState(entries, training, entries.mapNotNull { it.finish }.maxOrNull())
        }
        private fun parse(s: String): Long? = runCatching { Instant.parse(s).toEpochMilli() }.getOrNull()
    }
}

data class SkillsUi(val pilot: Pilot, val queue: QueueState? = null, val names: Map<Long, String> = emptyMap(), val totalSp: Long? = null, val note: String? = null, val shared: Boolean = false)

private val ROMAN = listOf("0", "I", "II", "III", "IV", "V")

@Composable
fun SkillQueueScreen(ui: SkillsUi?, now: Long, onPick: (Pilot) -> Unit, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    if (ui == null) { EmptyState("Choose who is flying at the top of the screen.", title = "No pilot flying", icon = EchelonIcons.Pilot); return@FlyPage }
    PilotPicker(ui.pilot, onPick)
    val q = ui.queue
    val c = Echelon.colors
    val name = { id: Long -> ui.names[id] ?: "Skill $id" }
    if (q == null) { EmptyState(ui.note ?: "No skill queue to show.", title = "No queue", icon = EchelonIcons.Pilot); return@FlyPage }
    val t = q.training
    if (t?.finish != null) PrimaryPanel {
        Text("Training", style = Echelon.type.label, color = c.textMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Column(Modifier.weight(1f)) {
                Text("${name(t.skillId)} ${ROMAN.getOrElse(t.level) { "${t.level}" }}", style = Echelon.type.screenTitle, color = c.text, maxLines = 2)
            }
            Countdown(t.finish, now = now, warnUnderMillis = 0)
        }
        if (t.start != null && t.finish > t.start) ProgressBar(((now - t.start).toFloat() / (t.finish - t.start)).coerceIn(0f, 1f), Modifier.fillMaxWidth())
    } else EchelonCard(tone = Tone.Warn) {
        Text("Nothing is training", style = MaterialTheme.typography.titleMedium, color = c.text)
        Text("${ui.pilot.displayName}’s queue is empty. Add skills in EVE.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    }
    StatRow {
        StatTile("Queue ends", null, Modifier.weight(1f), display = q.ends?.let { left(it, now) } ?: "—", tone = if (q.ends != null && q.ends - now < DAY) Tone.Warn else Tone.Neutral)
        StatTile("In queue", q.entries.size.toDouble(), Modifier.weight(1f))
        if (ui.totalSp != null) StatTile("Skill points", null, Modifier.weight(1f), display = compactNumber(ui.totalSp.toDouble()))
    }
    if (q.ends != null && q.ends - now < DAY) Text("The queue runs out in ${left(q.ends, now)}. Add skills soon.", style = MaterialTheme.typography.bodySmall, color = c.warn)
    val rest = q.entries.filter { it != t }
    if (rest.isNotEmpty()) {
        SectionHeader("Next", subtitle = plural(rest.size, "skill"))
        EchelonCard(padding = false) {
            rest.forEachIndexed { i, e ->
                if (i > 0) Hairline()
                ListRow(title = "${name(e.skillId)} ${ROMAN.getOrElse(e.level) { "${e.level}" }}", supporting = e.finish?.let { "Done in ${left(it, now)}" })
            }
        }
    }
    if (ui.shared) Text("From ${ui.pilot.displayName}’s public snapshot.", style = MaterialTheme.typography.bodySmall, color = c.textFaint)
}

private const val DAY = 86_400_000L
