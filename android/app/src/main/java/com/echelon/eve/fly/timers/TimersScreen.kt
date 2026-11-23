package com.echelon.eve.fly.timers

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.model.SolarSystem
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.cockpit.Suggestion
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.ChoiceChip
import com.echelon.eve.ui.components.EmptyState
import com.echelon.eve.ui.components.LinkButton
import com.echelon.eve.ui.components.PrimaryButton
import com.echelon.eve.ui.components.PrimaryPanel
import com.echelon.eve.ui.components.SectionHeader
import com.echelon.eve.ui.format.clock
import com.echelon.eve.ui.format.duration
import com.echelon.eve.ui.format.plural
import com.echelon.eve.ui.format.secColor
import com.echelon.eve.ui.format.secLabel
import com.echelon.eve.ui.theme.Echelon
import com.echelon.eve.ui.theme.Spacing
import kotlinx.coroutines.launch

/** What the Timers screen can do; the route wires these to [TimerStore]. */
class TimerActions(
    val start: (kind: TimerKind, durationMs: Long, label: String, shared: Boolean) -> Unit = { _, _, _, _ -> },
    val pause: (String) -> Unit = {},
    val resume: (String) -> Unit = {},
    val restart: (String) -> Unit = {},
    val share: (String, Boolean) -> Unit = { _, _ -> },
    val remove: (String) -> Unit = {},
    val clearFinished: () -> Unit = {},
    /** Starts a timer in the system the form chose. Without it, [start] runs and the store places it where you are. */
    val startIn: ((TimerDraft) -> Unit)? = null,
    /** Moves a timer to another system (null: none). */
    val place: (String, TimerSystem?) -> Unit = { _, _ -> },
    /** Sets a timer's warning points (ms before the end; empty for none). */
    val warn: (String, List<Long>) -> Unit = { _, _ -> },
    /** Takes the suggestion on the card (starts the timer it names), or waves it away. */
    val startSuggestion: () -> Unit = {},
    val dismissSuggestion: () -> Unit = {},
    /** Opens the system's exact-alarm switch, or hides its rationale for now. */
    val openExactSettings: () -> Unit = {},
    val dismissExactRationale: () -> Unit = {},
    /** Says which gas a running gas timer harvests (timer id, gas). */
    val pickGas: (String, Fullerite) -> Unit = { _, _ -> },
) {
    /** Starts [draft], in its system when the route can take one. */
    fun startDraft(draft: TimerDraft) = startIn?.invoke(draft) ?: start(draft.kind, draft.durationMs, draft.label, draft.shared)
}

/**
 * Where the timers are: the gate map's [systems] (names, security, gate links), the flying pilot's system ([here]) and
 * the wingmate's ([wingmateAt]), and [regionName] for the cards. Everything is optional: without the map the board
 * still groups by the names stored on the timers.
 */
class TimerMap(
    val systems: Map<Long, SolarSystem> = emptyMap(),
    val here: Long? = null,
    val wingmateAt: Long? = null,
    val regionName: (Long) -> String? = { null },
    /** What the flying pilot's fit and skills say about a mining cycle (null: not asked or not loaded). */
    val mining: MiningUi? = null,
    /** A timer worth offering now (entered a wormhole, undocked in a mining hull), and whether the card is showing. */
    val suggestion: Suggestion? = null,
    /** True while the exact-alarm permission is missing and the rationale card has not been put away. */
    val exactRationale: Boolean = false,
    /** The flying pilot's running gas operation, and the gas a new gas timer starts with. */
    val gas: GasLive? = null,
    val lastGas: Fullerite = Fullerite.C320,
) {
    val hereSystem: TimerSystem? get() = here?.let { TimerSystem(it, systems[it]?.name.orEmpty()) }

    companion object {
        val Empty = TimerMap()
    }
}

/** The sheet over the board: start a timer in a system, or move one. */
private sealed interface Sheet {
    data class Add(val system: TimerSystem?) : Sheet
    data class Move(val timer: WingTimer) : Sheet
}

/**
 * The Timers screen, laid out by place instead of as a list: the start panel, the horizon (every running timer on one
 * time axis), the jump radar (the systems with timers around you), then a card per system with a ring per timer, your
 * current system pinned first. The wingmate's timers wear their colour. Stateless apart from the form and selection.
 */
@Composable
fun TimersScreen(
    pilot: Pilot?,
    timers: Collection<WingTimer>,
    now: Long,
    actions: TimerActions,
    modifier: Modifier = Modifier,
    scroll: Boolean = true,
    map: TimerMap? = null,
    formOpen: Boolean? = null,
    selected: String? = null,
) {
    // In the app with no map given, the screen finds the places itself (the gate map, where both pilots are) and starts
    // timers in the system the form picked; previews and tests pass a map, or get the plain board.
    val container = LocalAppContainer.current
    if (map == null && container != null && pilot != null) {
        val app = rememberAppTimers(container, pilot, actions)
        TimersBoard(pilot, timers, now, app.second, modifier, scroll, app.first, formOpen, selected)
    } else TimersBoard(pilot, timers, now, actions, modifier, scroll, map ?: TimerMap.Empty, formOpen, selected)
}

@Composable
private fun TimersBoard(pilot: Pilot?, timers: Collection<WingTimer>, now: Long, actions: TimerActions, modifier: Modifier, scroll: Boolean, map: TimerMap, formOpen: Boolean?, selected: String?) {
    Column(
        modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(Spacing.gutter).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (pilot == null) {
            EmptyState("Choose who is flying at the top of the screen, then start a timer.", title = "No pilot flying", icon = EchelonIcons.Timer)
            return@Column
        }
        val jumps = remember(map.systems, map.here) { jumpsFrom(map.here, map.systems) }
        val groups = SystemBoard.of(timers, now, map.here, map.wingmateAt, map.systems, jumps)
        var sheet by remember { mutableStateOf<Sheet?>(null) }
        var picked by rememberSaveable(selected) { mutableStateOf(selected) }
        val scope = rememberCoroutineScope()
        val requesters = remember { HashMap<String, BringIntoViewRequester>() }

        SuggestionCard(map.suggestion, map.mining, actions.startSuggestion, actions.dismissSuggestion)
        if (map.exactRationale) ExactAlarmCard(actions.openExactSettings, actions.dismissExactRationale)
        map.gas?.let { g -> GasHero(g, onPick = { actions.pickGas(g.timerId, it) }); GasHaptics(g.estimate) }
        StartPanel(pilot, map, jumps, groups, open = formOpen ?: timers.isEmpty(), actions)
        if (timers.isEmpty() && map.here == null) {
            EmptyState("Timers you start show here by system, and so do the ones ${pilot.wingmate.displayName} shares.", title = "No timers yet", icon = EchelonIcons.Timer)
        }
        if (timers.any { !it.done(now) }) HorizonStrip(timers, now, map.systems)
        val nodes = radarNodes(groups, map.systems, map.wingmateAt, jumps)
        if (map.here != null && nodes.isNotEmpty()) JumpRadar(groups.firstOrNull { it.here }, nodes, now, pilot.wingmate, onPick = { id ->
            scope.launch { requesters[id.toString()]?.bringIntoView() }
        })
        if (groups.isNotEmpty()) {
            val placed = groups.count { it.systemId != null && it.timers.isNotEmpty() }
            SectionHeader(
                "By system", subtitle = if (timers.isEmpty()) "Nothing counting down" else "${plural(timers.size, "timer")} in ${plural(placed.coerceAtLeast(1), "system")}",
                action = if (timers.any { it.done(now) && it.ownedBy(pilot) }) ({ LinkButton("Clear finished", actions.clearFinished) }) else null,
            )
        }
        groups.forEach { g ->
            key(g.key) {
                val req = remember { BringIntoViewRequester() }.also { requesters[g.key] = it }
                SystemCard(
                    g, pilot, now, g.systemId?.let { map.systems[it]?.sec }, g.systemId?.let { map.systems[it] }?.let { map.regionName(it.region) }, actions,
                    onAdd = g.systemId?.let { id -> { sheet = Sheet.Add(TimerSystem(id, g.name.orEmpty())) } },
                    onMove = { sheet = Sheet.Move(it) },
                    modifier = Modifier.animatePlacement().bringIntoViewRequester(req),
                    selected = picked, onSelect = { picked = it }, systems = map.systems,
                )
            }
        }
        Spacer(Modifier.size(Spacing.lg))

        sheet?.let { s ->
            ModalBottomSheet(onDismissRequest = { sheet = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Echelon.colors.surface1) {
                Column(Modifier.padding(horizontal = Spacing.gutter).padding(bottom = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    when (s) {
                        is Sheet.Add -> TimerForm(pilot, map, jumps, groups, s.system, onStart = { actions.startDraft(it); sheet = null })
                        is Sheet.Move -> MoveTimer(s.timer, map, jumps, groups, onPick = { actions.place(s.timer.id, it); sheet = null })
                    }
                }
            }
        }
    }
}

/** The top panel: closed, one line to start a timer where you are; open, the whole form. */
@Composable
private fun StartPanel(pilot: Pilot, map: TimerMap, jumps: Map<Long, Int>, groups: List<SystemGroup>, open: Boolean, actions: TimerActions) {
    val c = Echelon.colors
    var expanded by rememberSaveable(open) { mutableStateOf(open) }
    PrimaryPanel(Modifier.fillMaxWidth().animateContentSize()) {
        AnimatedContent(expanded, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "start panel") { full ->
            if (full) Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                TimerForm(pilot, map, jumps, groups, null, onStart = { actions.startDraft(it) }, onClose = { expanded = false })
            } else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Column(Modifier.weight(1f)) {
                    Text("New timer", style = Echelon.type.screenTitle, color = c.text)
                    Text(map.hereSystem?.name?.takeIf { it.isNotBlank() }?.let { "Starts in $it, where you are" } ?: "Gas site, mining cycle, despawn or cyno", style = MaterialTheme.typography.bodySmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton({ expanded = true }, Modifier.semantics { contentDescription = "Start a timer" }) { Icon(EchelonIcons.Plus, null, tint = c.accentStrong) }
            }
        }
    }
}

/**
 * The creation form, built around the place: the headline reads what will start ("Gas site in Tama · 20:00"), then the
 * kind, its preset lengths, a label, the system (where you are by default; type to pick another, with suggestions
 * nearest first) and whether the wingmate sees it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TimerForm(
    pilot: Pilot,
    map: TimerMap,
    jumps: Map<Long, Int>,
    groups: List<SystemGroup>,
    initial: TimerSystem?,
    onStart: (TimerDraft) -> Unit,
    onClose: (() -> Unit)? = null,
    query: String? = null,
    initialKind: TimerKind? = null,
) {
    val c = Echelon.colors
    // Wormhole gas is what the timer is for: known space starts on the plain gas timer (no Sleepers there).
    val start0 = initial ?: map.hereSystem
    var kindKey by rememberSaveable { mutableStateOf(initialKind?.key ?: if (start0 != null && !GasSleepers.isJSpace(start0.id) && map.systems.containsKey(start0.id)) TimerKind.Gas.key else TimerKind.Sleeper.key) }
    val kind = TimerKind.of(kindKey)
    val profile = map.mining?.profile
    var length by rememberSaveable(kindKey) { mutableLongStateOf(if (kind == TimerKind.Mining && profile != null) profile.cycleMs.coerceAtLeast(10 * SEC) else kind.defaultMs) }
    // Warnings before the end, as "120000,60000" so they survive a rotation; the kind's default until changed.
    var warnText by rememberSaveable(kindKey) { mutableStateOf(defaultWarnings(kind).joinToString(",")) }
    val warn = warnText.split(',').mapNotNull { it.toLongOrNull() }
    var repeat by rememberSaveable { mutableStateOf(true) }
    var gasId by rememberSaveable { mutableStateOf(map.lastGas.typeId) }
    val gas = Fullerite.of(gasId) ?: map.lastGas
    var alsoHold by rememberSaveable { mutableStateOf(false) }
    var label by rememberSaveable { mutableStateOf("") }
    var shared by rememberSaveable { mutableStateOf(true) }
    // The system follows where you are until it is picked; then it stays.
    var touched by rememberSaveable { mutableStateOf(query != null) }
    var chosenId by rememberSaveable { mutableStateOf(query?.let { systemNamed(it, map.systems)?.id }) }
    var text by rememberSaveable { mutableStateOf(query ?: "") }
    val auto = initial ?: map.hereSystem
    val system: TimerSystem? = if (touched) chosenId?.let { id -> TimerSystem(id, map.systems[id]?.name ?: text.trim()) } else auto
    val shownText = if (touched) text else auto?.name.orEmpty()
    fun pick(s: TimerSystem?) { touched = true; chosenId = s?.id; text = s?.name.orEmpty() }

    Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            Text(draftTitle(kind, label, system), style = Echelon.type.screenTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(clock(length) + (system?.id?.let { jumpsText(jumps[it]) }?.let { " · $it" } ?: ""), style = Echelon.type.num, color = c.accentStrong)
        }
        if (onClose != null) IconButton(onClose, Modifier.semantics { contentDescription = "Close the form" }) { Icon(EchelonIcons.Close, null, tint = c.textMuted) }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        TimerKind.entries.forEach { k -> ChoiceChip(k.title, selected = k == kind, onClick = { kindKey = k.key }) }
    }
    Text(kind.hint, style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        val step = stepFor(length)
        IconButton(onClick = { length = (length - step).coerceAtLeast(SEC * 10) }, Modifier.semantics { contentDescription = "Shorter" }) { Text("−", style = Echelon.type.numLarge, color = c.text) }
        Text(clock(length), style = Echelon.type.numLarge, color = c.text, modifier = Modifier.weight(1f).semantics { contentDescription = "Length ${duration(length / 1000.0)}" })
        IconButton(onClick = { length = (length + step).coerceAtMost(MAX_TIMER) }, Modifier.semantics { contentDescription = "Longer" }) { Icon(EchelonIcons.Plus, null, tint = c.text) }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        kind.presets.forEach { p -> ChoiceChip(short(p), selected = p == length, onClick = { length = p }) }
    }
    if (kind.isGas) GasChips(gas, { gasId = it.typeId })
    if (kind != TimerKind.Cyno) WarnChips(length, warn, onChange = { warnText = it.joinToString(",") })
    if (kind == TimerKind.Mining || ((kind == TimerKind.Sleeper || kind == TimerKind.Gas) && profile?.kind == Harvest.Gas))
        MiningPanel(map.mining, kind, repeat, { repeat = it }, alsoHold, { alsoHold = it }, onUse = { profile?.let { length = it.cycleMs.coerceAtLeast(10 * SEC) } })
    val fieldColors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text)
    OutlinedTextField(
        value = label, onValueChange = { label = it.take(60) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text("Label") }, placeholder = { Text(kind.title) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next), colors = fieldColors,
    )
    SystemPicker(shownText, system, map, jumps, groups, pilot, onText = { t -> touched = true; text = t; chosenId = systemNamed(t, map.systems)?.id }, onPick = ::pick)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Share with ${pilot.wingmate.displayName}", style = MaterialTheme.typography.titleSmall, color = c.text)
            Text(if (shared) "They see it on their board and get told when it ends" else "Only on your devices", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
        }
        Switch(shared, { shared = it }, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
    }
    PrimaryButton("Start ${if (length < 2 * MIN) clock(length) else duration(length / 1000.0)}" + (system?.name?.takeIf { it.isNotBlank() }?.let { " in $it" } ?: ""), onClick = {
        val fits = profile != null && (kind == TimerKind.Mining || ((kind == TimerKind.Sleeper || kind == TimerKind.Gas) && profile.kind == Harvest.Gas))
        onStart(TimerDraft(kind, length, label, shared, system, gas = gas.takeIf { kind.isGas }, warnings = warn, repeat = repeat && kind == TimerKind.Mining,
            cycleMs = profile?.cycleMs.takeIf { fits }, holdFullMs = profile?.holdFullMs.takeIf { fits }, fit = profile?.let { "${it.shipName}: ${it.summary}" }.takeIf { fits }))
        // A second timer for the hold filling up, when asked: the one-time end, no repeat.
        if (alsoHold && fits && profile != null) onStart(TimerDraft(TimerKind.Generic, profile.holdFullMs, "Hold full", shared, system, warnings = listOf(MIN).filter { it < profile.holdFullMs }, fit = "${profile.shipName}: ${profile.summary}"))
        label = ""
    }, modifier = Modifier.fillMaxWidth())
}

/**
 * The system field: the name with its security light, and under it chips to pick from. Empty or settled, the chips are
 * the places that matter (here, the wingmate's system, the systems already on the board); while typing, the matching
 * names nearest first.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SystemPicker(text: String, system: TimerSystem?, map: TimerMap, jumps: Map<Long, Int>, groups: List<SystemGroup>, pilot: Pilot, onText: (String) -> Unit, onPick: (TimerSystem?) -> Unit) {
    val c = Echelon.colors
    val known = system?.id?.let { map.systems[it] }
    OutlinedTextField(
        value = text, onValueChange = { onText(it.take(40)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text("System") }, placeholder = { Text("No system") },
        leadingIcon = known?.let { s -> { Canvas(Modifier.size(12.dp)) { drawCircle(secColor(s.sec)) } } },
        trailingIcon = if (text.isNotEmpty()) ({ IconButton({ onPick(null) }, Modifier.semantics { contentDescription = "No system" }) { Icon(EchelonIcons.Close, null, tint = c.textMuted) } }) else null,
        supportingText = {
            val line = when {
                known != null -> listOfNotNull(secLabel(known.sec), map.regionName(known.region), jumpsText(jumps[known.id])).joinToString(" · ")
                text.isNotBlank() && map.systems.isNotEmpty() -> "No system by that name: pick one below."
                text.isBlank() -> "The timer starts without a system."
                else -> null
            }
            if (line != null) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.accent, unfocusedBorderColor = c.line, focusedTextColor = c.text, unfocusedTextColor = c.text),
    )
    val typing = text.isNotBlank() && known?.name?.equals(text.trim(), ignoreCase = true) != true
    val options: List<Pair<String, TimerSystem>> = if (typing) suggestSystems(text, map.systems, jumps, limit = 5).map { s ->
        listOfNotNull(s.name, secLabel(s.sec), jumpsText(jumps[s.id])).joinToString(" · ") to TimerSystem.of(s)
    } else buildList {
        map.hereSystem?.takeIf { it.name.isNotBlank() }?.let { add("Here · ${it.name}" to it) }
        map.wingmateAt?.takeIf { it != map.here }?.let { id -> map.systems[id]?.let { add("${pilot.wingmate.displayName} · ${it.name}" to TimerSystem.of(it)) } }
        groups.filter { it.systemId != null && it.systemId != map.here && it.systemId != map.wingmateAt && it.timers.isNotEmpty() }.take(3).forEach { g ->
            add((g.name ?: "System ${g.systemId}") to TimerSystem(g.systemId!!, g.name.orEmpty()))
        }
    }
    if (options.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        options.forEach { (name, s) -> ChoiceChip(name, selected = !typing && system?.id == s.id, onClick = { onPick(s) }) }
    }
}

/** The sheet for moving a timer to another system. */
@Composable
private fun MoveTimer(t: WingTimer, map: TimerMap, jumps: Map<Long, Int>, groups: List<SystemGroup>, onPick: (TimerSystem?) -> Unit) {
    val c = Echelon.colors
    var text by rememberSaveable(t.id) { mutableStateOf(t.systemNameIn(map.systems).orEmpty()) }
    val chosen = systemNamed(text, map.systems)?.let(TimerSystem::of)
    Text("Move ${t.label}", style = Echelon.type.screenTitle, color = c.text)
    Text("Now ${t.systemNameIn(map.systems)?.let { "in $it" } ?: "in no system"}.", style = MaterialTheme.typography.bodySmall, color = c.textMuted)
    val pilot = Pilot.of(t.owner) ?: return
    SystemPicker(text, chosen, map, jumps, groups, pilot, onText = { text = it }, onPick = { s -> text = s?.name.orEmpty() })
    PrimaryButton(chosen?.let { "Move to ${it.name}" } ?: if (text.isBlank()) "Take it out of any system" else "Pick a system", onClick = { onPick(chosen) }, modifier = Modifier.fillMaxWidth(), enabled = chosen != null || text.isBlank())
}

/** The −/+ step: 10 s under 2 min, a minute under 15 min, then 5 minutes. */
internal fun stepFor(length: Long): Long = when { length < 2 * MIN -> 10 * SEC; length < 15 * MIN -> MIN; else -> 5 * MIN }

/** "90s", "5m", "1h", "1h 30m" for the preset chips. */
internal fun short(ms: Long): String {
    val s = ms / 1000
    return when {
        s < 120 && s % 60 != 0L -> "${s}s"
        s < 3600 -> "${s / 60}m"
        s % 3600 == 0L -> "${s / 3600}h"
        else -> "${s / 3600}h ${(s % 3600) / 60}m"
    }
}
