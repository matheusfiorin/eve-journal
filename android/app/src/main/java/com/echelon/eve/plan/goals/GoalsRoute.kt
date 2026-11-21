package com.echelon.eve.plan.goals

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.EmptyState
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.WeakHashMap

private val stores = WeakHashMap<AppContainer, GoalStore>()
/** One goal store per app, refreshed with the Plan hub's pull-to-refresh. */
val AppContainer.goals: GoalStore get() = synchronized(stores) {
    stores.getOrPut(this) { GoalStore(api, sessions).also { s -> sync.addRefresher { s.refresh(selectedPilot.value) } } }
}

@Composable
fun GoalsRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    if (c == null) { EmptyState("The goals appear once the app has started.", title = "Wing goals", icon = EchelonIcons.Wing); return }
    val store = c.goals
    val goals by store.goals.collectAsStateWithLifecycle()
    val problem by store.problem.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var ui by remember { mutableStateOf(GoalsUi()) }
    LaunchedEffect(ctx.pilot) { store.refresh(ctx.pilot) }
    val now = System::currentTimeMillis
    GoalsScreen(ui.copy(goals = goals, problem = problem, today = LocalDate.now().toString()), GoalsActions(
        filter = { ui = ui.copy(filter = it) },
        fields = { ui = ui.copy(fields = it, formProblem = null) },
        add = { ui = ui.copy(showForm = true, editing = null, fields = GoalFields(pilot = ctx.pilot?.displayName ?: "Both pilots"), note = null) },
        edit = { g -> ui = ui.copy(showForm = true, editing = g.id, fields = GoalFields.of(g), note = null) },
        cancel = { ui = ui.copy(showForm = false, editing = null, fields = GoalFields(), formProblem = null) },
        save = {
            GoalRules.problem(ui.fields)?.let { ui = ui.copy(formProblem = it); return@GoalsActions }
            val prior = goals?.firstOrNull { it.id == ui.editing }
            val record = GoalRules.apply(prior, ui.fields, now())
            ui = ui.copy(saving = true)
            scope.launch {
                val msg = store.save(ctx.pilot, prior, record)
                ui = ui.copy(saving = false, showForm = false, editing = null, fields = GoalFields(), note = msg)
            }
        },
        delete = { g -> scope.launch { ui = ui.copy(note = store.delete(ctx.pilot, g)) } },
        done = { g, d -> scope.launch { ui = ui.copy(note = store.save(ctx.pilot, g, GoalRules.withDone(g, d, now())).let { if (d && it.startsWith("Goal saved")) "Goal done: ${g.title}. Nice flying, both of you." else it }) } },
        step = { g, i, d -> scope.launch { ui = ui.copy(note = store.save(ctx.pilot, g, GoalRules.withStep(g, i, d, now())).takeUnless { it.startsWith("Goal saved") }) } },
        retry = { scope.launch { store.refresh(ctx.pilot) } },
    ))
}
