// Earn: Build (industry), Mine, Explore and Trade (market), each sized to the pilot's ship, skills and wallet.
// Every view: a sticky toolbar, a summary (at most three figures), one ranked, sortable list, and details in the drawer.
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
import {$, esc, format, plural, pct, duration, scannedAgo, trainNext, routeAttrs, mapButton, tabReady, openDrawer, toast, skeleton} from '../shared.js';
import {mapGraph, route, routeCache, routeIds, sendable, autopilotButton, legHtml, systemOptions, regionName} from '../routes.js';

// ── Shared building blocks ──
const tf = (label, control) => `<label class="tf">${label}${control}</label>`;
// Ids are passed as literal id="…" text so the markup block lists every control (tests/package.test.js checks it).
const filterBox = (id, what) => `<input ${id} class="tf-filter" type="search" data-filter placeholder="Filter ${what}" aria-label="Filter ${what}" aria-keyshortcuts="/" autocomplete="off">`;
const sortBox = (id, opts, cls = '') => `<label class="tf ${cls}">Sort<select ${id} data-sort-select>${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`;
const sw = (id, label, extra = '') => `<label class="sw"><input ${id} type="checkbox" ${extra}><span>${label}</span></label>`;
const bar = (label, html) => `<div class="toolbar earn-bar" role="toolbar" aria-label="${label}">${html}</div>`;
const wrap = (bar, status, content) => `<div class="earn">${bar}<p ${status} class="earn-status" role="status"></p><div ${content} class="earn-content">${skeleton('Loading…')}</div></div>`;

export const markup = {
  industry:wrap(bar('Build options', `
   ${tf('From', '<select id="industry-system"></select>')}
   ${tf('Budget', '<input id="industry-budget" type="number" min="0" step="1000000" placeholder="Your wallet" inputmode="numeric">')}
   ${tf('Category', '<select id="industry-category"><option value="">All</option></select>')}
   ${sortBox('id="industry-sort"', [['', 'Best overall'], ['profit', 'Profit per day'], ['payback', 'Fastest payback'], ['margin', 'Highest margin'], ['invest', 'Lowest start cost'], ['cheap', 'Cheapest blueprint'], ['near', 'Closest seller']])}
   ${sw('id="industry-over"', 'Over budget')}
   ${filterBox('id="industry-filter"', 'blueprints')}`), 'id="industry-status"', 'id="industry-content"'),
  mining:wrap(bar('Mining options', `
   ${tf('From', '<select id="mining-system"></select>')}
   ${tf('Ship', '<select id="mining-ship"><option value="">Current or best</option><option value="32880">Venture</option><option value="17480">Procurer</option><option value="17478">Retriever</option><option value="17476">Covetor</option></select>')}
   ${tf('Within', '<select id="mining-jumps"><option value="3">3 jumps</option><option value="6" selected>6 jumps</option><option value="10">10 jumps</option></select>')}
   ${sw('id="mining-lowsec"', 'Low-sec')}
   ${sortBox('id="mining-sort"', [['', 'Best ISK/h'], ['jumps', 'Fewest jumps'], ['kills', 'Fewest kills'], ['traffic', 'Least traffic']], 'tf--m')}
   ${filterBox('id="mining-filter"', 'belts')}`), 'id="mining-status"', 'id="mining-content"'),
  exploration:wrap(bar('Exploration options', `
   ${tf('From', '<select id="explore-system"></select>')}
   ${tf('Within', '<select id="explore-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="15">15 jumps</option><option value="20">20 jumps</option></select>')}
   ${tf('Risk', '<select id="explore-tolerance"><option value="careful">Careful</option><option value="normal" selected>Normal</option><option value="bold">Bold</option></select>')}
   ${tf('Loop', '<select id="explore-loop"><option value="4">4 systems</option><option value="6" selected>6 systems</option><option value="8">8 systems</option><option value="10">10 systems</option></select>')}
   <span class="bands" role="group" aria-label="Security">${sw('id="band-hi"', 'High', 'data-band="hi" checked')}${sw('id="band-low"', 'Low', 'data-band="low"')}${sw('id="band-null"', 'Null', 'data-band="null"')}</span>
   ${sortBox('id="explore-sort"', [['', 'Best score'], ['jumps', 'Fewest jumps'], ['traffic', 'Quietest'], ['kills', 'Fewest kills']], 'tf--m')}
   ${filterBox('id="explore-filter"', 'systems')}`), 'id="explore-status"', 'id="explore-content"'),
  market:wrap(bar('Trade options', `
   ${tf('From', '<select id="market-origin"></select>')}
   ${tf('Buy within', '<select id="market-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="20">20 jumps</option><option value="99">Any distance</option></select>')}
   ${tf('Cargo m³', '<input id="market-cargo" type="number" min="1" step="100" value="5000" inputmode="numeric">')}
   ${tf('Budget', '<input id="market-budget" type="number" min="0" step="1000000" placeholder="Your wallet" inputmode="numeric">')}
   ${sortBox('id="market-sort"', [['', 'Best first']], 'tf--m')}
   ${filterBox('id="market-filter"', 'items')}`), 'id="market-status"', 'id="market-content"')
};

const PREFIX = {industry:'industry', mining:'mining', exploration:'explore', market:'market'};
const store = {get:k => { try { return localStorage.getItem(k); } catch { return null; } }, set:(k, v) => { try { localStorage.setItem(k, v); } catch { /* Per-browser convenience only. */ } }};
const short = v => format(v, 'isk').replace(' ISK', '');
const state = (title, text, button = '') => `<div class="state state--empty"><p><b>${title}</b> ${text}</p>${button}</div>`;
const readout = items => `<dl class="readout">${items.map(([dt, dd, small]) => `<div><dt>${dt}</dt><dd>${dd}${small ? ` <small>${small}</small>` : ''}</dd></div>`).join('')}</dl>`;
const facts = rows => `<dl class="ed-facts">${rows.filter(Boolean).map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}</dl>`;
const ed = html => `<div class="ed">${html}</div>`;
const cell = (html, cls = 'num') => `<span role="cell" class="${cls}">${html}</span>`;
const jumpsText = j => j === null || j === undefined ? '—' : j === 0 ? 'here' : `${j} j`;

// Each view's last render leaves its row → drawer builder and its extra drawers here.
const picks = {}, extras = {}, revealed = new Set();
// Sort header keys and their direction (aria-sort); the toolbar <select> holds the chosen key.
const DIRS = {profit:'descending', payback:'ascending', margin:'descending', invest:'ascending', cheap:'ascending', near:'ascending', isk:'descending', jumps:'ascending', kills:'ascending', traffic:'ascending', score:'descending', perJump:'descending', daily:'descending', materials:'ascending'};
function table(view, label, cols, head, rows) {
  const sel = $(`#${PREFIX[view]}-sort`)?.value || '';
  const reveal = rows.length && !revealed.has(view);
  if (rows.length) revealed.add(view);
  return `<div class="rows${reveal ? ' rows--reveal' : ''}" role="table" aria-label="${esc(label)}" style="--cols:${cols}">
    <div class="rows__head" role="row">${head.map(([text, key]) => key ? `<button type="button" role="columnheader" class="sort" data-sort="${key}" aria-sort="${sel === key ? DIRS[key] : 'none'}">${text}</button>` : `<span role="columnheader">${text}</span>`).join('')}</div>
    ${rows.join('')}</div><p class="rows__none hint" hidden>No rows match this filter.</p>`;
}
const row = (i, find, cells, {dim, attrs = ''} = {}) => `<div class="rows__row${dim ? ' is-dim' : ''}" role="row" data-row tabindex="0" data-pick="${i}" data-find="${esc(find.toLowerCase())}" style="--i:${i}" ${attrs}>${cells.join('')}</div>`;
const sorted = (view, list, cmps) => { const k = $(`#${PREFIX[view]}-sort`).value; return cmps[k] ? [...list].sort(cmps[k]) : list; };
function applyFilter(view) {
  const q = ($(`#${PREFIX[view]}-filter`)?.value || '').trim().toLowerCase(), rows = [...document.querySelectorAll(`#${view} [data-row]`)];
  rows.forEach(r => { r.hidden = Boolean(q) && !r.dataset.find.includes(q); });
  const none = $(`#${view} .rows__none`);
  if (none) none.hidden = !rows.length || rows.some(r => !r.hidden);
}
function failed(view) {
  if (S.marketData) return; // a newer run is drawing this view
  const p = PREFIX[view], content = $(`#${p}-content`);
  content.innerHTML = S.backend ? `<div class="state state--error" role="alert"><p><b>Market data didn’t load.</b> ${esc($(`#${p}-status`).textContent)}</p><button type="button" class="secondary small" data-retry>Try again</button></div>`
    : state('Live planning needs the backend.', 'Set <code>backendUrl</code> in config.json, then reload.');
}
const stateButton = (label, set) => `<button type="button" class="secondary small" data-set="${set}">${label}</button>`;

// ── Trade ──
const cargo = new Map();
const TRADE_LISTS = {haul:'Haul & flip', spread:'Station spreads', build:'Manufacturing'};
const TRADE_SORTS = {haul:[['', 'Profit per jump'], ['profit', 'Total profit'], ['invest', 'Lowest investment'], ['jumps', 'Fewest jumps']],
  spread:[['', 'Best first'], ['margin', 'Highest margin'], ['daily', 'Most per day'], ['jumps', 'Fewest jumps']],
  build:[['', 'Best first'], ['profit', 'Profit per run'], ['margin', 'Highest margin'], ['materials', 'Cheapest materials']]};
let tradeList = TRADE_LISTS[store.get('eve.trade.list')] ? store.get('eve.trade.list') : 'haul';
function tradeSortOptions() {
  const sel = $('#market-sort');
  if (sel.dataset.list === tradeList) return;
  sel.innerHTML = TRADE_SORTS[tradeList].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.dataset.list = tradeList;
  sel.value = TRADE_SORTS[tradeList].some(([v]) => v === store.get(`eve.sort.market.${tradeList}`)) ? store.get(`eve.sort.market.${tradeList}`) : '';
}
export async function renderMarket() {
  const t = await tabReady('market', 'Scanning stations…', 'Market analysis');
  if (!t) return failed('market');
  const {status, content} = t, {marketData, marketBook} = S;
  if (!marketData.regions.length) { status.textContent = 'The hourly market pipeline has not stored any data yet. Check back after its next run.'; content.innerHTML = state('No market data yet.', 'The hourly pipeline stores its first scan on its next run. Press Refresh after that.'); return; }
  const p = mine(), meta = marketData.meta?.data || {types:{}};
  const origin = $('#market-origin');
  systemOptions(origin);
  const ship = p?.ops?.ship?.value?.ship_type_id, cargoInput = $('#market-cargo');
  if (ship && !cargoInput.dataset.touched) {
    if (!cargo.has(ship)) { try { cargo.set(ship, (await esi(`universe/types/${ship}/`)).capacity || 0); } catch { cargo.set(ship, 0); } }
    if (t.stale()) return;
    if (cargo.get(ship) > 0) cargoInput.value = Math.round(cargo.get(ship));
  }
  tradeSortOptions();
  const skills = summary(p).skills, f = fees(skills, meta.skills);
  const from = Number(origin.value), maxJumps = Number($('#market-jumps').value), hold = Math.max(1, Number(cargoInput.value) || 5000);
  // Size every suggestion to the pilot's wallet unless they type another budget.
  const budgetInput = $('#market-budget'), wallet = summary(p).wallet;
  if (!budgetInput.dataset.touched && wallet !== undefined) budgetInput.value = Math.floor(wallet);
  const budget = budgetInput.value === '' ? Infinity : Math.max(0, Number(budgetInput.value));
  status.textContent = `${plural(marketData.regions.length, 'region')} · ${plural(Object.keys(meta.types).length, 'item')} · ${scannedAgo()} by the hourly pipeline`;
  const feesText = `Sales tax ${(f.salesTax * 100).toFixed(2)}% · broker fee ${(f.brokerFee * 100).toFixed(2)}% · ${skills?.skills ? `from ${p.name}’s skills` : 'base rates (connect for your skills)'} · cargo ${hold.toLocaleString()} m³ · budget ${Number.isFinite(budget) ? format(budget, 'isk') : 'unlimited'}`;
  const g = mapGraph(), sys = loc => marketBook.stations.get(loc)?.system, station = loc => marketBook.stations.get(loc)?.name || `Station ${loc}`;
  const sysName = id => g?.systems.get(id)?.name || name(id);
  const item = id => meta.types[id]?.n || name(id);
  const haulList = hauls(marketBook, {salesTax:f.salesTax, cargo:hold, volumeOf:id => meta.types[id]?.v, budget, limit:40});
  const trades = stationTrades(marketBook, {...f, budget, limit:60});
  const index = S.costIndices.get(from)?.manufacturing || 0;
  const allBuilds = manufacturing(marketBook, meta.recipes, {...f, adjusted:S.adjusted, costIndex:index, alpha:isAlpha(skills)});
  const builds = allBuilds.filter(b => b.capital <= budget).slice(0, 12), tooDear = allBuilds.filter(b => b.profit > 0 && b.capital > budget).length;
  // Jump counts come from the same safe gate routes the previews draw.
  const jumps = (a, b) => route(a, b)?.jumps ?? null, near = j => j !== null && j <= maxJumps;
  const haulRows = haulList.map(h => ({...h, toA:jumps(from, sys(h.from.loc)), ab:jumps(sys(h.from.loc), sys(h.to.loc))}))
    .filter(h => near(h.toA) && h.ab !== null).map(h => ({...h, perJump:h.profit / Math.max(1, h.toA + h.ab)})).sort((a, b) => b.perJump - a.perJump).slice(0, 12);
  const tradeRows = trades.map(t => ({...t, j:jumps(from, sys(t.loc))})).filter(t => near(t.j)).slice(0, 12);
  const buildRows = builds.map(b => ({...b, j:jumps(from, sys(b.loc))}));
  const tripIds = stops => g && stops.every(id => g.systems.has(id)) ? routeIds(stops) : [];
  const SORTS = {haul:{profit:(a, b) => b.profit - a.profit, invest:(a, b) => a.invest - b.invest, jumps:(a, b) => (a.toA + a.ab) - (b.toA + b.ab)},
    spread:{margin:(a, b) => b.margin - a.margin, daily:(a, b) => b.daily - a.daily, jumps:(a, b) => a.j - b.j},
    build:{profit:(a, b) => b.profit - a.profit, margin:(a, b) => b.margin - a.margin, materials:(a, b) => a.materials - b.materials}};
  const list = sorted('market', {haul:haulRows, spread:tradeRows, build:buildRows}[tradeList], SORTS[tradeList]);
  const whole = h => h.invest >= budget * 0.95;
  const legTo = (title, loc, a) => legHtml(title, station(loc), route(a, sys(loc)));
  let main, drawer;
  if (tradeList === 'haul') {
    main = list.length ? table('market', 'Hauls and flips', 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 80px 84px 92px', [['Item'], ['Buy at', 'jumps'], ['Sell at'], ['Invest', 'invest'], ['Profit', 'profit'], ['Per jump']],
      list.map((h, i) => row(i, `${item(h.type)} ${station(h.from.loc)} ${station(h.to.loc)}`, [
        cell(`<b>${esc(item(h.type))}</b>${whole(h) ? '<span class="tag">Whole budget</span>' : ''}<small class="rows__meta">${esc(sysName(sys(h.from.loc)))} → ${esc(sysName(sys(h.to.loc)))} · ${h.toA + h.ab} j · ${h.units.toLocaleString()} units</small>`, 'rows__main'),
        cell(`${esc(sysName(sys(h.from.loc)))} <em>${jumpsText(h.toA)}</em>`, 'rows__txt'), cell(`${esc(sysName(sys(h.to.loc)))} <em>+${h.ab} j</em>`, 'rows__txt'),
        cell(short(h.invest)), cell(`+${short(h.profit)}`, 'num num--pos'), cell(short(h.perJump), 'num rows__key')], {attrs:tripIds([from, sys(h.from.loc), sys(h.to.loc)]).length > 1 ? routeAttrs(tripIds([from, sys(h.from.loc), sys(h.to.loc)]), `Haul ${item(h.type)}`) : ''})))
      : state(`No profitable hauls within ${maxJumps} jumps for this cargo size.`, 'Widen the buy range or raise the budget.', stateButton('Search any distance', 'market-jumps=99'));
    drawer = i => { const h = list[i], ids = tripIds([from, sys(h.from.loc), sys(h.to.loc)]);
      return {title:item(h.type), body:ed(`${readout([['Profit', `+${short(h.profit)}`, 'ISK'], ['Per jump', short(h.perJump), 'ISK'], ['Invest', short(h.invest), 'ISK']])}
        ${facts([['Cargo', `${h.units.toLocaleString()} units · ${Math.round(h.m3).toLocaleString()} m³`], ['Buy', `${format(h.from.price, 'isk')} each · ${esc(station(h.from.loc))}`], ['Sell', `${format(h.to.price, 'isk')} each · ${esc(station(h.to.loc))}`], whole(h) && ['Budget', 'This uses your whole budget']])}
        <h3 class="ed-h">Route</h3><ol class="legs"><li>${legTo('Fly to buy', h.from.loc, from)}</li><li>${legTo('Haul and sell', h.to.loc, sys(h.from.loc))}</li></ol>
        <p class="hint">Buy from a sell order, fly, sell into a buy order. Prices move: check both orders before you undock.</p>`),
        foot:`${mapButton(ids, `Haul ${item(h.type)}`)}${autopilotButton(ids.length > 1 ? sendable(ids, [from, sys(h.from.loc), sys(h.to.loc)]) : [], 'market-sent')}`}; };
  } else if (tradeList === 'spread') {
    main = list.length ? table('market', 'Station spreads', 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.1fr) 90px 70px 90px', [['Item'], ['Station', 'jumps'], ['Bid → ask'], ['Volume/day'], ['Margin', 'margin'], ['Per day', 'daily']],
      list.map((t, i) => row(i, `${item(t.type)} ${station(t.loc)}`, [
        cell(`<b>${esc(item(t.type))}</b><small class="rows__meta">${esc(sysName(sys(t.loc)))} · ${(t.margin * 100).toFixed(1)}% margin</small>`, 'rows__main'),
        cell(`${esc(sysName(sys(t.loc)))} <em>${jumpsText(t.j)}</em>`, 'rows__txt'), cell(`${short(t.buy)} → ${short(t.sell)}`), cell(Math.round(t.volume).toLocaleString()),
        cell(`${(t.margin * 100).toFixed(1)}%`, 'num num--pos'), cell(`~${short(t.daily)}`, 'num rows__key')])))
      : state(`No station spreads beat fees within ${maxJumps} jumps.`, 'Try another starting hub or a bigger budget.');
    drawer = i => { const t = list[i];
      return {title:item(t.type), body:ed(`${readout([['Margin', `${(t.margin * 100).toFixed(1)}%`], ['Per day', `~${short(t.daily)}`, 'ISK'], ['In orders', short(t.capital), 'ISK']])}
        ${facts([['Station', esc(station(t.loc))], ['Top bid', format(t.buy, 'isk')], ['Lowest ask', format(t.sell, 'isk')], ['Traded per day', Math.round(t.volume).toLocaleString()]])}
        <p class="hint">Place a buy order at the top bid and relist at the lowest ask. The estimate assumes you capture 5% of daily volume, with no more buy orders than your budget covers.</p>
        ${t.j ? `<h3 class="ed-h">Route</h3>${legTo('Fly to', t.loc, from)}` : ''}`)}; };
  } else {
    main = meta.recipesError ? state('Manufacturing data is missing.', esc(meta.recipesError)) : list.length ? table('market', 'Manufacturing margins', 'minmax(0,1.5fr) minmax(0,1fr) 90px 80px 90px 96px', [['Item'], ['Sells at'], ['Materials', 'materials'], ['Job'], ['Margin', 'margin'], ['Profit', 'profit']],
      list.map((b, i) => row(i, `${item(b.type)} ${station(b.loc)}`, [
        cell(`<b>${esc(item(b.type))}</b><small class="rows__meta">${(b.margin * 100).toFixed(1)}% margin · sells at ${esc(sysName(sys(b.loc)))}</small>`, 'rows__main'),
        cell(`${esc(sysName(sys(b.loc)))}${b.j === null ? '' : ` <em>${jumpsText(b.j)}</em>`}`, 'rows__txt'), cell(short(b.materials)), cell(short(b.job)), cell(`${(b.margin * 100).toFixed(1)}%`),
        cell(`${b.profit > 0 ? '+' : ''}${short(b.profit)}`, `num rows__key ${b.profit > 0 ? 'num--pos' : 'num--neg'}`)])))
      : state('No manufacturing data yet.', 'It appears after the next hourly scan.');
    drawer = i => { const b = list[i];
      return {title:item(b.type), body:ed(`${readout([['Profit per run', `${b.profit > 0 ? '+' : ''}${short(b.profit)}`, 'ISK'], ['Margin', `${(b.margin * 100).toFixed(1)}%`]])}
        ${facts([['Materials', format(b.materials, 'isk')], ['Job cost', format(b.job, 'isk')], ['Revenue', format(b.revenue, 'isk')], ['Sells at', esc(station(b.loc))], ['Sold per day', Math.round(b.daily).toLocaleString()]])}
        <p class="hint">One run with an ME 0 blueprint you own: materials at the cheapest scanned ask, product listed at the best ask, job cost at ${(index * 100).toFixed(2)}% system index + fees.</p>
        ${b.j ? `<h3 class="ed-h">Route</h3>${legTo('Fly to sell', b.loc, from)}` : ''}`)}; };
  }
  picks.market = drawer;
  const counts = {haul:haulRows.length, spread:tradeRows.length, build:buildRows.length};
  const subs = {haul:'Buy from a sell order, fly, sell into a buy order. Ranked by profit per jump.', spread:'Buy at the top bid, relist at the lowest ask. About 5% of daily volume, within your budget.',
    build:`One run with an ME 0 blueprint you own, at ${(index * 100).toFixed(2)}% system index + fees.${tooDear ? ` ${tooDear} more profitable ${tooDear === 1 ? 'build needs' : 'builds need'} more than ${format(budget, 'isk')}.` : ''}`};
  const best = haulRows[0];
  content.innerHTML = `
  <section class="panel earn-sum" aria-label="Summary">
    ${readout([['From', esc(sysName(from))], ['Budget', Number.isFinite(budget) ? short(budget) : 'Any', Number.isFinite(budget) ? 'ISK' : ''], ['Best haul', best ? `+${short(best.perJump)}` : '—', best ? 'ISK per jump' : '']])}
    <p class="earn-sum__line">${best ? `Best haul: ${esc(item(best.type))} from ${esc(sysName(sys(best.from.loc)))} to ${esc(sysName(sys(best.to.loc)))}, ${plural(best.toA + best.ab, 'jump')} in all.` : 'No haul pays for this cargo and budget right now.'}</p>
    <details class="fees"><summary>Fees and assumptions</summary><p id="market-fees">${esc(feesText)}</p></details>
  </section>
  <section class="panel panel--primary panel--flush earn-main">
    <div class="earn-main__head"><div class="seg" role="tablist" aria-label="Trade lists">${Object.entries(TRADE_LISTS).map(([k, l]) => `<button type="button" role="tab" data-trade="${k}" aria-selected="${k === tradeList}">${l} <span class="num seg__n">${counts[k]}</span></button>`).join('')}</div><p class="panel__sub">${esc(subs[tradeList])}</p></div>
    ${main}
  </section>`;
  applyFilter('market');
}

// ── Build ──
const SKILL_LABELS = {industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production', advancedMassProduction:'Advanced Mass Production', science:'Science', labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research', accounting:'Accounting', brokerRelations:'Broker Relations'};
export async function renderIndustry() {
  const t = await tabReady('industry', 'Pricing starter blueprints…', 'Industry planning');
  if (!t) return failed('industry');
  const {status, content} = t, {marketData, marketBook, costIndices, adjusted} = S;
  const meta = marketData.meta?.data || {}, catalog = meta.starters || [];
  if (!marketData.regions.length || !catalog.length) { status.textContent = 'The pipeline has not priced starter blueprints yet. Check back after its next hourly run.'; content.innerHTML = state('No blueprint prices yet.', 'The hourly pipeline prices starter blueprints on its next run. Press Refresh after that.'); return; }
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
  if (category.options.length !== categories.length + 1) { const prior = category.value; category.innerHTML = `<option value="">All</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}`; category.value = categories.includes(prior) ? prior : ''; }
  const skillOf = x.skills?.skills ? id => levelOf(x.skills, id) : undefined;
  const ranked = rank(catalog.filter(item => !category.value || item.cat === category.value).map(item => evaluate(item, {book:marketBook, adjusted, fees:f, index:buildIndex, researchIndex, levels, alpha, skillOf, budget})), budget)
    .map(pick => ({...pick, seller:sellerOf(pick)}));
  const SORTS = {profit:(a, b) => b.profitDay - a.profitDay, payback:(a, b) => a.payback - b.payback, margin:(a, b) => b.margin - a.margin, cheap:(a, b) => a.price - b.price, invest:(a, b) => a.invest - b.invest,
    near:(a, b) => (a.seller?.route.jumps ?? 999) - (b.seller?.route.jumps ?? 999)};
  // Only what the wallet covers, unless the pilot asks to see the rest.
  const showAll = $('#industry-over').checked, overBudget = ranked.filter(pick => !pick.affordable).length;
  const list = (SORTS[sortBy] ? [...ranked].sort((a, b) => (b.affordable - a.affordable) || SORTS[sortBy](a, b)) : ranked).filter(pick => showAll || pick.affordable).slice(0, 20);
  const jobTax = buildIndex + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0);
  const trip = pick => {
    if (!g) return {html:'<p class="hint">Routes appear after the next market pipeline run.</p>', foot:''};
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
    return {html:`<ol class="legs">${legs.map(l => `<li>${l}</li>`).join('')}</ol>`,
      foot:stops.length > 1 ? `<span class="ed-foot" ${routeAttrs(tripIds, `${pick.n} trip`)}>${mapButton(tripIds, `${pick.n}: whole trip`)}<a class="button small trip-link" href="${dotlanRoute(stops)}" target="_blank" rel="noopener noreferrer">Whole trip on Dotlan ↗</a></span>` : ''};
  };
  const bill = pick => `<table class="bill"><caption>A ${pick.runs}-run batch at ME ${pick.me}, bought in ${esc(pick.materialsRegion)}</caption><thead><tr><th>Material</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${pick.bill.map(b => `<tr><td>${esc(meta.types[b.type]?.n || name(b.type))}<small>${esc(at(b.loc).name)}</small></td><td>${b.qty.toLocaleString()}</td><td>${format(b.price, 'isk')}</td><td>${format(b.qty * b.price, 'isk')}</td></tr>`).join('')}</tbody></table>`;
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
  const flagList = pick => pick.flags.filter(fl => FLAGS[fl] && fl !== 'skills' && fl !== 'spike');
  const payback = days => days < 1 ? 'under a day' : `${days.toFixed(1)} days`;
  const pilotKey = who => esc(who.name.toLowerCase());
  status.textContent = `${catalog.length} cheap T1 blueprints that NPCs sell${meta.bpoSurvey ? ` (seller survey covers ${meta.bpoSurvey.regions}${meta.bpoSurvey.of > meta.bpoSurvey.regions ? ` of ${meta.bpoSurvey.of}` : ''} high-sec regions)` : ''}, priced from live orders · ${scannedAgo()}`;

  picks.industry = i => {
    const pick = list[i], who = owner(pick), tr = trip(pick);
    return {title:pick.n, foot:tr.foot, body:ed(`
      ${readout([['Profit', `+${short(pick.profitDay)}`, 'ISK/day'], ['Pays back', pick.payback < 1 ? '<1' : pick.payback.toFixed(1), 'days'], ['Start-up', short(pick.invest), 'ISK']])}
      <p class="ed-lead">${who ? `<span class="who" data-pilot="${pilotKey(who)}">In ${esc(who.name)}’s plan.</span> ` : pick.affordable ? '' : '<span class="neg">Over budget.</span> '}${pick.missing?.length ? `<span class="neg">Needs ${pick.missing.map(([id, lvl]) => `${esc(skillName(id))} ${ROMAN[lvl]}`).join(', ')}.</span>` : ''}</p>
      ${flagList(pick).length ? `<ul class="ed-flags">${flagList(pick).map(fl => `<li><span class="tag flag">${esc(FLAGS[fl][0])}</span> ${esc(FLAGS[fl][1])}</li>`).join('')}</ul>` : ''}
      ${facts([['Blueprint', `${esc(pick.cat)} · BPO ${format(pick.seller?.place.price ?? pick.price, 'isk')} · rank ${pick.rank}`],
        ['NPC sellers', pick.seller ? `NPC sells it at ${plural(pick.sellers.length, 'station')} · nearest ${pick.seller.route.jumps ? plural(pick.seller.route.jumps, 'jump') : 'here'}` : '<span class="neg">No NPC seller reachable through high-sec</span>'],
        ['Research', `ME 0 → ${pick.me} · ${duration(pick.research.seconds)} · ${format(pick.research.cost, 'isk')}`],
        ['Sells', `${pick.unitsPerDay >= 1 ? `${Math.round(pick.unitsPerDay).toLocaleString()}/day` : `1 every ${Math.round(1 / pick.unitsPerDay)} days`} at ${format(pick.sellPrice, 'isk')} · margin ${pct(pick.margin)}`],
        ['At ME 0', `${pick.profitAtZero > 0 ? '+' : ''}${format(pick.profitAtZero, 'isk')} per unit`],
        ['Start with', `${format(pick.invest, 'isk')}: blueprint, research and a ${pick.runs}-run batch`],
        ['Hub market', `${Math.round(pick.daily).toLocaleString()} traded/day · ${plural(pick.listings, 'station')} competing`],
        pick.trend !== null && ['Hub price', `<span class="${pick.trend > 0.15 ? 'neg' : pick.trend < -0.1 ? 'warn-text' : ''}">Hub price ${pick.trend >= 0 ? '+' : ''}${(pick.trend * 100).toFixed(0)}% vs 7-day average${pick.trend > 0.15 ? ' · likely a spike, expect it to fall' : pick.trend < -0.1 ? ' · below normal, may recover' : ''}</span>`]])}
      <h3 class="ed-h">Material bill</h3>${bill(pick)}
      <h3 class="ed-h">Trip plan</h3>${tr.html}`)};
  };
  extras.industry = {guide:() => ({title:'Build guide', body:ed(`
    <h3 class="ed-h">Your industry setup</h3>
    ${facts([['Clone', known ? (alpha ? 'Alpha · 4 build and 1 research slot at most' : 'Omega') : '—'], ['Build slots', known ? s.build : '—'], ['Research slots', known ? s.science : '—'],
      ['Job tax', `${pct(jobTax)} · ${factory ? `at ${esc(factory.system.name)}: ` : ''}index ${pct(buildIndex)} + facility + SCC${alpha ? ' + alpha' : ''}`], ['Selling fees', `${pct(f.salesTax + f.brokerFee)} · sales ${pct(f.salesTax)}, broker ${pct(f.brokerFee)}`], ['Budget', format(budget, 'isk')]])}
    <h3 class="ed-h">${esc(plan.name)}</h3>
    <div class="progress-row"><span class="stack"><i class="fill" style="width:${Math.min(100, (x.wallet || 0) / plan.goal * 100).toFixed(1)}%"></i></span><small>${format(x.wallet, 'isk')} of ${format(plan.goal, 'isk')}</small></div>
    <ol class="steps">${plan.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
    <h3 class="ed-h">Train next</h3>${next.length ? trainNext(next.map(k => ({...k, name:SKILL_LABELS[k.key]}))) : `<p class="hint">${alpha ? 'You have every industry skill an Alpha can train. Omega unlocks more slots and lower taxes.' : 'Core industry skills are done. Look at invention next.'}</p>`}
    <h3 class="ed-h">Avoid these traps</h3><ul class="plain traps">
      <li><b>Price your own ore at market value.</b><small>Minerals you mine could be sold; if a build earns less than selling them, sell them.</small></li>
      <li><b>Margins under ~${Math.round((f.salesTax + f.brokerFee) * 100 + 2)}% are losses for you.</b><small>Sales tax and broker fee alone take ${pct(f.salesTax + f.brokerFee)}; relisting adds more. Accounting and Broker Relations cut both.</small></li>
      <li><b>Batch your runs.</b><small>ME rounds up per job, so a 1-run job wastes materials that a 100-run job saves.</small></li>
      <li><b>Never leave a slot idle.</b><small>Research the next blueprint while the current one builds${s.science > 1 ? `; you have ${s.science} research slots` : ''}.</small></li>
      <li><b>Buy BPOs from the NPC market.</b><small>Unresearched T1 originals are always on the market at the NPC price; don’t overpay on contracts.</small></li>
      ${alpha ? '<li><b>Alpha tax.</b><small>Alphas pay an extra industry tax (CCP lists 2%; this page assumes it). Omega on the main builder removes it.</small></li>' : ''}
    </ul>
    <h3 class="ed-h">How picks are ranked</h3>
    <p class="hint">NPC-sold originals only, researched to the suggested ME, built in batches and sold at the lowest ask. Sale prices are capped at 15% over the 7-day average, materials are bought in one region, and thin, spiking or crowded markets rank lower. Assumes SCC surcharge ${pct(SCC.manufacturing)} on builds and ${pct(SCC.research)} on research, and ${pct(NPC_FACILITY_TAX)} NPC facility tax. Confirm against the in-game job window.</p>`),
    foot:'<button type="button" class="secondary small" data-go="training">Open training</button>'})};

  // Wing build plan: who builds what, as teamwork.
  const crew = [[p, mePlan, budget, known ? s.build : 2], ...(o ? [[o, themPlan, ox.wallet, ox.skills?.skills ? slots(oLevels).build : 2]] : [])];
  const builders = crew.filter(([, pl]) => pl.chosen.length);
  const wingLine = builders.length ? `${builders.map(([who, pl]) => `<b class="who" data-pilot="${pilotKey(who)}">${esc(who.name)}</b> builds ${esc(pl.chosen.map(c => c.n).join(' and '))}`).join(', ')}.${builders.length > 1 ? ' No overlap, so you don’t undercut each other.' : ''}`
    : 'Nothing fits the wing’s wallets with today’s prices yet.';
  const pilotCol = ([who, pl, wallet, free]) => `<div class="wplan__pilot" data-pilot="${pilotKey(who)}"><span class="wplan__name">${esc(who.name)}</span>${pl.chosen.length
    ? `<span class="num wplan__fig">+${short(pl.profitDay)} <small>ISK/day</small></span><small>${esc(pl.chosen.map(c => c.n).join(', '))} · start-up ${format(pl.spent, 'isk')} · ${pl.chosen.length} of ${free} slots · ${wallet === undefined ? '—' : `${format(wallet - pl.spent, 'isk')} left`}</small>`
    : `<small>Nothing fits ${wallet === undefined ? 'yet' : `a ${format(wallet, 'isk')} wallet`} with today’s prices.</small>`}</div>`;

  const affordable = ranked.filter(r => r.affordable), top = affordable[0];
  const cheaper = factory && factory.system.id !== system && factory.index < (idx.manufacturing ?? Infinity) * 0.8;
  const rows = list.map((pick, i) => { const who = owner(pick);
    return row(i, `${pick.n} ${pick.cat}`, [
      cell(`<b>${esc(pick.n)}</b><span class="tag">${esc(pick.cat)}</span>${who ? `<span class="who" data-pilot="${pilotKey(who)}">${esc(who.name)}’s plan</span>` : pick.affordable ? '' : '<span class="tag neg">Over budget</span>'}${pick.missing?.length ? '<span class="tag neg">Needs skills</span>' : ''}<small class="rows__meta">${pct(pick.margin)} margin · pays back in ${payback(pick.payback)} · ${short(pick.invest)} to start</small>`, 'rows__main'),
      cell(pick.seller ? jumpsText(pick.seller.route.jumps) : '<span class="neg">none</span>'), cell(pct(pick.margin)), cell(pick.payback < 1 ? '<1 d' : `${pick.payback.toFixed(1)} d`), cell(short(pick.invest)),
      cell(`+${short(pick.profitDay)}`, 'num num--pos rows__key')], {dim:!pick.affordable}); });
  const empty = overBudget && !showAll ? state(`Nothing profitable fits a ${format(budget, 'isk')} budget yet.`, `${overBudget} ${overBudget === 1 ? 'pick needs' : 'picks need'} more. Grow the wallet with the guide’s stage plan, or look at what’s over budget.`, stateButton('Show picks over budget', 'industry-over=on'))
    : state('No starter blueprint turns a profit at today’s prices with these fees.', 'Try another system or check after the next hourly scan.');
  content.innerHTML = `
  <section class="panel earn-sum" aria-label="Summary">
    ${readout([['Fit your budget', `${affordable.length}`, `of ${plural(ranked.length, 'blueprint')}`], ['Best profit', top ? `+${short(top.profitDay)}` : '—', top ? 'ISK/day' : ''], ['Build in', esc(factory?.system.name || here?.name || '—'), pct(buildIndex) + ' index']])}
    <p class="earn-sum__line">${known ? `${alpha ? 'Alpha' : 'Omega'} clone with ${plural(s.build, 'build slot')} and ${plural(s.science, 'research slot')}.` : `Connect ${esc(p?.name || 'your pilot')} to plan with real skills, slots and wallet.`} Jobs cost ${pct(jobTax)} in tax, selling ${pct(f.salesTax + f.brokerFee)} in fees.</p>
    ${cheaper ? `<p class="alert warn">Building in ${esc(factory.system.name)} (${factory.jumps} jumps) is cheaper: ${pct(factory.index)} index instead of ${pct(idx.manufacturing || 0)} here.</p>` : ''}
    <div class="earn-sum__acts"><button type="button" class="secondary small" data-earn-drawer="guide">Build guide</button></div>
  </section>
  <section class="panel wplan" aria-labelledby="wplan-title">
    <div class="panel__head"><h2 id="wplan-title">Wing build plan</h2></div>
    <p class="wplan__line">${wingLine}</p>
    <div class="wplan__pilots">${crew.map(pilotCol).join('')}</div>
  </section>
  <section class="panel panel--primary panel--flush earn-main" aria-labelledby="bp-title">
    <div class="earn-main__head"><h2 id="bp-title">Blueprints to start with</h2><p class="panel__sub">Best first. Select one for its trip plan and material bill.${overBudget && !showAll ? ` ${overBudget} more ${overBudget === 1 ? 'pick needs' : 'picks need'} a bigger budget.` : ''}</p></div>
    ${list.length ? table('industry', 'Blueprints to start with', 'minmax(0,2.2fr) 62px 70px 70px 80px 96px', [['Blueprint'], ['Seller', 'near'], ['Margin', 'margin'], ['Payback', 'payback'], ['Start', 'invest'], ['Profit/day', 'profit']], rows) : `<div class="earn-main__empty">${empty}</div>`}
  </section>
  <details class="panel earn-more">
    <summary><b>Facilities near ${esc(here?.name || 'you')}</b><small>${factory ? `Build at ${esc(factory.station.name)}${lab ? `, research at ${esc(lab.station.name)}` : ''}` : 'Where to build and research'}</small></summary>
    <p class="hint">NPC stations in high-sec (0.5+), reachable without entering low-sec, within 10 jumps. A lower system index means cheaper jobs; NPC stations add a fixed ${pct(NPC_FACILITY_TAX)} facility tax.</p>
    ${g ? `<div class="grid"><div><h4>Manufacturing</h4>${facilityList(factories, 'build')}</div><div><h4>Research (ME)</h4>${facilityList(labs, 'ME')}</div></div>` : '<p class="hint">The station map appears after the next market pipeline run.</p>'}
  </details>`;
  applyFilter('industry');
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
  if (!t) return failed('mining');
  const {status, content} = t, {marketData, marketBook} = S;
  const meta = marketData.meta?.data || {}, g = mapGraph();
  if (!meta.ores?.length || !g) { status.textContent = 'The pipeline has not priced ore yet. Check back after its next hourly run.'; content.innerHTML = state('No ore prices yet.', 'The hourly pipeline prices ore on its next run. Press Refresh after that.'); return; }
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
  const shipLine = pl => `${esc(SHIPS[pl.ship].name)}${pl.m.ship === pl.ship ? ' (current ship)' : canFly(pl.ship, pl.m.level) ? '' : ' <span class="neg">(not trained yet)</span>'} · ${Math.round(pl.rate * 60).toLocaleString()} m³/min · ${Math.round(pl.hold).toLocaleString()} m³ hold`;
  const ledgerHtml = m => {
    if (!m?.ledger) return '<p class="hint">Not shared yet.</p>';
    if (m.ledger.permission === false) return '<p class="hint">Permission not granted. Press Reconnect to allow the mining ledger.</p>';
    const r = ledger(m.ledger.value || [], meta.ores, valuesFor(m), sysName);
    return r.units ? `${facts([['Mined', `${Math.round(r.m3).toLocaleString()} m³ · ${plural(r.days, 'day')} in the last 30`], ['Worth today', format(r.isk, 'isk')], ['Per mining day', format(r.isk / r.days, 'isk')]])}
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
  const list = sorted('mining', mine1.list, {jumps:(a, b) => a.jumps - b.jumps, kills:(a, b) => a.kills - b.kills, traffic:(a, b) => a.traffic - b.traffic});
  const routeOf = s => route(from, s.system.id, !lowsec);
  picks.mining = i => {
    const s = list[i], r = s.jumps ? routeOf(s) : null, ids = r?.systems.map(x => x.id) || [];
    return {title:s.system.name, foot:`${mapButton(ids, `${sysName(from)} → ${s.system.name}`)}${autopilotButton(ids.length > 1 ? sendable(ids, [from, s.system.id]) : [], 'mining-sent')}`, body:ed(`
      ${readout([['ISK/h', short(s.iskHour)], ['Jumps', s.jumps || 'here'], ['Hold fills', duration(mine1.hold / mine1.rate)]])}
      <p class="ed-lead">Mine ${esc(s.ores[0].n)}: ${format(s.ores[0].perM3, 'isk')}/m³, best sold ${esc(s.ores[0].how)}${s.ores[0].at ? ` at ${esc(marketBook.stations.get(s.ores[0].at)?.name || 'a hub')}` : ' as minerals'}.</p>
      ${facts([['Security', `${chip(s.system)} ${secClass(s.system.sec) !== 'hi' ? '<span class="neg">low-sec: no CONCORD</span>' : 'high-sec'}`], ['Belts', plural(s.system.belts, 'belt')],
        ['Last hour', `<span class="${s.kills ? 'neg' : ''}">${s.kills ? `${plural(s.kills, 'ship')} killed in the last hour` : 'No kills in the last hour'}</span>`], ['Traffic', `${s.traffic.toLocaleString()} jumps/h${s.crowd < 1 ? ' · busy, belts may be stripped' : ''}`],
        s.lowsec && ['Route', '<span class="neg">route through low-sec</span>']])}
      <h3 class="ed-h">Ore here</h3><table class="bill"><thead><tr><th>Ore</th><th>ISK/m³</th><th>Best as</th></tr></thead><tbody>${s.ores.map(o => `<tr><td>${esc(o.n)}</td><td>${format(o.perM3, 'isk')}</td><td>${esc(o.how)}</td></tr>`).join('')}</tbody></table>
      ${r ? `<h3 class="ed-h">Route</h3>${legHtml('Fly to', s.system.name, r)}` : ''}`)};
  };
  extras.mining = {
    ships:() => ({title:'Compare ships', body:ed(`<p class="hint">Two Miner I/II on the Venture, two Strip Miner I on barges, with ${esc(me.p.name)}’s skills; ISK/h at ${best ? esc(best.system.name) : 'the best site'}. Hull bonuses are estimates; your ledger shows the real rate.</p>
      <table class="bill"><thead><tr><th>Ship</th><th>Can fly</th><th>m³/min</th><th>Hold m³</th><th>ISK/h</th></tr></thead><tbody>${shipRows}</tbody></table>${next.length ? `<h3 class="ed-h">Train next</h3>${trainNext(next)}` : ''}`), foot:next.length ? '<button type="button" class="secondary small" data-go="training">Open training</button>' : ''}),
    ores:() => ({title:'What ore is worth', body:ed(`<p class="hint">ISK per unit after sales tax, sold into the best hub buy order. Reprocessed uses ${esc(me.p.name)}’s reprocessing skills at an NPC station. II–IV-Grade ore pays 5–15% more.</p>
      <table class="bill"><thead><tr><th>Ore</th><th>ISK/m³</th><th>Best as</th><th>Raw</th><th>Compressed</th><th>Minerals</th></tr></thead><tbody>${oreRows}</tbody></table>`)}),
    ledger:() => ({title:'Last 30 days', body:ed(`<h3 class="ed-h who" data-pilot="${esc(me.p.name.toLowerCase())}">${esc(me.p.name)}</h3>${ledgerHtml(me)}${mate ? `<h3 class="ed-h who" data-pilot="${esc(mate.p.name.toLowerCase())}">${esc(mate.p.name)}</h3>${ledgerHtml(mate)}` : ''}`), foot:'<button type="button" class="secondary small" data-go="ledger">See mining income</button>'}),
    mate:() => ({title:`${mate.p.name}’s best spots`, body:ed(`<p class="hint">${shipLine(mate1)} · from ${esc(sysName(mate1.start))}${mate.location ? '' : ' (their location isn’t shared, so this uses yours)'}.</p>
      ${mate1.list.length ? `<ul class="plain">${mate1.list.map(s => `<li><b>${chip(s.system)} ${esc(s.system.name)}</b><small>${s.jumps ? plural(s.jumps, 'jump') : 'here'} · ${esc(s.ores[0].n)} · ${format(s.iskHour, 'isk')}/h${s.kills ? ` · <span class="neg">${s.kills} killed last hour</span>` : ''}</small></li>`).join('')}</ul>` : '<p class="hint">No belts in range.</p>'}`)})
  };
  const mateTop = mate1?.list[0];
  const together = !mate ? '' : !mateTop ? `${esc(mate.p.name)} has no belts in range right now.`
    : best && mateTop.system.id === best.system.id ? `You and <b class="who" data-pilot="${esc(mate.p.name.toLowerCase())}">${esc(mate.p.name)}</b> both do best at ${esc(best.system.name)}. Mine together and share one hauler trip.`
    : `<b class="who" data-pilot="${esc(mate.p.name.toLowerCase())}">${esc(mate.p.name)}</b> does best at ${esc(mateTop.system.name)}${route(from, mateTop.system.id)?.jumps !== undefined ? ` (${route(from, mateTop.system.id).jumps ? plural(route(from, mateTop.system.id).jumps, 'jump') : 'right here'} from you)` : ''}.`;
  const rows = list.map((s, i) => row(i, `${s.system.name} ${s.ores.map(o => o.n).join(' ')}`, [
    cell(`${chip(s.system)}<b><a href="${dotlanSystem(s.system.name)}" data-system="${s.system.id}">${esc(s.system.name)}</a></b>${s.lowsec ? '<span class="tag neg">low-sec route</span>' : ''}${secClass(s.system.sec) !== 'hi' ? '<span class="tag neg">low-sec</span>' : ''}<small class="rows__meta">${s.jumps ? plural(s.jumps, 'jump') : 'you are here'} · ${esc(s.ores[0].n)} · ${s.kills ? `${s.kills} killed last hour` : 'no kills'}</small>`, 'rows__main'),
    cell(s.jumps ? s.jumps : 'here'), cell(esc(s.ores[0].n), 'rows__txt'), cell(s.kills ? `<span class="neg">${s.kills}</span>` : '0'), cell(`${s.traffic.toLocaleString()}${s.crowd < 1 ? ' <span class="tag flag">busy</span>' : ''}`),
    cell(short(s.iskHour), 'num num--pos rows__key')], {attrs:s.jumps ? routeAttrs((routeOf(s)?.systems || []).map(x => x.id), `${sysName(from)} → ${s.system.name}`) : ''}));
  content.innerHTML = `
  <section class="panel earn-sum" aria-label="Summary">
    ${readout([['Ship', esc(SHIPS[mine1.ship].name), `${Math.round(mine1.rate * 60).toLocaleString()} m³/min`], ['Best', best ? short(best.iskHour) : '—', best ? `ISK/h at ${esc(best.system.name)}` : ''], ['Belts in reach', mine1.list.length, `within ${maxJumps} jumps`]])}
    <p class="earn-sum__line">${shipLine(mine1)}. ${me.known ? '' : `Connect ${esc(me.p.name)} to use real skills, ship and location. `}Ranked by ISK per hour at the belt, lowered by recent kills, heavy traffic and travel over a 2-hour session.</p>
    ${together ? `<p class="earn-together">${together}</p>` : ''}
    <div class="earn-sum__acts"><button type="button" class="secondary small" data-earn-drawer="ships">Compare ships</button><button type="button" class="secondary small" data-earn-drawer="ores">Ore values</button><button type="button" class="secondary small" data-earn-drawer="ledger">Mining ledger</button>${mate1 ? `<button type="button" class="secondary small" data-earn-drawer="mate">${esc(mate.p.name)}’s spots</button>` : ''}</div>
  </section>
  <section class="panel panel--primary panel--flush earn-main" aria-labelledby="belts-title">
    <div class="earn-main__head"><h2 id="belts-title">Belts for ${esc(me.p.name)}</h2><p class="panel__sub">Best first. Select a belt for its ores, risk and route.</p></div>
    ${list.length ? table('mining', 'Belts', 'minmax(0,1.8fr) 56px minmax(0,1fr) 56px 90px 90px', [['System'], ['Jumps', 'jumps'], ['Best ore'], ['Kills', 'kills'], ['Jumps/h', 'traffic'], ['ISK/h']], rows)
      : `<div class="earn-main__empty">${state(`No ${lowsec ? '' : 'high-sec '}belts with known ore within ${maxJumps} jumps.`, 'Widen the range or include low-sec.', maxJumps < 10 ? stateButton('Search 10 jumps', 'mining-jumps=10') : '')}</div>`}
  </section>`;
  applyFilter('mining');
}

// ── Explore: the quietest systems within reach, a scanning loop through them, and how to get better at it. ──
const EXPLORED_KEY = 'eve-explored:v1';
let scoutData = null, scout = {state:'loading', list:[]};
function explored() { try { return JSON.parse(localStorage.getItem(EXPLORED_KEY)) || {}; } catch { return {}; } }
function markExplored(id) { const m = explored(); m[id] = Date.now(); try { localStorage.setItem(EXPLORED_KEY, JSON.stringify(m)); } catch { /* Not remembered in this browser. */ } }
async function eveScout() {
  if (scoutData && Date.now() - scoutData.at < 300000) return scoutData.list;
  const list = await json('https://api.eve-scout.com/v2/public/signatures', {headers:{Accept:'application/json'}});
  scoutData = {at:Date.now(), list:Array.isArray(list) ? list : []};
  return scoutData.list;
}
const riskWord = survival => survival >= 0.99 ? ['Quiet', 'chip--ok'] : survival >= 0.95 ? ['Some traffic', 'chip--warn'] : ['Hot', 'chip--danger'];
export async function renderExploration() {
  const t = await tabReady('explore', 'Reading traffic across New Eden…', 'Exploration');
  if (!t) return failed('exploration');
  const {status, content, stale} = t, g = mapGraph(), meta = S.marketData.meta?.data || {};
  if (!g?.systems.size) { status.textContent = 'The map appears after the next pipeline run.'; content.innerHTML = state('No map yet.', 'The gate map arrives with the next hourly pipeline run. Press Refresh after that.'); return; }
  systemOptions($('#explore-system'));
  const from = Number($('#explore-system').value), maxJumps = Number($('#explore-jumps').value), tolerance = $('#explore-tolerance').value, loopSize = Number($('#explore-loop').value);
  const bands = new Set([...document.querySelectorAll('[data-band]')].filter(b => b.checked).map(b => b.dataset.band));
  if (!bands.size) { status.textContent = 'Pick at least one security band.'; content.innerHTML = state('Pick at least one security band.', 'High-sec is the safe place to start.', stateButton('Use high-sec', 'band-hi=on')); return; }
  // The same route mode rankSystems used, so previews match the jump counts.
  const safe = !bands.has('low') && !bands.has('null');
  const p = mine(), o = wingmate(), x = summary(p), skillLevel = id => levelOf(x.skills, id);
  const level = key => key === 'frigate' ? Math.max(...['amarrFrigate', 'caldariFrigate', 'gallenteFrigate', 'minmatarFrigate'].map(k => level(k))) : skillLevel(meta.skills?.[key]);
  const trail = pl => (pl?.private ? pl.ops?.trail?.value : S.wing.get(pl?.id)?.trail) || [];
  const visited = visitedMap(trail(p), trail(o), Object.entries(explored()).map(([id, at]) => [Number(id), at]));
  const traffic = meta.traffic?.s || {}, kills = Object.fromEntries(Object.entries(meta.risk?.s || {}).map(([id, v]) => [id, v[0]]));
  const hour = {jumps:Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[2]])), kills:Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[0]]))};
  const ranked = rankSystems(g, from, {traffic, kills, hour, bands, maxJumps, visited, tolerance, limit:20});
  const start = g.systems.get(from), hours = meta.traffic?.since ? (Date.now() - meta.traffic.since) / 3600000 : 0;
  status.textContent = `${ranked.length} systems ranked within ${maxJumps} jumps of ${start?.name || 'you'} · traffic from ${hours >= 24 ? 'the last day' : hours >= 1 ? `${Math.round(hours)} hours of history` : 'the last hour (history is still building)'} · ${visited.size} recently visited ${visited.size === 1 ? 'system' : 'systems'} pushed down`;
  // A loop through the best picks, back to the start, in the safest order.
  const loopPicks = ranked.filter(r => r.system.id !== from).slice(0, loopSize).map(r => r.system.id);
  const loop = loopPicks.length ? routePlan(g, [from, ...loopPicks], {history:meta.risk?.s || {}, traffic:hour.jumps, value:0, hull:'t1'}, {mode:'safest', optimize:true, end:'return', lowsec:!safe}) : null;
  const okLoop = loop && !loop.unreachable;
  const maxDay = Math.max(1, ...ranked.map(r => r.traffic)), bestScore = Math.max(1e-9, ...ranked.map(r => r.score));
  const score = r => Math.max(1, Math.round(100 * r.score / bestScore));
  const ago = at => { const h = (Date.now() - at) / 3600000; return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
  const list = sorted('exploration', ranked, {jumps:(a, b) => a.jumps - b.jumps, traffic:(a, b) => a.traffic - b.traffic, kills:(a, b) => a.kills - b.kills});
  const routeTo = r => route(from, r.system.id, safe);
  const markBtn = r => `<button type="button" class="secondary small" data-explore-mark="${r.system.id}">${r.visited ? 'Scanned again' : 'Mark scanned'}</button>`;
  const explorer = explorerFor(level), next = exploreSkills(level), known = Boolean(x.skills?.skills);
  const label = k => ({frigate:`${explorer.race} Frigate`, astrometrics:'Astrometrics', hacking:'Hacking', archaeology:'Archaeology', cpuManagement:'CPU Management', rangefinding:'Astrometric Rangefinding', survey:'Survey', pinpointing:'Astrometric Pinpointing', acquisition:'Astrometric Acquisition', cloaking:'Cloaking', covertOps:'Covert Ops'})[k];
  const minutes = okLoop ? Math.round(loop.jumps * 1 + (loop.stops.length - 2) * 12) : 0, [word, wordCls] = okLoop ? riskWord(loop.survival) : ['—', ''];
  const loopActions = okLoop ? `${mapButton(loop.route, 'Exploration loop')}<a class="button secondary small" href="${dotlanRoute(loop.stops.map(id => g.systems.get(id).name))}" target="_blank" rel="noopener noreferrer">Dotlan ↗</a>${autopilotButton(sendable(loop.route, loop.stops), 'explore-sent')}` : '';

  picks.exploration = i => {
    const r = list[i], rt = r.jumps ? routeTo(r) : null, ids = rt?.systems.map(s => s.id) || [];
    return {title:r.system.name, foot:`${mapButton(ids, `${start?.name} → ${r.system.name}`)}${markBtn(r)}`, body:ed(`
      ${readout([['Score', score(r)], ['Jumps', r.jumps || 'here'], ['Jumps a day', Math.round(r.traffic).toLocaleString()]])}
      ${facts([['Region', esc(regionName(r.system.region))], ['Rats', esc(r.pirates)], ['Ship kills', r.kills ? `<span class="${r.kills >= 3 ? 'neg' : 'warn-text'}">${plural(Math.round(r.kills), 'ship kill')}</span> over ~24 h` : 'none over ~24 h'],
        ['Quiet', `${Math.round(r.quiet * 100)}%`], ['Safe', `${Math.round(r.safe * 100)}%`], r.deadEnd && ['Dead end', 'Yes: one gate in and out'], r.visited && ['Visited', ago(r.visited)]])}
      <p class="hint">EVE doesn’t publish signature counts, so quiet means least travelled: fewer ships through a system means fewer explorers clearing its sites.</p>
      ${rt ? `<h3 class="ed-h">Route</h3>${legHtml('Fly to', r.system.name, rt)}` : ''}`)};
  };
  const scoutBody = () => scout.state === 'loading' ? '<div class="shimmer">Asking EVE-Scout…</div>' : scout.state === 'error' ? `<div class="state state--error" role="alert"><p><b>EVE-Scout unavailable.</b> ${esc(scout.error)}</p></div>`
    : scout.list.length ? `<ol class="plain">${scout.list.map(c => `<li ${routeAttrs((route(from, c.system.id, false)?.systems || []).map(s => s.id), `${start.name} → ${c.system.name}`)}><button type="button" class="link-btn" data-system="${c.system.id}">${secLight(c.system.sec)} ${esc(c.system.name)}</button> → <b>${esc(c.hub)}</b><small>${plural(c.jumps, 'jump')}${c.lowsec ? ' · <span class="neg">through low-sec</span>' : ''} · ${esc(c.size || '?')} ships · ${esc(c.hours ?? '?')} h left${c.signature ? ` · signature ${esc(c.signature)}` : ''}</small></li>`).join('')}</ol>`
    : '<p class="hint">No Thera or Turnur connection within 15 jumps right now.</p>';
  extras.exploration = {
    loop:() => ({title:'Tonight’s loop', foot:loopActions.replace('explore-sent', 'explore-sent-drawer'), body:ed(okLoop ? `${readout([['Jumps', loop.jumps], ['Time', `~${minutes}`, 'min'], ['Arrive safely', `${Math.round(loop.survival * 1000) / 10}%`]])}
      <p class="hint">The ${loop.stops.length - 2} best systems, in the order with the fewest jumps, back to ${esc(start.name)}. About 1 min a jump and ~12 min scanning a system.</p>
      <ol class="plain loop" ${routeAttrs(loop.route, 'Exploration loop')}>${loop.stops.slice(1, -1).map(id => { const s = g.systems.get(id); return `<li><button type="button" class="link-btn" data-system="${id}">${secLight(s.sec)} ${esc(s.name)}</button><small>${esc(regionName(s.region))}</small></li>`; }).join('')}</ol>` : '<p class="hint">Nothing to loop through with these settings.</p>')}),
    explorer:() => ({title:'Your explorer', foot:next.length ? '<button type="button" class="secondary small" data-go="training">Open training</button>' : '', body:ed(`
      <p class="ed-lead"><b>${esc(explorer.ship)}</b> <span class="hint">${known ? explorer.level ? `${esc(explorer.race)} Frigate ${ROMAN[explorer.level]}` : `train ${esc(explorer.race)} Frigate I to fly it` : 'connect to match your skills'}</span></p>
      <ul class="plain"><li>Core Probe Launcher, Relic Analyzer and Data Analyzer<small>The three modules every relic and data site needs; add a Scan Rangefinding Array if CPU allows.</small></li><li>Read the can before hacking<small>Relic sites drop blueprints and salvage; data sites drop datacores, decryptors and skill books. Leave the last can if a site keeps failing.</small></li><li>Watch local<small>In high-sec, the risk is mostly a gank at gates or someone cargo-scanning your loot. Dock up the haul now and then.</small></li></ul>
      ${next.length ? `<h3 class="ed-h">Train next</h3>${trainNext(next.map(k => ({...k, name:label(k.key)})))}` : ''}`)}),
    scout:() => ({title:'Wormhole shortcuts', body:ed(`<p class="hint">Live Thera and Turnur connections from EVE-Scout, for later. Wormhole space and null-sec hold the richest relic and data sites once you fly a covert-ops ship.</p><div id="explore-scout">${scoutBody()}</div>`)})
  };
  const rows = list.map((r, i) => row(i, `${r.system.name} ${regionName(r.system.region)} ${r.pirates}`, [
    cell(`<button type="button" class="light-btn" data-system="${r.system.id}" aria-label="${esc(r.system.name)} on the map">${secLight(r.system.sec)}</button><b><a href="${dotlanSystem(r.system.name)}" data-system="${r.system.id}">${esc(r.system.name)}</a></b>${r.deadEnd ? '<span class="tag">Dead end</span>' : ''}${r.visited ? `<span class="tag flag">Visited ${ago(r.visited)}</span>` : ''}<small class="rows__meta">${esc(regionName(r.system.region))} · ${r.jumps ? plural(r.jumps, 'jump') : 'here'} · ${Math.round(r.traffic).toLocaleString()} jumps a day</small>`, 'rows__main'),
    cell(r.jumps ? r.jumps : 'here'), cell(`<span class="meter" title="Jumps over about a day"><i style="width:${Math.max(2, 100 * r.traffic / maxDay).toFixed(0)}%"></i></span>${Math.round(r.traffic).toLocaleString()}`, 'num rows__traffic'),
    cell(r.kills ? `<span class="${r.kills >= 3 ? 'neg' : 'warn-text'}">${Math.round(r.kills)}</span>` : '0'), cell(score(r), `num rows__key${r.score >= bestScore * 0.5 ? ' num--pos' : ''}`), cell(markBtn(r), 'rows__act')],
    {attrs:r.jumps ? routeAttrs((routeTo(r)?.systems || []).map(s => s.id), `${start?.name} → ${r.system.name}`) : ''}));
  content.innerHTML = `
  <section class="panel earn-sum" aria-label="Summary">
    ${readout([['Loop', okLoop ? loop.stops.length - 2 : '—', okLoop ? 'systems' : ''], ['Jumps', okLoop ? loop.jumps : '—'], ['Time', okLoop ? `~${minutes}` : '—', okLoop ? 'min' : '']])}
    ${okLoop ? `<p class="earn-sum__line"><span class="chip ${wordCls}">${word}</span> Arrive safely ${Math.round(loop.survival * 1000) / 10}%. The best systems in the order with the fewest jumps, back to ${esc(start.name)}.</p>
    <ol class="loop-strip" aria-label="Loop stops" ${routeAttrs(loop.route, 'Exploration loop')}>${loop.stops.slice(1, -1).map(id => { const s = g.systems.get(id); return `<li><button type="button" class="link-btn" data-system="${id}">${secLight(s.sec)} ${esc(s.name)}</button></li>`; }).join('')}</ol>
    <div class="earn-sum__acts">${loopActions}</div>` : '<p class="earn-sum__line">Nothing to loop through with these settings. Widen the range or add a security band.</p>'}
    <div class="earn-sum__acts earn-sum__acts--quiet"><button type="button" class="secondary small" data-earn-drawer="loop">Loop plan</button><button type="button" class="secondary small" data-earn-drawer="explorer">Explorer fit and skills</button><button type="button" class="secondary small" id="explore-scout-btn" data-earn-drawer="scout">Wormhole shortcuts</button></div>
  </section>
  <section class="panel panel--primary panel--flush earn-main" aria-labelledby="scan-title">
    <div class="earn-main__head"><h2 id="scan-title">Where to scan · ${esc(p?.name || 'you')}</h2><p class="panel__sub">Ranked by quiet, safety (weighted by your risk setting), distance and dead ends. Systems you or ${esc(o?.name || 'your wingmate')} visited lately sink.</p></div>
    ${list.length ? table('exploration', 'Systems to scan', 'minmax(0,2fr) 52px 130px 52px 56px 112px', [['System'], ['Jumps', 'jumps'], ['Jumps a day', 'traffic'], ['Kills', 'kills'], ['Score'], ['<span class="sr-only">Actions</span>']], rows)
      : `<div class="earn-main__empty">${state(`No ${[...bands].map(b => BANDS[b]).join(' or ').toLowerCase()} systems within ${maxJumps} jumps.`, 'Widen the range or add a security band.', maxJumps < 20 ? stateButton('Search 20 jumps', 'explore-jumps=20') : '')}</div>`}
  </section>`;
  applyFilter('exploration');
  scout = {state:'loading', list:[]};
  const drawScout = () => {
    const btn = document.getElementById('explore-scout-btn');
    if (btn) btn.textContent = scout.state === 'ok' ? `Wormhole shortcuts (${scout.list.length})` : 'Wormhole shortcuts';
    const open = $('#drawer #explore-scout');
    if (open) open.innerHTML = scoutBody();
  };
  eveScout().then(sigs => { if (stale()) return; scout = {state:'ok', list:shortcuts(g, from, sigs, {maxJumps:15})}; drawScout(); },
    error => { if (stale()) return; scout = {state:'error', error:error.message, list:[]}; drawScout(); });
}

// ── Wiring: toolbar changes re-render, headers sort, rows open the drawer. ──
const RENDERS = {industry:renderIndustry, mining:renderMining, exploration:renderExploration, market:renderMarket};
function openRow(view, el) {
  const spec = picks[view]?.(Number(el.dataset.pick));
  if (!spec) return;
  document.querySelectorAll('.earn [data-row][aria-selected]').forEach(r => r.removeAttribute('aria-selected'));
  el.setAttribute('aria-selected', 'true');
  openDrawer(spec);
}
export function wire() {
  $('#market-origin').onchange = $('#market-jumps').onchange = () => renderMarket();
  $('#market-budget').onchange = $('#market-cargo').onchange = event => { event.target.dataset.touched = '1'; renderMarket(); };
  $('#industry-system').onchange = $('#industry-over').onchange = $('#industry-category').onchange = () => renderIndustry();
  $('#industry-budget').onchange = event => { event.target.dataset.touched = '1'; renderIndustry(); };
  $('#mining-system').onchange = $('#mining-ship').onchange = $('#mining-jumps').onchange = $('#mining-lowsec').onchange = () => renderMining();
  ['explore-system', 'explore-jumps', 'explore-tolerance', 'explore-loop'].forEach(id => { $(`#${id}`).onchange = () => renderExploration(); });
  document.querySelectorAll('[data-band]').forEach(b => b.onchange = () => renderExploration());
  for (const [view, prefix] of Object.entries(PREFIX)) {
    const sel = $(`#${prefix}-sort`), key = () => view === 'market' ? `eve.sort.market.${tradeList}` : `eve.sort.${view}`;
    if (view !== 'market' && [...sel.options].some(o => o.value === store.get(key()))) sel.value = store.get(key());
    sel.onchange = () => { store.set(key(), sel.value); RENDERS[view](); };
    $(`#${prefix}-filter`).addEventListener('input', () => applyFilter(view));
    const section = $(`#${view}`);
    section.addEventListener('click', event => {
      const t = event.target;
      const sort = t.closest('.sort');
      if (sort) { sel.value = sel.value === sort.dataset.sort ? '' : sort.dataset.sort; sel.dispatchEvent(new Event('change')); return; }
      const set = t.closest('[data-set]');
      if (set) { const [id, v] = set.dataset.set.split('='), el = $(`#${id}`); if (el.type === 'checkbox') el.checked = true; else el.value = v; el.dispatchEvent(new Event('change')); return; }
      if (t.closest('[data-retry]')) { RENDERS[view](); return; }
      const trade = t.closest('[data-trade]');
      if (trade) { tradeList = trade.dataset.trade; store.set('eve.trade.list', tradeList); renderMarket(); return; }
      const extra = t.closest('[data-earn-drawer]');
      if (extra) { openDrawer(extras[view][extra.dataset.earnDrawer]()); return; }
      const r = t.closest('[data-row]');
      if (r && !t.closest('a,button,input,select,label,summary')) openRow(view, r);
    });
    section.addEventListener('keydown', event => {
      const r = event.target.closest?.('[data-row]');
      if (r && event.target === r && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openRow(view, r); }
    });
  }
  // "Mark scanned" works from the row and from the drawer.
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-explore-mark]');
    if (!b) return;
    const id = Number(b.dataset.exploreMark);
    markExplored(id);
    if (b.closest('#drawer')) $('#drawer').close();
    toast(`Marked ${mapGraph()?.systems.get(id)?.name || 'the system'} as scanned. It sinks in the list for a while.`, 'ok');
    renderExploration();
  });
  $('#drawer').addEventListener('close', () => document.querySelectorAll('.earn [data-row][aria-selected]').forEach(r => r.removeAttribute('aria-selected')));
}
