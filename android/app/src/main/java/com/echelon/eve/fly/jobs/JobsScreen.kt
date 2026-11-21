package com.echelon.eve.fly.jobs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.IndustryJob
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.fly.FlyPage
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EchelonCard
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.ProgressBar
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.components.SkeletonRows
import com.echelon.eve.ui.components.StatRow
import com.echelon.eve.ui.components.StatTile
import com.echelon.eve.ui.components.Tag
import com.echelon.eve.ui.components.Tone
import com.echelon.eve.ui.components.TypeIcon
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.PilotColors
import com.echelon.eve.ui.theme.Spacing
import kotlinx.serialization.Serializable

// jobs.js wingJobs through the planner bridge (`jobs.wing`): every pilot's jobs in one list, ready first.

@Serializable
data class WingJob(val pilot: String, val job: IndustryJob, val activity: String, val kind: String, val progress: Double = 0.0, val remaining: Long = 0, val ready: Boolean = false, val paused: Boolean = false, val active: Boolean = false)

@Serializable
data class Slots(val build: Int, val science: Int)

@Serializable
data class SlotUse(val pilot: String, val build: Int = 0, val science: Int = 0, val total: Slots? = null)

@Serializable
data class WingJobs(val list: List<WingJob> = emptyList(), val ready: Int = 0, val running: Int = 0, val next: WingJob? = null, val usage: List<SlotUse> = emptyList())

/** The screen's state: the planner's answer, names for the products, and why a pilot's jobs are missing. */
data class JobsUi(val jobs: WingJobs? = null, val names: Map<Long, String> = emptyMap(), val notes: List<String> = emptyList(), val loading: Boolean = false, val computedAt: Long = 0)

@Composable
fun JobsScreen(ui: JobsUi, now: Long, modifier: Modifier = Modifier, scroll: Boolean = true) = FlyPage(modifier, scroll) {
    val c = Echelon.colors
    val w = ui.jobs
    if (w == null) {
        if (ui.loading) SkeletonRows(rows = 4, label = "Reading industry jobs…")
        else EmptyState(ui.notes.firstOrNull() ?: "No industry jobs to show.", title = "No jobs", icon = EchelonIcons.Check)
        return@FlyPage
    }
    // The planner computed `remaining` at computedAt; the clock moves on between refreshes.
    val elapsed = (now - ui.computedAt).coerceAtLeast(0)
    StatRow {
        StatTile("Ready", w.ready.toDouble(), Modifier.weight(1f), tone = if (w.ready > 0) Tone.Ok else Tone.Neutral)
        StatTile("Running", w.running.toDouble(), Modifier.weight(1f))
        StatTile("Next done", null, Modifier.weight(1f), display = w.next?.let { duration(((it.remaining - elapsed).coerceAtLeast(0)) / 1000.0) } ?: "—")
    }
    w.usage.filter { it.total != null }.forEach { u ->
        val t = u.total!!
        Text("${u.pilot}: ${u.build} of ${t.build} build slots, ${u.science} of ${t.science} science slots in use", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    }
    if (w.list.isEmpty()) EmptyState("No industry jobs running.", title = "All slots idle", icon = EchelonIcons.Check)
    val (ready, rest) = w.list.partition { it.ready }
    if (ready.isNotEmpty()) { SectionHeader("Ready to deliver", subtitle = plural(ready.size, "job")); ready.forEach { JobCard(it, ui.names, elapsed) } }
    if (rest.isNotEmpty()) { SectionHeader("In progress", subtitle = plural(rest.size, "job")); rest.forEach { JobCard(it, ui.names, elapsed) } }
    ui.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = c.textFaint) }
}

@Composable
private fun JobCard(j: WingJob, names: Map<Long, String>, elapsed: Long) {
    val c = Echelon.colors
    val type = j.job.productTypeId ?: j.job.blueprintTypeId
    val pilot = Pilot.entries.firstOrNull { it.displayName == j.pilot }
    val remaining = (j.remaining - elapsed).coerceAtLeast(0)
    val ready = j.ready || (j.active && remaining == 0L)
    EchelonCard(tone = if (ready) Tone.Ok else Tone.Neutral) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TypeIcon(type, size = 40.dp, contentDescription = names[type])
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(names[type] ?: "…", style = MaterialTheme.typography.titleSmall, color = c.text, maxLines = 1)
                Text("${j.activity} · ${plural(j.job.runs, "run")} · ${j.pilot}", style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1)
            }
            when {
                ready -> Tag("Ready", tone = Tone.Ok)
                j.paused -> Tag("Paused", tone = Tone.Warn)
                else -> Text(duration(remaining / 1000.0), style = Echelon.type.num, color = c.text)
            }
        }
        val progress = when {
            ready -> 1f
            // The job's whole length, from what was left when the planner ran and how far along it was then.
            j.active && j.progress < 1 && j.remaining > 0 -> (1 - remaining / (j.remaining / (1 - j.progress))).toFloat().coerceIn(0f, 1f)
            else -> j.progress.toFloat()
        }
        ProgressBar(progress, Modifier.fillMaxWidth().padding(top = Spacing.sm), color = if (ready) c.ok else PilotColors.of(pilot?.id).color)
    }
}
