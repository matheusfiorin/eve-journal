// Earn: Build (industry), Mine, Explore and Trade (market), each sized to the pilot's ship, skills and wallet.
import {levelOf} from '../../model.js';
import {fees, hauls, stationTrades, manufacturing} from '../../market.js';
import {skillLevels, isAlpha, slots, evaluate, rank, portfolio, stage, nextSkills, SCC, NPC_FACILITY_TAX, ALPHA_TAX} from '../../industry.js';
import {SHIPS, SKILL, yieldRate, holdOf, canFly, oreValue, sites, ledger} from '../../mining.js';
import {plan as routePlan} from '../../hauling.js';
import {BANDS, rankSystems, visitedMap, nextSkills as exploreSkills, explorerFor, shortcuts} from '../../exploration.js';
import {secLight} from '../../mapview.js';
import {facilities, nearest, secShown, secClass, dotlanSystem, dotlanRoute} from '../../route.js';
import {S, ROMAN, mine, wingmate, summary} from '../state.js';
import {esi, json, name} from '../esi.js';
import {$, esc, format, plural, pct, duration, scannedAgo, fact, trainNext, routeAttrs, mapButton, tabReady} from '../shared.js';
import {mapGraph, route, routeCache, routeIds, sendable, autopilotButton, legHtml, systemOptions, regionName} from '../routes.js';

export const markup = {
  industry:`<div class="card market-controls">
  <div class="card-head"><div><h2>Start industry</h2><p id="industry-status" class="hint">Loading blueprint prices…</p></div></div>
  <div class="row">
   <label>Start from<select id="industry-system"></select></label>
   <label>Budget (ISK)<input id="industry-budget" type="number" min="0" step="1000000" placeholder="Your wallet"></label>
  </div>
  <div class="row">
   <label>Category<select id="industry-category"><option value="">All categories</option></select></label>
   <label>Sort by<select id="industry-sort"><option value="">Best overall</option><option value="profit">Profit per day</option><option value="payback">Fastest payback</option><option value="margin">Highest margin</option><option value="cheap">Cheapest blueprint</option><option value="near">Closest seller</option></select></label>
  </div>
  <label class="check"><input id="industry-over" type="checkbox"> Show picks over budget</label>
 </div>
 <div id="industry-content"></div>`,
  mining:`<div class="card market-controls">
  <div class="card-head"><div><h2>Mining</h2><p id="mining-status" class="hint">Loading ore prices…</p></div></div>
  <div class="row">
   <label>Start from<select id="mining-system"></select></label>
   <label>Ship<select id="mining-ship"><option value="">Current or best I can fly</option><option value="32880">Venture</option><option value="17480">Procurer</option><option value="17478">Retriever</option><option value="17476">Covetor</option></select></label>
   <label>Max jumps<select id="mining-jumps"><option value="3">3 jumps</option><option value="6" selected>6 jumps</option><option value="10">10 jumps</option></select></label>
   <label class="check"><input id="mining-lowsec" type="checkbox"> Include low-sec</label>
  </div>
 </div>
 <div id="mining-content"></div>`,
  exploration:`<div class="card market-controls">
  <div class="card-head"><div><h2>Exploration</h2><p id="explore-status" class="hint">Loading traffic…</p></div></div>
  <div class="row">
   <label>Start from<select id="explore-system"></select></label>
   <label>Max jumps<select id="explore-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="15">15 jumps</option><option value="20">20 jumps</option></select></label>
   <label>Risk<select id="explore-tolerance"><option value="careful">Careful: avoid any kills</option><option value="normal" selected>Normal</option><option value="bold">Bold: kills barely matter</option></select></label>
   <label>Loop size<select id="explore-loop"><option value="4">4 systems</option><option value="6" selected>6 systems</option><option value="8">8 systems</option><option value="10">10 systems</option></select></label>
  </div>
  <div class="row bands"><span class="hint">Security</span><label class="check"><input type="checkbox" data-band="hi" checked> High-sec</label><label class="check"><input type="checkbox" data-band="low"> Low-sec</label><label class="check"><input type="checkbox" data-band="null"> Null-sec</label></div>
 </div>
 <div id="explore-content"></div>`,
  market:`<div class="card market-controls">
  <div class="card-head"><div><h2>Market analysis</h2><p id="market-status" class="hint">Loading market data…</p></div></div>
  <div class="row">
   <label>Start from<select id="market-origin"></select></label>
   <label>Max jumps to buy<select id="market-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="20">20 jumps</option><option value="99">Any distance</option></select></label>
   <label>Cargo (m³)<input id="market-cargo" type="number" min="1" step="100" value="5000"></label>
   <label>Budget (ISK)<input id="market-budget" type="number" min="0" step="1000000" placeholder="Your wallet"></label>
  </div>
  <p id="market-fees" class="hint"></p>
 </div>
 <div id="market-content"></div>`
};

const cargo = new Map();
const SKILL_LABELS = {industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production', advancedMassProduction:'Advanced Mass Production', science:'Science', labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research', accounting:'Accounting', brokerRelations:'Broker Relations'};

// ── Trade ──
export async function renderMarket() {
  const t = await tabReady('market', 'Scanning stations…', 'Market analysis');
  if (!t) return;
  const {status, content} = t, {marketData, marketBook} = S;
  if (!marketData.regions.length) { status.textContent = 'The hourly market pipeline has not stored any data yet. Check back after its next run.'; content.innerHTML = ''; return; }
  const p = mine(), meta = marketData.meta?.data || {types:{}};
  const origin = $('#market-origin');
  systemOptions(origin);
  const ship = p?.ops?.ship?.value?.ship_type_id, cargoInput = $('#market-cargo');
  if (ship && !cargoInput.dataset.touched) {
    if (!cargo.has(ship)) { try { cargo.set(ship, (await esi(`universe/types/${ship}/`)).capacity || 0); } catch { cargo.set(ship, 0); } }
    if (t.stale()) return;
    if (cargo.get(ship) > 0) cargoInput.value = Math.round(cargo.get(ship));
  }
  const skills = summary(p).skills, f = fees(skills, meta.skills);
  const from = Number(origin.value), maxJumps = Number($('#market-jumps').value), hold = Math.max(1, Number(cargoInput.value) || 5000);
  // Size every suggestion to the pilot's wallet unless they type another budget.
  const budgetInput = $('#market-budget'), wallet = summary(p).wallet;
  if (!budgetInput.dataset.touched && wallet !== undefined) budgetInput.value = Math.floor(wallet);
  const budget = budgetInput.value === '' ? Infinity : Math.max(0, Number(budgetInput.value));
  status.textContent = `${plural(marketData.regions.length, 'region')} · ${plural(Object.keys(meta.types).length, 'item')} · ${scannedAgo()} by the hourly pipeline`;
  $('#market-fees').textContent = `Sales tax ${(f.salesTax * 100).toFixed(2)}% · broker fee ${(f.brokerFee * 100).toFixed(2)}% · ${skills?.skills ? `from ${p.name}’s skills` : 'base rates (connect for your skills)'} · cargo ${hold.toLocaleString()} m³ · budget ${Number.isFinite(budget) ? format(budget, 'isk') : 'unlimited'}`;
  const sys = loc => marketBook.stations.get(loc)?.system, station = loc => marketBook.stations.get(loc)?.name || `Station ${loc}`;
  const item = id => meta.types[id]?.n || name(id);
  const haulList = hauls(marketBook, {salesTax:f.salesTax, cargo:hold, volumeOf:id => meta.types[id]?.v, budget, limit:40});
  const trades = stationTrades(marketBook, {...f, budget, limit:60});
  const index = S.costIndices.get(from)?.manufacturing || 0;
  const allBuilds = manufacturing(marketBook, meta.recipes, {...f, adjusted:S.adjusted, costIndex:index, alpha:isAlpha(skills)});
  const builds = allBuilds.filter(b => b.capital <= budget).slice(0, 12), tooDear = allBuilds.filter(b => b.profit > 0 && b.capital > budget).length;
  // Jump counts come from the same safe gate routes the previews draw.
  const g = mapGraph(), jumps = (a, b) => route(a, b)?.jumps ?? null;
  const near = j => j !== null && j <= maxJumps;
  const haulRows = haulList.map(h => ({...h, toA:jumps(from, sys(h.from.loc)), ab:jumps(sys(h.from.loc), sys(h.to.loc))}))
    .filter(h => near(h.toA) && h.ab !== null).map(h => ({...h, perJump:h.profit / Math.max(1, h.toA + h.ab)})).sort((a, b) => b.perJump - a.perJump).slice(0, 12);
  const tradeRows = trades.map(t => ({...t, j:jumps(from, sys(t.loc))})).filter(t => near(t.j)).slice(0, 12);
  const buildRows = builds.map(b => ({...b, j:jumps(from, sys(b.loc))}));
  const tripAttrs = (stops, label) => {
    if (!g || stops.some(id => !g.systems.has(id))) return '';
    const ids = routeIds(stops);
    return ids.length > 1 ? routeAttrs(ids, label) : '';
  };
  const jumpTag = j => `<em>${j === 0 ? 'here' : `${j} j`}</em>`;
  const empty = text => `<p class="hint">${text}</p>`;
  content.innerHTML = `
  <article class="card"><div class="card-head"><div><h3>Haul &amp; flip</h3><p class="hint">Buy from a sell order, fly, sell into a buy order. Ranked by profit per jump.</p></div></div>
   ${haulRows.length ? `<ol class="opps">${haulRows.map((h, n) => `<li class="opp" style="--i:${n}" ${tripAttrs([from, sys(h.from.loc), sys(h.to.loc)], `Haul ${item(h.type)}`)}><div class="opp-main"><b>${esc(item(h.type))}</b><small>${h.units.toLocaleString()} units · ${Math.round(h.m3).toLocaleString()} m³ · invest ${format(h.invest, 'isk')}${h.invest >= budget * 0.95 ? ' (your whole budget)' : ''}</small></div><div class="opp-route"><span>Buy ${format(h.from.price, 'isk')} · ${esc(station(h.from.loc))} ${jumpTag(h.toA)}</span><span>Sell ${format(h.to.price, 'isk')} · ${esc(station(h.to.loc))} <em>+${h.ab} j</em></span></div><div class="opp-profit"><b class="pos">+${format(h.profit, 'isk')}</b><small>${format(h.perJump, 'isk')} / jump</small></div></li>`).join('')}</ol>` : empty(`No profitable hauls within ${maxJumps} jumps for this cargo size.`)}
  </article>
  <article class="card"><div class="card-head"><div><h3>Station trading near you</h3><p class="hint">Place a buy order at the top bid and relist at the lowest ask. Estimate assumes you capture 5% of daily volume, with no more buy orders than your budget covers.</p></div></div>
   ${tradeRows.length ? `<ol class="opps">${tradeRows.map((t, n) => `<li class="opp" style="--i:${n}"><div class="opp-main"><b>${esc(item(t.type))}</b><small>${esc(station(t.loc))} ${jumpTag(t.j)}</small></div><div class="opp-route"><span>Bid ${format(t.buy, 'isk')} → ask ${format(t.sell, 'isk')}</span><span>${Math.round(t.volume).toLocaleString()} traded per day · ${format(t.capital, 'isk')} in orders</span></div><div class="opp-profit"><b class="pos">${(t.margin * 100).toFixed(1)}%</b><small>~${format(t.daily, 'isk')} / day</small></div></li>`).join('')}</ol>` : empty(`No station spreads beat fees within ${maxJumps} jumps.`)}
  </article>
  <article class="card"><div class="card-head"><div><h3>Manufacturing</h3><p class="hint">One run with an ME 0 blueprint you own: materials at the cheapest scanned ask, product listed at the best ask, job cost at ${(index * 100).toFixed(2)}% system index + fees.${tooDear ? ` ${tooDear} more profitable ${tooDear === 1 ? 'build needs' : 'builds need'} more than ${format(budget, 'isk')}.` : ''}</p></div></div>
   ${meta.recipesError ? empty(esc(meta.recipesError)) : buildRows.length ? `<ol class="opps">${buildRows.map((b, n) => `<li class="opp" style="--i:${n}"><div class="opp-main"><b>${esc(item(b.type))}</b><small>sells at ${esc(station(b.loc))} ${b.j === null ? '' : jumpTag(b.j)} · ${Math.round(b.daily).toLocaleString()}/day</small></div><div class="opp-route"><span>Materials ${format(b.materials, 'isk')} · job ${format(b.job, 'isk')}</span><span>Revenue ${format(b.revenue, 'isk')}</span></div><div class="opp-profit"><b class="${b.profit > 0 ? 'pos' : 'neg'}">${b.profit > 0 ? '+' : ''}${format(b.profit, 'isk')}</b><small>${(b.margin * 100).toFixed(1)}% margin</small></div></li>`).join('')}</ol>` : empty('No manufacturing data yet.')}
  </article>`;
}

// ── Build ──
export async function renderIndustry() {
  const t = await tabReady('industry', 'Pricing starter blueprints…', 'Industry planning');
  if (!t) return;
  const {status, content} = t, {marketData, marketBook, costIndices, adjusted} = S;
  const meta = marketData.meta?.data || {}, catalog = meta.starters || [];
  if (!marketData.regions.length || !catalog.length) { status.textContent = 'The pipeline has not priced starter blueprints yet. Check back after its next hourly run.'; content.innerHTML = ''; return; }
  const p = mine(), o = wingmate(), x = summary(p), levels = skillLevels(x.skills, meta.skills || {}), alpha = isAlpha(x.skills), f = fees(x.skills, meta.skills), s = slots(levels);
  systemOptions($('#industry-system'));
  const system = Number($('#industry-system').value), idx = costIndices.get(system) || {};
  const budgetInput = $('#industry-budget');
  if (!budgetInput.dataset.touched && x.wallet !== undefined) budgetInput.value = Math.floor(x.wallet);
  const budget = budgetInput.value === '' ? undefined : Number(budgetInput.value);
  // Plan around the cheapest safe NPC factory and lab near the starting system.
  const g = mapGraph(), here = g?.systems.get(system);
  const factories = g ? facilities(g, system, 1, id => costIndices.get(id)?.manufacturing) : [];
  const labs = g ? facilities(g, system, 2, id => costIndices.get(id)?.researching_material_efficiency) : [];
  const factory = factories[0], lab = labs[0];
  const buildIndex = factory?.index ?? idx.manufacturing ?? 0, researchIndex = lab?.index ?? idx.researching_material_efficiency ?? 0;
  const at = loc => { const st = marketBook.stations.get(loc); return {loc, system:st?.system, name:st?.name || `Station ${loc}`}; };
  // Where each blueprint is really sold by NPCs (365-day orders), nearest by safe route.
  const sellerNames = meta.bpoSurvey?.names || {};
  const sellerOf = pick => g ? nearest(g, system, (pick.sellers || []).map(([loc, sys, price]) => ({loc, system:sys, price, name:sellerNames[loc] || at(loc).name})), routeCache()) : null;
  const category = $('#industry-category'), sortBy = $('#industry-sort').value;
  const categories = [...new Set(catalog.map(item => item.cat))].sort();
  if (category.options.length !== categories.length + 1) { const prior = category.value; category.innerHTML = `<option value="">All categories</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}`; category.value = categories.includes(prior) ? prior : ''; }
  const skillOf = x.skills?.skills ? id => levelOf(x.skills, id) : undefined;
  const ranked = rank(catalog.filter(item => !category.value || item.cat === category.value).map(item => evaluate(item, {book:marketBook, adjusted, fees:f, index:buildIndex, researchIndex, levels, alpha, skillOf, budget})), budget)
    .map(pick => ({...pick, seller:sellerOf(pick)}));
  const SORTS = {profit:(a, b) => b.profitDay - a.profitDay, payback:(a, b) => a.payback - b.payback, margin:(a, b) => b.margin - a.margin, cheap:(a, b) => a.price - b.price,
    near:(a, b) => (a.seller?.route.jumps ?? 999) - (b.seller?.route.jumps ?? 999)};
  // Only what the wallet covers, unless the pilot asks to see the rest.
  const showAll = $('#industry-over').checked, overBudget = ranked.filter(pick => !pick.affordable).length;
  const picks = (SORTS[sortBy] ? [...ranked].sort((a, b) => (b.affordable - a.affordable) || SORTS[sortBy](a, b)) : ranked).filter(pick => showAll || pick.affordable).slice(0, 20);
  const jobTax = buildIndex + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0);
  const trip = pick => {
    if (!g) return '<p class="hint">Routes appear after the next market pipeline run.</p>';
    const seller = pick.seller, start = seller?.place.system ?? system;
    const mats = at(pick.materialsAt), hub = at(pick.sell.loc);
    const legs = [seller ? legHtml('Buy the blueprint', seller.place.name, seller.route, ` · ${format(seller.place.price, 'isk')}`)
      : `<div class="leg"><div class="leg-head"><b>Buy the blueprint</b><span>No NPC seller reachable through high-sec</span><small>Search “${esc(pick.n)} Blueprint” on the in-game market.</small></div></div>`];
    if (lab) legs.push(legHtml(`Research to ME ${pick.me}`, lab.station.name, route(start, lab.system.id), ` · ME index ${pct(lab.index)}`));
    legs.push(legHtml('Buy materials', mats.name, route(lab?.system.id ?? start, mats.system), ` · whole bill in ${esc(pick.materialsRegion)}`));
    if (factory) legs.push(legHtml('Build', factory.station.name, route(mats.system ?? start, factory.system.id), ` · index ${pct(factory.index)}`));
    legs.push(legHtml('Sell', hub.name, route(factory?.system.id ?? mats.system ?? start, hub.system), ` · lowest ask ${format(pick.sell.price, 'isk')}`));
    const stopIds = [system, seller?.place.system, lab?.system.id, mats.system, factory?.system.id, hub.system].filter(id => g.systems.has(id)).filter((id, i, a) => id !== a[i - 1]);
    const stops = stopIds.map(id => g.systems.get(id).name), tripIds = routeIds(stopIds);
    const bill = `<table class="bill"><caption>Materials for a ${pick.runs}-run batch at ME ${pick.me}, bought in ${esc(pick.materialsRegion)}</caption><thead><tr><th>Material</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${pick.bill.map(b => `<tr><td>${esc(meta.types[b.type]?.n || name(b.type))}<small>${esc(at(b.loc).name)}</small></td><td>${b.qty.toLocaleString()}</td><td>${format(b.price, 'isk')}</td><td>${format(b.qty * b.price, 'isk')}</td></tr>`).join('')}</tbody></table>`;
    return `${bill}<ol class="legs">${legs.map(l => `<li>${l}</li>`).join('')}</ol>${stops.length > 1 ? `<div class="actions" ${routeAttrs(tripIds, `${pick.n} trip`)}>${mapButton(tripIds, `${pick.n}: whole trip`)}<a class="trip-link" href="${dotlanRoute(stops)}" target="_blank" rel="noopener noreferrer">Open the whole trip on Dotlan ↗</a></div>` : ''}`;
  };
  const facilityList = (list, kind) => list.length ? `<ol class="facilities">${list.map((x, i) => `<li>${i ? '' : '<span class="tag">Best</span> '}<a href="${dotlanSystem(x.system.name)}" target="_blank" rel="noopener noreferrer">${esc(x.station.name)}</a><small><span class="sec sec-${secClass(x.system.sec)}">${secShown(x.system.sec).toFixed(1)}</span> ${esc(x.system.name)} · ${x.jumps ? plural(x.jumps, 'jump') : 'here'} · ${kind} index ${pct(x.index)} · job tax ${pct(x.index + NPC_FACILITY_TAX + (kind === 'ME' ? SCC.research : SCC.manufacturing) + (alpha ? ALPHA_TAX : 0))}</small>${x.jumps ? `<details><summary>Route</summary>${legHtml('', x.station.name, route(system, x.system.id))}</details>` : ''}</li>`).join('')}</ol>` : '<p class="hint">No high-sec NPC station with this service within 10 jumps.</p>';
  const plan = stage(x.wallet), next = nextSkills(levels, alpha), known = Boolean(x.skills?.skills);
  // A starting plan per pilot: fill their build slots within their wallet, never the same product twice.
  const mePlan = portfolio(ranked, {slots:known ? s.build : 2, budget:budget ?? Infinity});
  const ox = o ? summary(o) : null, oLevels = ox ? skillLevels(ox.skills, meta.skills || {}) : null;
  const oSkillOf = ox?.skills?.skills ? id => levelOf(ox.skills, id) : null;
  const themPlan = o ? portfolio(ranked.filter(pick => !mePlan.chosen.includes(pick) && !(oSkillOf && pick.sk?.some(([id, lvl]) => oSkillOf(id) < lvl))).map(pick => ({...pick, flags:pick.flags.filter(fl => fl !== 'skills'), affordable:!(ox.wallet >= 0) || pick.invest <= ox.wallet})),
    {slots:ox.skills?.skills ? slots(oLevels).build : 2, budget:ox.wallet ?? Infinity}) : null;
  const owner = pick => mePlan.chosen.includes(pick) ? p : themPlan?.chosen.some(c => c.bp === pick.bp) ? o : null;
  const skillName = id => meta.skillNames?.[id] || name(id);
  const FLAGS = {thin:['Thin market', 'Under 10 sold per day at the hub'], spike:['Price spike', 'Hub ask is well above its 7-day average; priced at the average +15%'], crowded:['Crowded', '10+ stations already list it'],
    skills:['Needs skills', 'You can’t start this job yet'], capital:['Budget-sized', 'Your wallet covers fewer runs than the market would take; output grows as you reinvest'], slow:['Slow seller', 'The market takes under one a day'], margin:['Thin margin', 'Under 10% after fees; a small undercut wipes it out']};
  const flagTags = pick => pick.flags.filter(fl => FLAGS[fl] && fl !== 'skills' && fl !== 'spike').map(fl => `<span class="tag flag" title="${esc(FLAGS[fl][1])}">${esc(FLAGS[fl][0])}</span>`).join('');
  const payback = days => days < 1 ? 'under a day' : `${days.toFixed(1)} days`;
  const planCard = (who, plan, wallet, free) => `<div class="plan" data-pilot="${esc(who.name.toLowerCase())}"><h4>${esc(who.name)}</h4>${plan.chosen.length ? `<ol class="plain">${plan.chosen.map(c => `<li><b>${esc(c.n)}</b><small>${format(c.invest, 'isk')} to start · +${format(c.profitDay, 'isk')}/day · pays back in ${payback(c.payback)}</small></li>`).join('')}</ol>
    <dl class="facts">${fact('Start-up', format(plan.spent, 'isk'))}${fact('Profit / day', `+${format(plan.profitDay, 'isk')}`)}${fact('Slots used', `${plan.chosen.length} of ${free}`)}${fact('Left in wallet', wallet === undefined ? '—' : format(wallet - plan.spent, 'isk'))}</dl>` : `<p class="hint">Nothing fits ${wallet === undefined ? 'yet' : `a ${format(wallet, 'isk')} wallet`} with today’s prices.</p>`}</div>`;
  status.textContent = `${catalog.length} cheap T1 blueprints that NPCs sell${meta.bpoSurvey ? ` (seller survey covers ${meta.bpoSurvey.regions}${meta.bpoSurvey.of > meta.bpoSurvey.regions ? ` of ${meta.bpoSurvey.of}` : ''} high-sec regions)` : ''}, priced from live orders · ${scannedAgo()}`;
  content.innerHTML = `
  <div class="grid">
    <article class="card"><h3>Your industry setup</h3>
      <dl class="facts">${fact('Clone', known ? (alpha ? 'Alpha<small>4 build · 1 research slot max</small>' : 'Omega') : '—')}${fact('Build slots', known ? s.build : '—')}${fact('Research slots', known ? s.science : '—')}${fact('Job tax', `${pct(jobTax)}<small>${factory ? `at ${esc(factory.system.name)}: ` : ''}index ${pct(buildIndex)} + facility + SCC${alpha ? ' + alpha' : ''}</small>`)}${fact('Selling fees', `${pct(f.salesTax + f.brokerFee)}<small>sales ${pct(f.salesTax)} · broker ${pct(f.brokerFee)}</small>`)}${fact('Budget', format(budget, 'isk'))}</dl>
      ${known ? '' : `<p class="hint">Connect ${esc(p?.name || 'your pilot')} to plan with real skills, slots and wallet.</p>`}
      ${factory && factory.system.id !== system && factory.index < (idx.manufacturing ?? Infinity) * 0.8 ? `<p class="alert warn">Building in ${esc(factory.system.name)} (${factory.jumps} jumps) is cheaper: ${pct(factory.index)} index instead of ${pct(idx.manufacturing || 0)} here.</p>` : ''}
    </article>
    <article class="card"><h3>${esc(plan.name)}</h3>
      <div class="progress-row"><span class="stack"><i class="fill" style="width:${Math.min(100, (x.wallet || 0) / plan.goal * 100).toFixed(1)}%"></i></span><small>${format(x.wallet, 'isk')} of ${format(plan.goal, 'isk')}</small></div>
      <ol class="steps">${plan.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
      <h3>Train next</h3>${next.length ? trainNext(next.map(k => ({...k, name:SKILL_LABELS[k.key]}))) : `<p class="hint">${alpha ? 'You have every industry skill an Alpha can train. Omega unlocks more slots and lower taxes.' : 'Core industry skills are done. Look at invention next.'}</p>`}
    </article>
  </div>
  <article class="card"><h3>Where to build and research near ${esc(here?.name || 'you')}</h3>
    <p class="hint">NPC stations in high-sec (0.5+), reachable without entering low-sec, within 10 jumps. A lower system index means cheaper jobs; NPC stations add a fixed ${pct(NPC_FACILITY_TAX)} facility tax.</p>
    ${g ? `<div class="grid"><div><h4>Manufacturing</h4>${facilityList(factories, 'build')}</div><div><h4>Research (ME)</h4>${facilityList(labs, 'ME')}</div></div>` : '<p class="hint">The station map appears after the next market pipeline run.</p>'}
  </article>
  <article class="card"><div class="card-head"><div><h3>Wing build plan</h3><p class="hint">The best picks that fit each pilot’s build slots and wallet, skipping anything they can’t build yet${o ? ', with no product built twice, so you don’t undercut each other' : ''}.</p></div></div>
    <div class="grid">${planCard(p, mePlan, budget, known ? s.build : 2)}${o ? planCard(o, themPlan, ox.wallet, ox.skills?.skills ? slots(oLevels).build : 2) : ''}</div>
  </article>
  <article class="card"><div class="card-head"><div><h3>Best blueprints to start with</h3><p class="hint">NPC-sold originals, researched to the suggested ME, built in batches and sold at the lowest ask. Only blueprints an NPC actually sells. Sale prices are capped at 15% over the 7-day average, materials are bought in one region, and thin, spiking or crowded markets rank lower. Batches are sized to your budget${overBudget && !showAll ? `; ${overBudget} more ${overBudget === 1 ? 'pick needs' : 'picks need'} a bigger one` : ''}.</p></div></div>
    ${picks.length ? `<ol class="opps bpos">${picks.map((pick, n) => `<li class="opp ${pick.affordable ? '' : 'over'}" style="--i:${n}">
      <div class="opp-main"><b>${esc(pick.n)}</b><small><span class="tag">${esc(pick.cat)}</span> BPO ${format(pick.seller?.place.price ?? pick.price, 'isk')} · rank ${pick.rank}</small><small>${pick.seller ? `NPC sells it at ${plural(pick.sellers.length, 'station')} · nearest ${pick.seller.route.jumps ? plural(pick.seller.route.jumps, 'jump') : 'here'}` : `<span class="neg">No NPC seller reachable through high-sec</span>`}</small>${pick.missing?.length ? `<small class="neg">Needs ${pick.missing.map(([id, lvl]) => `${esc(skillName(id))} ${ROMAN[lvl]}`).join(', ')}</small>` : ''}${owner(pick) ? `<small class="who" data-pilot="${esc(owner(pick).name.toLowerCase())}">In ${esc(owner(pick).name)}’s plan</small>` : pick.affordable ? '' : '<small class="neg">Over budget</small>'}${flagTags(pick) ? `<small class="flags">${flagTags(pick)}</small>` : ''}</div>
      <div class="opp-route"><span>Research ME 0 → ${pick.me} · ${duration(pick.research.seconds)} · ${format(pick.research.cost, 'isk')}</span><span>Sell ${pick.unitsPerDay >= 1 ? `${Math.round(pick.unitsPerDay).toLocaleString()}/day` : `1 every ${Math.round(1 / pick.unitsPerDay)} days`} at ${format(pick.sellPrice, 'isk')} · margin ${pct(pick.margin)} <em>ME 0: ${pick.profitAtZero > 0 ? '+' : ''}${format(pick.profitAtZero, 'isk')}/unit</em></span><span>Start with ${format(pick.invest, 'isk')} (blueprint, research, ${pick.runs}-run batch) · ${Math.round(pick.daily).toLocaleString()} traded/day at the hub · ${plural(pick.listings, 'station')} competing</span>${pick.trend === null ? '' : `<span class="${pick.trend > 0.15 ? 'neg' : pick.trend < -0.1 ? 'warn-text' : ''}">Hub price ${pick.trend >= 0 ? '+' : ''}${(pick.trend * 100).toFixed(0)}% vs 7-day average${pick.trend > 0.15 ? ' · likely a spike, expect it to fall' : pick.trend < -0.1 ? ' · below normal, may recover' : ''}</span>`}</div>
      <div class="opp-profit"><b class="pos">+${format(pick.profitDay, 'isk')}/day</b><small>pays back in ${payback(pick.payback)}</small></div>
      <details class="trip"><summary>Plan the trip</summary>${trip(pick)}</details></li>`).join('')}</ol>` : (overBudget && !showAll ? `<p class="hint">Nothing profitable fits a ${format(budget, 'isk')} budget yet; ${overBudget} ${overBudget === 1 ? 'pick needs' : 'picks need'} more. Follow the stage plan above to build the wallet, or tick “Show picks over budget”.</p>` : '<p class="hint">No starter blueprint turns a profit at today’s prices with these fees. Try another system or check after the next hourly scan.</p>')}
  </article>
  <article class="card"><h3>Avoid these traps</h3><ul class="plain traps">
    <li><b>Price your own ore at market value.</b><small>Minerals you mine could be sold; if a build earns less than selling them, sell them.</small></li>
    <li><b>Margins under ~${Math.round((f.salesTax + f.brokerFee) * 100 + 2)}% are losses for you.</b><small>Sales tax and broker fee alone take ${pct(f.salesTax + f.brokerFee)}; relisting adds more. Accounting and Broker Relations cut both.</small></li>
    <li><b>Batch your runs.</b><small>ME rounds up per job, so a 1-run job wastes materials that a 100-run job saves.</small></li>
    <li><b>Never leave a slot idle.</b><small>Research the next blueprint while the current one builds${s.science > 1 ? `; you have ${s.science} research slots` : ''}.</small></li>
    <li><b>Buy BPOs from the NPC market.</b><small>Unresearched T1 originals are always on the market at the NPC price; don’t overpay on contracts.</small></li>
    ${alpha ? `<li><b>Alpha tax.</b><small>Alphas pay an extra industry tax (CCP lists 2%; this page assumes it). Omega on the main builder removes it.</small></li>` : ''}
  </ul><p class="hint">Assumes SCC surcharge ${pct(SCC.manufacturing)} on builds and ${pct(SCC.research)} on research, and ${pct(NPC_FACILITY_TAX)} NPC facility tax. Confirm against the in-game job window.</p></article>`;
}

// ── Mine: the best belts within reach for each pilot, with their ship and skills, valued at today's hub prices. ──
function minerOf(p) {
  if (!p) return null;
  const w = S.wing.get(p.id), x = summary(p);
  return {p, level:id => levelOf(x.skills, id), known:Boolean(x.skills?.skills), salesTax:fees(x.skills, S.marketData?.meta?.data?.skills).salesTax,
    location:(p.private ? p.ops?.location?.value : w?.location)?.solar_system_id, ship:(p.private ? p.ops?.ship?.value : w?.ship)?.ship_type_id,
    ledger:p.private ? p.ops?.mining : w?.mining ? {permission:true, value:w.mining} : null};
}
function shipFor(m, choice) {
  if (SHIPS[choice]) return Number(choice);
  if (SHIPS[m.ship]) return m.ship;
  const flyable = Object.keys(SHIPS).map(Number).filter(id => canFly(id, m.level));
  return flyable.sort((a, b) => yieldRate(b, m.level) - yieldRate(a, m.level))[0] || 32880;
}
export async function renderMining() {
  const t = await tabReady('mining', 'Pricing ore…', 'Mining');
  if (!t) return;
  const {status, content} = t, {marketData, marketBook} = S;
  const meta = marketData.meta?.data || {}, g = mapGraph();
  if (!meta.ores?.length || !g) { status.textContent = 'The pipeline has not priced ore yet. Check back after its next hourly run.'; content.innerHTML = ''; return; }
  systemOptions($('#mining-system'));
  const from = Number($('#mining-system').value), maxJumps = Number($('#mining-jumps').value), lowsec = $('#mining-lowsec').checked, choice = $('#mining-ship').value;
  const me = minerOf(mine()), mate = minerOf(wingmate());
  const valuesFor = m => new Map(meta.ores.map(o => [o.n, oreValue(o, marketBook, {salesTax:m.salesTax, level:m.level})]));
  const activity = meta.activity || {};
  const plan = (m, start, shipChoice, limit) => {
    const ship = shipFor(m, shipChoice), values = valuesFor(m), rate = yieldRate(ship, m.level), hold = holdOf(ship, m.level);
    return {m, ship, values, rate, hold, start, list:start ? sites(g, start, {values, rate, hold, activity, maxJumps, lowsec, limit}) : []};
  };
  const mine1 = plan(me, from, choice, 8), mate1 = mate ? plan(mate, mate.location || from, '', 3) : null;
  const sysName = id => g.systems.get(id)?.name || name(id);
  const chip = sys => `<span class="sec sec-${secClass(sys.sec)}">${secShown(sys.sec).toFixed(1)}</span>`;
  const site = (pl, s, n) => `<li class="opp" style="--i:${n}">
    <div class="opp-main"><b>${chip(s.system)} <a href="${dotlanSystem(s.system.name)}" data-system="${s.system.id}">${esc(s.system.name)}</a></b><small>${s.jumps ? plural(s.jumps, 'jump') : 'you are here'} · ${plural(s.system.belts, 'belt')}${s.lowsec ? ' · <span class="neg">route through low-sec</span>' : ''}</small>
      <small class="flags">${s.ores.map((o, i) => `<span class="tag ${i ? 'dim' : ''}" title="${esc(o.how)} · ${format(o.perM3, 'isk')}/m³">${esc(o.n)}</span>`).join('')}</small></div>
    <div class="opp-route"><span>Mine ${esc(s.ores[0].n)}: ${format(s.ores[0].perM3, 'isk')}/m³, best sold ${esc(s.ores[0].how)}${s.ores[0].at ? ` at ${esc(marketBook.stations.get(s.ores[0].at)?.name || 'a hub')}` : ' as minerals'}</span>
      <span class="${s.kills ? 'neg' : ''}">${s.kills ? `${plural(s.kills, 'ship')} killed in the last hour` : 'No kills in the last hour'} · ${s.traffic.toLocaleString()} jumps/h${s.crowd < 1 ? ' · busy, belts may be stripped' : ''}${secClass(s.system.sec) !== 'hi' ? ' · <span class="neg">low-sec: no CONCORD</span>' : ''}</span></div>
    <div class="opp-profit"><b class="pos">${format(s.iskHour, 'isk')}/h</b><small>full hold every ${duration(pl.hold / pl.rate)}</small></div>
    ${s.jumps ? `<details class="trip"><summary>Route</summary>${legHtml('Fly to', s.system.name, route(pl.start, s.system.id, !lowsec))}</details>` : ''}</li>`;
  const sitesHtml = pl => pl.list.length ? `<ol class="opps">${pl.list.map((s, n) => site(pl, s, n)).join('')}</ol>` : `<p class="hint">No ${lowsec ? '' : 'high-sec '}belts with known ore within ${maxJumps} jumps.</p>`;
  const shipLine = pl => `${esc(SHIPS[pl.ship].name)}${pl.m.ship === pl.ship ? ' (current ship)' : canFly(pl.ship, pl.m.level) ? '' : ' <span class="neg">(not trained yet)</span>'} · ${Math.round(pl.rate * 60).toLocaleString()} m³/min · ${Math.round(pl.hold).toLocaleString()} m³ hold`;
  const ledgerHtml = m => {
    if (!m?.ledger) return '<p class="hint">Not shared yet.</p>';
    if (m.ledger.permission === false) return '<p class="hint">Permission not granted. Press Reconnect to allow the mining ledger.</p>';
    const r = ledger(m.ledger.value || [], meta.ores, valuesFor(m), sysName);
    return r.units ? `<dl class="facts">${fact('Mined', `${Math.round(r.m3).toLocaleString()} m³<small>${plural(r.days, 'day')} in the last 30</small>`)}${fact('Worth today', format(r.isk, 'isk'))}${fact('Per mining day', format(r.isk / r.days, 'isk'))}</dl>
      <ul class="plain">${r.systems.slice(0, 4).map(s => `<li><b>${esc(s.name)}</b><small>${Math.round(s.m3).toLocaleString()} m³ over ${plural(s.days, 'day')} · ${format(s.isk, 'isk')}</small></li>`).join('')}</ul>` : '<p class="hint">No mining in the last 30 days.</p>';
  };
  const best = mine1.list[0];
  const shipRows = Object.keys(SHIPS).map(Number).map(id => {
    const rate = yieldRate(id, me.level), hold = holdOf(id, me.level), perM3 = best?.ores[0].perM3 || 0, fill = hold / rate;
    return `<tr><td>${esc(SHIPS[id].name)}${me.ship === id ? '<small>current ship</small>' : ''}</td><td>${canFly(id, me.level) ? '<span class="pos">Yes</span>' : `<span class="neg">Train ${id === 32880 ? 'Mining Frigate' : 'Mining Barge'} I</span>`}</td><td>${Math.round(rate * 60).toLocaleString()}</td><td>${Math.round(hold).toLocaleString()}</td><td>${perM3 ? format(rate * 3600 * fill / (fill + 240) * perM3, 'isk') : '—'}</td></tr>`;
  }).join('');
  const NEXT = [[SKILL.miningFrigate, 1, 'Fly the Venture: a free-to-replace starter miner'], [SKILL.mining, 4, 'Miner II: +50% laser yield, and +5% per level'], [SKILL.astrogeology, 3, '+5% yield per level'],
    [SKILL.miningBarge, 1, 'Fly the Procurer, Retriever or Covetor: about 3× a Venture'], [SKILL.reprocessing, 4, 'Better mineral yield when ore sells for less than its minerals'], [SKILL.miningFrigate, 3, '+5% Venture yield per level']];
  const skillName = {[SKILL.mining]:'Mining', [SKILL.astrogeology]:'Astrogeology', [SKILL.miningFrigate]:'Mining Frigate', [SKILL.miningBarge]:'Mining Barge', [SKILL.reprocessing]:'Reprocessing'};
  const next = me.known ? NEXT.filter(([id, lvl]) => me.level(id) < lvl).slice(0, 3).map(([id, level, why]) => ({name:skillName[id], level, from:me.level(id), why})) : [];
  const oreRows = [...mine1.values.values()].sort((a, b) => b.perM3 - a.perM3).map(v => `<tr><td>${esc(v.n)}</td><td>${format(v.perM3, 'isk')}</td><td>${esc(v.how)}</td><td>${format(v.raw, 'isk')}</td><td>${format(v.compressed, 'isk')}</td><td>${format(v.refined, 'isk')}</td></tr>`).join('');
  status.textContent = `Ore priced from hub buy orders, kills and traffic from the last hour · ${scannedAgo()}`;
  content.innerHTML = `
  <article class="card"><div class="card-head"><div><h3>Mine now · ${esc(me.p.name)}</h3><p class="hint">${shipLine(mine1)}. Ranked by ISK per hour at the belt, lowered by recent kills, heavy traffic and travel time over a 2-hour session.</p></div></div>
    ${me.known ? '' : `<p class="hint">Connect ${esc(me.p.name)} to use real skills, ship and location.</p>`}
    ${sitesHtml(mine1)}
  </article>
  <div class="grid">
    <article class="card"><h3>${mate ? `${esc(mate.p.name)}’s best spots` : 'Wingmate'}</h3>
      ${mate1 ? `<p class="hint">${shipLine(mate1)} · from ${esc(sysName(mate1.start))}${mate.location ? '' : ' (their location isn’t shared, so this uses yours)'}.</p>${mate1.list.length ? `<ul class="plain">${mate1.list.map(s => `<li><b>${chip(s.system)} ${esc(s.system.name)}</b><small>${s.jumps ? plural(s.jumps, 'jump') : 'here'} · ${esc(s.ores[0].n)} · ${format(s.iskHour, 'isk')}/h${s.kills ? ` · <span class="neg">${s.kills} killed last hour</span>` : ''}</small></li>`).join('')}</ul>` : '<p class="hint">No belts in range.</p>'}${mate1.list[0] && best && mate1.list[0].system.id === best.system.id ? '<p class="alert ok">You both do best here. Mine together and share one hauler trip.</p>' : ''}` : '<p class="hint">No wingmate data yet.</p>'}
    </article>
    <article class="card"><h3>Last 30 days</h3><h4>${esc(me.p.name)}</h4>${ledgerHtml(me)}${mate ? `<h4>${esc(mate.p.name)}</h4>${ledgerHtml(mate)}` : ''}</article>
  </div>
  <article class="card"><h3>Ships</h3><p class="hint">Two Miner I/II on the Venture, two Strip Miner I on barges, with ${esc(me.p.name)}’s skills; ISK/h at ${best ? esc(best.system.name) : 'the best site'}. Hull bonuses are estimates; your ledger shows the real rate.</p>
    <table class="bill"><thead><tr><th>Ship</th><th>Can fly</th><th>m³/min</th><th>Hold m³</th><th>ISK/h</th></tr></thead><tbody>${shipRows}</tbody></table>
    ${next.length ? `<h3>Train next</h3>${trainNext(next)}` : ''}
  </article>
  <article class="card"><h3>What ore is worth</h3><p class="hint">ISK per unit after sales tax, sold into the best hub buy order. Reprocessed uses ${esc(me.p.name)}’s reprocessing skills at an NPC station. II–IV-Grade ore pays 5–15% more.</p>
    <table class="bill"><thead><tr><th>Ore</th><th>ISK/m³</th><th>Best as</th><th>Raw</th><th>Compressed</th><th>Minerals</th></tr></thead><tbody>${oreRows}</tbody></table>
  </article>`;
}

// ── Explore: the quietest systems within reach, a scanning loop through them, and how to get better at it. ──
const EXPLORED_KEY = 'eve-explored:v1';
let scoutData = null;
function explored() { try { return JSON.parse(localStorage.getItem(EXPLORED_KEY)) || {}; } catch { return {}; } }
function markExplored(id) { const m = explored(); m[id] = Date.now(); try { localStorage.setItem(EXPLORED_KEY, JSON.stringify(m)); } catch { /* Not remembered in this browser. */ } }
async function eveScout() {
  if (scoutData && Date.now() - scoutData.at < 300000) return scoutData.list;
  const list = await json('https://api.eve-scout.com/v2/public/signatures', {headers:{Accept:'application/json'}});
  scoutData = {at:Date.now(), list:Array.isArray(list) ? list : []};
  return scoutData.list;
}
export async function renderExploration() {
  const t = await tabReady('explore', 'Reading traffic across New Eden…', 'Exploration');
  if (!t) return;
  const {status, content, stale} = t, g = mapGraph(), meta = S.marketData.meta?.data || {};
  if (!g?.systems.size) { status.textContent = 'The map appears after the next pipeline run.'; content.innerHTML = ''; return; }
  systemOptions($('#explore-system'));
  const from = Number($('#explore-system').value), maxJumps = Number($('#explore-jumps').value), tolerance = $('#explore-tolerance').value, loopSize = Number($('#explore-loop').value);
  const bands = new Set([...document.querySelectorAll('[data-band]')].filter(b => b.checked).map(b => b.dataset.band));
  if (!bands.size) { status.textContent = 'Pick at least one security band.'; content.innerHTML = ''; return; }
  // The same route mode rankSystems used, so previews match the jump counts.
  const safe = !bands.has('low') && !bands.has('null');
  const p = mine(), o = wingmate(), x = summary(p), skillLevel = id => levelOf(x.skills, id);
  const level = key => key === 'frigate' ? Math.max(...['amarrFrigate', 'caldariFrigate', 'gallenteFrigate', 'minmatarFrigate'].map(k => level(k))) : skillLevel(meta.skills?.[key]);
  const trail = pl => (pl?.private ? pl.ops?.trail?.value : S.wing.get(pl?.id)?.trail) || [];
  const visited = visitedMap(trail(p), trail(o), Object.entries(explored()).map(([id, at]) => [Number(id), at]));
  const traffic = meta.traffic?.s || {}, kills = Object.fromEntries(Object.entries(meta.risk?.s || {}).map(([id, v]) => [id, v[0]]));
  const hour = {jumps:Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[2]])), kills:Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[0]]))};
  const list = rankSystems(g, from, {traffic, kills, hour, bands, maxJumps, visited, tolerance, limit:20});
  const start = g.systems.get(from), hours = meta.traffic?.since ? (Date.now() - meta.traffic.since) / 3600000 : 0;
  status.textContent = `${list.length} systems ranked within ${maxJumps} jumps of ${start?.name || 'you'} · traffic from ${hours >= 24 ? 'the last day' : hours >= 1 ? `${Math.round(hours)} hours of history` : 'the last hour (history is still building)'} · ${visited.size} recently visited ${visited.size === 1 ? 'system' : 'systems'} pushed down`;
  // A loop through the best picks, back to the start, in the safest order.
  const picks = list.filter(r => r.system.id !== from).slice(0, loopSize).map(r => r.system.id);
  const loop = picks.length ? routePlan(g, [from, ...picks], {history:meta.risk?.s || {}, traffic:hour.jumps, value:0, hull:'t1'}, {mode:'safest', optimize:true, end:'return', lowsec:!safe}) : null;
  const maxDay = Math.max(1, ...list.map(r => r.traffic)), best = Math.max(1e-9, ...list.map(r => r.score));
  const ago = at => { const h = (Date.now() - at) / 3600000; return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
  const row = (r, n) => `<li class="opp explore" style="--i:${n}" ${r.jumps ? routeAttrs((route(from, r.system.id, safe)?.systems || []).map(s => s.id), `${start?.name} → ${r.system.name}`) : ''}>
    <div class="opp-main"><b><button type="button" class="light-btn" data-system="${r.system.id}" aria-label="${esc(r.system.name)} on the map">${secLight(r.system.sec)}</button> <a href="${dotlanSystem(r.system.name)}" data-system="${r.system.id}">${esc(r.system.name)}</a></b>
      <small>${esc(regionName(r.system.region))} · ${r.jumps ? plural(r.jumps, 'jump') : 'you are here'}${r.deadEnd ? ' · <span class="tag">Dead end</span>' : ''}</small>
      <small class="flags"><span class="tag dim">${esc(r.pirates)}</span>${r.visited ? `<span class="tag flag">Visited ${ago(r.visited)}</span>` : ''}</small></div>
    <div class="opp-route"><span class="meter" title="Jumps over about a day"><i style="width:${Math.max(2, 100 * r.traffic / maxDay).toFixed(0)}%"></i></span><span>${Math.round(r.traffic).toLocaleString()} jumps a day · ${r.kills ? `<span class="${r.kills >= 3 ? 'neg' : 'warn-text'}">${plural(Math.round(r.kills), 'ship kill')}</span>` : 'no kills'} over ~24 h</span></div>
    <div class="opp-profit"><b class="${r.score >= best * 0.5 ? 'pos' : ''}" title="Score relative to the best pick">${Math.max(1, Math.round(100 * r.score / best))}</b><small>quiet ${Math.round(r.quiet * 100)}% · safe ${Math.round(r.safe * 100)}%</small><button type="button" class="secondary small" data-mark="${r.system.id}">${r.visited ? 'Scanned again' : 'Mark scanned'}</button></div></li>`;
  const explorer = explorerFor(level), next = exploreSkills(level);
  const known = Boolean(x.skills?.skills);
  const label = k => ({frigate:`${explorer.race} Frigate`, astrometrics:'Astrometrics', hacking:'Hacking', archaeology:'Archaeology', cpuManagement:'CPU Management', rangefinding:'Astrometric Rangefinding', survey:'Survey', pinpointing:'Astrometric Pinpointing', acquisition:'Astrometric Acquisition', cloaking:'Cloaking', covertOps:'Covert Ops'})[k];
  content.innerHTML = `
  <article class="card"><div class="card-head"><div><h3>Where to scan · ${esc(p?.name || 'you')}</h3><p class="hint">EVE doesn’t publish signature counts, so “least explored” means least travelled: fewer ships through a system means fewer explorers clearing its sites. Ranked by quiet (jumps over ~24 h), safety (ship kills, weighted by your risk setting), distance and dead ends, and systems you or ${esc(o?.name || 'your wingmate')} visited lately sink.</p></div></div>
    ${list.length ? `<ol class="opps">${list.map(row).join('')}</ol>` : `<p class="hint">No ${[...bands].map(b => BANDS[b]).join(' or ').toLowerCase()} systems within ${maxJumps} jumps.</p>`}
  </article>
  <div class="grid">
    <article class="card"><h3>Tonight’s loop</h3>
      ${loop && !loop.unreachable ? `<p class="hint">The ${loop.stops.length - 2} best systems, in the order with the fewest jumps, back to ${esc(start.name)}.</p>
        <ol class="plain loop" ${routeAttrs(loop.route, 'Exploration loop')}>${loop.stops.slice(1, -1).map(id => { const s = g.systems.get(id); return `<li><button type="button" class="link-btn" data-system="${id}">${secLight(s.sec)} ${esc(s.name)}</button><small>${esc(regionName(s.region))}</small></li>`; }).join('')}</ol>
        <dl class="facts">${fact('Jumps', loop.jumps)}${fact('Time', `~${Math.round(loop.jumps * 1 + (loop.stops.length - 2) * 12)} min<small>1 min a jump, ~12 min scanning a system</small>`)}${fact('Arrive safely', `${Math.round(loop.survival * 1000) / 10}%`)}</dl>
        <div class="actions">${mapButton(loop.route, 'Exploration loop')}<a class="button secondary" href="${dotlanRoute(loop.stops.map(id => g.systems.get(id).name))}" target="_blank" rel="noopener noreferrer">Dotlan ↗</a>${autopilotButton(sendable(loop.route, loop.stops), 'explore-sent')}</div>` : '<p class="hint">Nothing to loop through with these settings.</p>'}
    </article>
    <article class="card"><h3>Your explorer</h3>
      <p><b>${esc(explorer.ship)}</b> <span class="hint">${known ? explorer.level ? `${esc(explorer.race)} Frigate ${ROMAN[explorer.level]}` : `train ${esc(explorer.race)} Frigate I to fly it` : 'connect to match your skills'}</span></p>
      <ul class="plain"><li>Core Probe Launcher, Relic Analyzer and Data Analyzer<small>The three modules every relic and data site needs; add a Scan Rangefinding Array if CPU allows.</small></li><li>Read the can before hacking<small>Relic sites drop blueprints and salvage; data sites drop datacores, decryptors and skill books. Leave the last can if a site keeps failing.</small></li><li>Watch local<small>In high-sec, the risk is mostly a gank at gates or someone cargo-scanning your loot. Dock up the haul now and then.</small></li></ul>
      ${next.length ? `<h3>Train next</h3>${trainNext(next.map(k => ({...k, name:label(k.key)})))}` : ''}
    </article>
  </div>
  <article class="card" id="explore-scout"><h3>Wormhole shortcuts · for later</h3><p class="hint">Live Thera and Turnur connections from EVE-Scout. Wormhole space and null-sec hold the richest relic and data sites once you fly a covert-ops ship.</p><div class="shimmer">Asking EVE-Scout…</div></article>`;
  const scoutCard = content.querySelector('#explore-scout');
  const drawScout = sigs => {
    if (stale()) return;
    const near = shortcuts(g, from, sigs, {maxJumps:15});
    scoutCard.querySelector('.shimmer')?.remove();
    scoutCard.insertAdjacentHTML('beforeend', near.length ? `<ol class="plain">${near.map(c => `<li ${routeAttrs((route(from, c.system.id, false)?.systems || []).map(s => s.id), `${start.name} → ${c.system.name}`)}><button type="button" class="link-btn" data-system="${c.system.id}">${secLight(c.system.sec)} ${esc(c.system.name)}</button> → <b>${esc(c.hub)}</b><small>${plural(c.jumps, 'jump')}${c.lowsec ? ' · <span class="neg">through low-sec</span>' : ''} · ${esc(c.size || '?')} ships · ${esc(c.hours ?? '?')} h left${c.signature ? ` · signature ${esc(c.signature)}` : ''}</small></li>`).join('')}</ol>` : '<p class="hint">No Thera or Turnur connection within 15 jumps right now.</p>');
  };
  eveScout().then(drawScout, error => { if (stale()) return; scoutCard.querySelector('.shimmer')?.remove(); scoutCard.insertAdjacentHTML('beforeend', `<p class="hint">EVE-Scout unavailable: ${esc(error.message)}</p>`); });
}

export function wire() {
  $('#market-origin').onchange = $('#market-jumps').onchange = () => renderMarket();
  $('#market-budget').onchange = $('#market-cargo').onchange = event => { event.target.dataset.touched = '1'; renderMarket(); };
  $('#industry-system').onchange = $('#industry-over').onchange = $('#industry-category').onchange = $('#industry-sort').onchange = () => renderIndustry();
  $('#industry-budget').onchange = event => { event.target.dataset.touched = '1'; renderIndustry(); };
  $('#mining-system').onchange = $('#mining-ship').onchange = $('#mining-jumps').onchange = $('#mining-lowsec').onchange = () => renderMining();
  ['explore-system', 'explore-jumps', 'explore-tolerance', 'explore-loop'].forEach(id => { $(`#${id}`).onchange = () => renderExploration(); });
  document.querySelectorAll('[data-band]').forEach(b => b.onchange = () => renderExploration());
  $('#explore-content').addEventListener('click', event => { const b = event.target.closest('[data-mark]'); if (b) { markExplored(Number(b.dataset.mark)); renderExploration(); } });
}
