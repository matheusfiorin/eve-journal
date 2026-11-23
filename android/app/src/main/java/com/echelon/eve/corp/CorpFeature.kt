package com.echelon.eve.corp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.echelon.eve.AppContainer
import com.echelon.eve.core.esi.eveNames
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.nav.Destination
import com.echelon.eve.nav.Feature
import com.echelon.eve.nav.FeatureRegistry
import com.echelon.eve.nav.LocalAppContainer
import com.echelon.eve.nav.ScreenContext
import com.echelon.eve.nav.SubScreen
import com.echelon.eve.ui.EchelonIcons
import com.echelon.eve.ui.components.rememberNow
import kotlinx.coroutines.launch

/** CORP: the corporation (from the Worker's hourly snapshot, GET /api/corp) and each pilot's own assets (GET /api/assets). */
object CorpFeature : Feature {
    override val destination = Destination.Corp
    override fun install(registry: FeatureRegistry) {
        // The overview leads the hub: its card is the console in miniature (mark, treasury, health rings); a tap opens the full one.
        registry.register(destination, SubScreen("overview", "Overview", "Health, fuel and treasury at a glance", EchelonIcons.Gauge, 0,
            card = { ctx, onOpen -> OverviewCardRoute(ctx, onOpen) }) { OverviewRoute(it) })
        // Starbases and structures take an item id as their argument (a notification's deep link, a tap in the fuel bay): it scrolls to and lights that one.
        registry.register(destination, SubScreen("starbases", "Starbases", "Fuel, strontium and reinforcement", EchelonIcons.Alert, 10) { ctx -> CorpRoute(ctx) { load, names, now, retry -> StarbasesScreen(load, names, now, retry, focus = ctx.arg?.toLongOrNull()) } })
        registry.register(destination, SubScreen("structures", "Structures", "Fuel expiry, services and state", EchelonIcons.Corp, 20) { ctx -> CorpRoute(ctx) { load, names, now, retry -> StructuresScreen(load, names, now, retry, focus = ctx.arg?.toLongOrNull()) } })
        registry.register(destination, SubScreen("refuel", "Refuel planner", "Blocks, cargo and a shopping list for 7, 14 or 30 days", EchelonIcons.Timer, 25) { RefuelRoute(it) })
        registry.register(destination, SubScreen("wallet", "Wallet", "Corporation wallet divisions", EchelonIcons.Corp, 30) { CorpRoute(it) { load, _, now, retry -> WalletScreen(load, now, retry) } })
        registry.register(destination, SubScreen("members", "Members", "Who is in the corporation", EchelonIcons.Wing, 40) { CorpRoute(it) { load, _, now, retry -> MembersScreen(load, now, retry) } })
        registry.register(destination, SubScreen("industry", "Corp jobs", "Corporation industry jobs", EchelonIcons.Check, 50) { CorpRoute(it) { load, names, now, retry -> CorpJobsScreen(load, names, now, retry) } })
        registry.register(destination, SubScreen("customs", "Customs offices", "Planetary customs offices", EchelonIcons.Route, 60) { CorpRoute(it) { load, names, now, retry -> CustomsScreen(load, names, now, retry) } })
        registry.register(destination, SubScreen("assets", "Assets", "Personal and corp assets by location", EchelonIcons.Search, 70) { AssetsRoute(it) })
    }

    /** The hourly alert job: unique work, so every app start keeps the one schedule (see CorpAlertWork.kt). */
    override fun start(container: AppContainer) { runCatching { CorpAlertScheduler.schedule(container.app) } }
}

@Composable
private fun OverviewCardRoute(ctx: ScreenContext, onOpen: () -> Unit) {
    val c = LocalAppContainer.current
    val now = rememberNow(periodMillis = 30_000)
    if (c == null) { CorpOverviewCard(Load.Loading, null, now, onOpen); return }
    val repo = c.corp
    val load by repo.corp.collectAsStateWithLifecycle()
    val info by repo.info.collectAsStateWithLifecycle()
    LaunchedEffect(ctx.pilot) { repo.refreshCorp(ctx.pilot) }
    LaunchedEffect(load) { (load as? Load.Ready)?.value?.corporationId?.let { repo.refreshInfo(it) } }
    CorpOverviewCard(load, (load as? Load.Ready)?.value?.let { info[it.corporationId] }, now, onOpen)
}

@Composable
private fun OverviewRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val infos = c?.corp?.info?.collectAsStateWithLifecycle()
    CorpRoute(ctx) { load, names, now, retry ->
        val corp = (load as? Load.Ready)?.value?.corporationId
        LaunchedEffect(corp) { if (corp != null) c?.corp?.refreshInfo(corp) }
        CorpOverviewScreen(load, corp?.let { infos?.value?.get(it) }, names, now, retry, open = { key, arg -> ctx.open(Destination.Corp, key, arg) })
    }
}

@Composable
private fun RefuelRoute(ctx: ScreenContext) {
    var days by rememberSaveable { mutableStateOf(14) }
    var blockName by rememberSaveable { mutableStateOf(FuelBlock.Helium.name) }
    val (copied, copy) = rememberCopier()
    CorpRoute(ctx) { load, names, now, retry ->
        RefuelScreen(load, names, now, days, { days = it }, FuelBlock.valueOf(blockName), { blockName = it.name }, copied, copy, retry)
    }
}

/** System names and security from the market's gate map, and every type id the snapshot names, resolved through ESI. */
@Composable
private fun rememberNames(c: AppContainer, snap: Load<CorpSnapshot>): CorpNames {
    val market by c.market.state.collectAsStateWithLifecycle()
    val types by c.eveNames.names.collectAsStateWithLifecycle()
    LaunchedEffect(snap) {
        val s = (snap as? Load.Ready)?.value ?: return@LaunchedEffect
        val ids = s.starbases.value.orEmpty().map { it.type } + s.structures.value.orEmpty().map { it.type } +
            s.jobs.value.orEmpty().map { it.productTypeId ?: it.blueprintTypeId } + s.assets.value?.places.orEmpty().flatMap { p -> p.types.mapNotNull { it.firstOrNull() } } +
            s.assets.value?.places.orEmpty().map { it.id }.filter { it in 60_000_000..63_999_999 }
        c.eveNames.resolve(ids)
    }
    val systems = remember(market.data) { market.data?.systems?.mapValues { (_, s) -> s.name to s.sec }.orEmpty() }
    return CorpNames(systems, types)
}

@Composable
private fun CorpRoute(ctx: ScreenContext, content: @Composable (Load<CorpSnapshot>, CorpNames, Long, () -> Unit) -> Unit) {
    val c = LocalAppContainer.current
    val now = rememberNow(periodMillis = 30_000)
    if (c == null) { content(Load.Loading, CorpNames(), now) {}; return }
    val repo = c.corp
    val load by repo.corp.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(ctx.pilot) { repo.refreshCorp(ctx.pilot) }
    content(load, rememberNames(c, load), now) { scope.launch { repo.refreshCorp(ctx.pilot) } }
}

@Composable
private fun AssetsRoute(ctx: ScreenContext) {
    val c = LocalAppContainer.current
    val now = rememberNow(periodMillis = 30_000)
    var whoseName by rememberSaveable { mutableStateOf((ctx.pilot ?: Pilot.Fiofka).name) }
    val whose = Pilot.valueOf(whoseName)
    if (c == null) { AssetsScreen(Load.Loading, null, whose, emptyMap(), CorpNames(), emptyMap(), now, {}, {}); return }
    val repo = c.corp
    val corp by repo.corp.collectAsStateWithLifecycle()
    val mine by repo.assets.collectAsStateWithLifecycle()
    val prices by repo.prices.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val names = rememberNames(c, corp)
    LaunchedEffect(Unit) { repo.refreshCorp(ctx.pilot); repo.refreshPrices() }
    LaunchedEffect(whose) { repo.refreshAssets(whose) }
    // Names for the personal assets' types (the API names stations already).
    LaunchedEffect(mine[whose]) { (mine[whose] as? Load.Ready)?.value?.let { a -> c.eveNames.resolve(a.locations.flatMap { p -> p.flatten().map { it.first } }.distinct()) } }
    AssetsScreen(corp, mine[whose], whose, prices, names, names.types, now, onWhose = { whoseName = it.name },
        onRetry = { scope.launch { repo.refreshCorp(ctx.pilot); repo.refreshAssets(whose); repo.refreshPrices() } })
}
