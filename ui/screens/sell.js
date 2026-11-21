// Earn → Sell: where to sell what the pilots carry (ship holds and the item hangar they pick up from) and each ship's route.
// The planner is sell.js (run in the haul Worker by ui/haulplan.js); live buy orders come from ui/sellquotes.js.
import {fees} from '../../market.js';
import {SELL_DEFAULTS} from '../../sell.js';
import {S, HUB_SYSTEMS, ordered, mine, opsOf, viaWing, summary, names} from '../state.js';
import {esi, name, resolveNames} from '../esi.js';
import {$, esc, format, plural, tabReady, skeleton, iskEcho, wingNote, parseIsk} from '../shared.js';
import {mapGraph, fillSystemList, fillStationList, sendable} from '../routes.js';
import {snapshotOf, planSellInWorker} from '../haulplan.js';
import {quotes as quoteBook, candidateRegions, typeInfo} from '../sellquotes.js';
import {parsePaste, cargoOf, hangarOf} from '../sellitems.js';
import {addLayer} from '../mapstate.js';
import {showOnMap} from '../mapmodal.js';

const OPTIONS = 'eve-sell:v1';
// What a person changed since the data was drawn: ships left out, rows left out or cut down, hold sizes, pasted items.
const st = {off:new Set(), skip:new Set(), qty:new Map(), caps:new Map(), pasted:new Map(), editing:false, note:'', run:0, mode:null, picked:false, result:null, data:null, sig:'', folded:false, restored:false, info:new Map()};
const store = {get:() => { try { return JSON.parse(localStorage.getItem(OPTIONS)) || {}; } catch { return {}; } }, set:value => { try { localStorage.setItem(OPTIONS, JSON.stringify(value)); } catch { /* Per-browser convenience only. */ } }};

// ── Places ──
let catalog = null;
function stations(g) {
  const book = S.marketBook;
  if (catalog?.g !== g || catalog.book !== book) {
    const byId = new Map([...g.stations.values()].map(s => [s.id, s.name]));
    for (const [id, s] of book?.stations || []) if (!byId.has(id)) byId.set(id, s.name);
    const list = [...byId].map(([id, n]) => ({id, name:n})), byName = new Map(list.map(s => [s.name.toLowerCase(), s.id]));
    catalog = {g, book, byId, list, byName};
  }
  return catalog;
}
const systemOf = (g, loc) => g.stations.get(loc)?.system ?? S.marketBook?.stations.get(loc)?.system;
const sysName = (g, id) => g.systems.get(id)?.name || `System ${id}`;
const placeName = (g, loc, sys) => stations(g).byId.get(loc) || `Structure in ${sysName(g, sys ?? systemOf(g, loc))}`;

// ── What there is to sell ──
// Ships from every pilot whose ship is known (the wingmate's only at consent level 3, when their hangar is shared too).
function gather(g) {
  const ships = [], rows = new Map(), notes = [];
  for (const p of ordered()) {
    const ops = opsOf(p), ship = ops.ship?.value, loc = ops.location?.value, level3 = p.private || (viaWing(p) && S.wing.get(p.id).shareLevel >= 3);
    if (!level3 || !ship?.ship_type_id) { notes.push({p, text:p.private ? `${p.name}’s ship is not synced yet.` : `${p.name} has not shared a ship with the wing.`}); continue; }
    const station = loc?.station_id || loc?.structure_id || null;
    if (!station && !loc?.solar_system_id) { notes.push({p, text:`${p.name}’s location is not known yet, so their ship is left out.`}); continue; }
    ships.push({p, pilot:p.id, name:ship.ship_name || 'Ship', shipType:ship.ship_type_id, system:loc?.solar_system_id ?? (station ? systemOf(g, station) : undefined), station, connected:Boolean(p.private && S.backend?.has(p.id))});
    for (const [type, qty] of cargoOf(ops.fit?.value, ship.ship_item_id)) rows.set(`s:${p.id}:${type}`, {key:`s:${p.id}:${type}`, type, avail:qty, from:{kind:'ship', pilot:p.id}});
    for (const h of hangarOf(ops.stacks?.value, [station, p.private ? p.sellStation : null].filter(Boolean))) {
      const key = `h:${h.station}:${h.type}`, row = rows.get(key);
      if (row) row.avail += h.qty; else rows.set(key, {key, type:h.type, avail:h.qty, from:{kind:'hangar', station:h.station}});
    }
  }
  const me = mine(), mineShip = ships.find(s => s.p === me), pickup = (me?.private && me.sellStation) || mineShip?.station || null;
  // A pasted list lands in the pickup hangar, or in the hold when there is no station to take it from.
  const source = pickup ? {kind:'hangar', station:pickup, tag:`h:${pickup}`} : ships[0] ? {kind:'ship', pilot:ships[0].pilot, tag:`s:${ships[0].pilot}`} : null;
  if (source) for (const [type, qty] of st.pasted) rows.set(`${source.tag}:${type}`, {key:`${source.tag}:${type}`, type, avail:qty, pasted:true, from:source.kind === 'hangar' ? {kind:'hangar', station:source.station} : {kind:'ship', pilot:source.pilot}});
  return {ships, rows:[...rows.values()], notes, pickup, me};
}
const qtyOf = row => Math.max(0, Math.min(row.avail, st.qty.has(row.key) ? st.qty.get(row.key) : row.avail));
const fromLabel = (g, row) => row.from.kind === 'ship' ? `${st.data.ships.find(s => s.pilot === row.from.pilot)?.name || 'Ship'}’s hold` : `Hangar at ${placeName(g, row.from.station)}`;
const m3Of = type => st.info.get(type)?.volume;
const num = n => Math.round(n).toLocaleString();
const m3Text = n => n >= 10 ? num(n) : String(Math.round(n * 100) / 100);

// ── The form ──
function drawShips() {
  const {ships, notes} = st.data;
  $('#sell-ships').innerHTML = `${ships.length ? `<ul class="sell-list">${ships.map(s => {
    const info = st.info.get(s.shipType), cap = st.caps.get(s.pilot) ?? info?.capacity ?? 0, on = !st.off.has(s.pilot), where = s.station ? `Docked at ${esc(placeName(mapGraph(), s.station, s.system))}` : `Not docked${s.system ? `, in ${esc(sysName(mapGraph(), s.system))}` : ''}. Dock to sell from a hangar.`;
    return `<li class="sell-ship" data-pilot="${esc(s.p.name.toLowerCase())}"><label class="sw"><input type="checkbox" data-ship-include="${s.pilot}" ${on ? 'checked' : ''} aria-label="Include ${esc(s.name)} (${esc(s.p.name)})"><span><b>${esc(s.name)}</b><small>${esc(name(s.shipType))} · ${esc(s.p.name)}</small></span></label>
      <label class="tf">Cargo m³<input type="number" min="0" step="1" inputmode="numeric" value="${Math.round(cap * 100) / 100}" data-ship-cap="${s.pilot}" aria-label="Cargo m³ for ${esc(s.name)}"></label>
      <small class="sell-ship__at ${s.station ? '' : 'neg'}">${where}</small></li>`;
  }).join('')}</ul>` : '<p class="hint">No ship to plan with yet.</p>'}${notes.map(n => `<p class="hint">${esc(n.text)}</p>${n.p.private ? '' : wingNote(n.p, 3)}`).join('')}`;
}
function drawPickup() {
  const {me, pickup} = st.data, g = mapGraph(), el = $('#sell-pickup');
  if (!me?.private) { el.innerHTML = `<p class="hint">${me ? `Connect ${esc(me.name)} to choose where to pick items up.` : 'Choose a pilot first.'}</p>`; return; }
  const custom = Boolean(me.sellStation), here = pickup ? placeName(g, pickup) : null;
  el.innerHTML = st.editing
    ? `<div class="sell-pick"><label class="tf">Station<input id="sell-pickup-input" list="stations" autocomplete="off" placeholder="Station name" aria-label="Pickup station" value="${esc(here || '')}"></label>
        <button type="button" data-sell-save>Save station</button><button type="button" class="secondary" data-sell-cancel>Cancel</button></div>`
    : `<div class="sell-pick"><p class="sell-pick__line">${here ? `Item hangar at <b>${esc(here)}</b>` : 'No station to pick up from. Dock, or choose one.'}${custom ? ' <span class="tag dim">Chosen by you</span>' : ''}</p>
        <button type="button" class="secondary" data-sell-change>Change</button>${custom ? '<button type="button" class="secondary" data-sell-docked>Use docked station</button>' : ''}</div>`;
  const known = pickup ? st.data.rows.filter(r => r.from.kind === 'hangar' && r.from.station === pickup).length : 0;
  el.insertAdjacentHTML('beforeend', `${st.note ? `<p class="hint" role="status">${esc(st.note)}${pickup ? ` ${known ? `Known now: ${plural(known, 'kind of item', 'kinds of items')} there.` : 'Nothing is known there yet.'}` : ''}</p>` : ''}<p class="hint">Both pilots’ hangars at a station are counted together.</p>`);
}
function drawItems() {
  const g = mapGraph(), rows = st.data.rows, prices = S.prices;
  const sorted = [...rows].sort((a, b) => (qtyOf(b) * (prices?.get(b.type) || 0)) - (qtyOf(a) * (prices?.get(a.type) || 0)) || name(a.type).localeCompare(name(b.type)));
  $('#sell-items').innerHTML = rows.length ? `<ul class="sell-lots" aria-label="Items to sell">${sorted.map(r => {
    const m3 = m3Of(r.type), on = !st.skip.has(r.key), label = name(r.type);
    return `<li class="sell-lot${on ? '' : ' is-off'}" data-lot="${esc(r.key)}"><label class="sw"><input type="checkbox" data-lot-include="${esc(r.key)}" ${on ? 'checked' : ''} aria-label="Sell ${esc(label)} from ${esc(fromLabel(g, r))}"><span><b>${esc(label)}</b><small>${esc(fromLabel(g, r))}${r.pasted ? ' · pasted' : ''}</small></span></label>
      <label class="tf">Quantity<input type="number" min="0" max="${r.avail}" step="1" inputmode="numeric" value="${qtyOf(r)}" data-lot-qty="${esc(r.key)}" aria-label="Quantity of ${esc(label)} from ${esc(fromLabel(g, r))}"></label>
      <span class="sell-lot__m3 num">${m3 === undefined ? '—' : `${m3Text(qtyOf(r) * m3)} m³`}</span></li>`;
  }).join('')}</ul>` : '<p class="hint">Nothing to sell yet. Load a hold, dock where a hangar holds items, choose a pickup station, or paste a list.</p>';
}
function drawForm() { drawShips(); drawPickup(); drawItems(); brief(); }
function brief() {
  const lots = st.data.rows.filter(r => !st.skip.has(r.key) && qtyOf(r) > 0).length, ships = st.data.ships.filter(s => !st.off.has(s.pilot)).length;
  $('#sell-brief').textContent = `${plural(ships, 'ship')} · ${plural(lots, 'item')} · ${format(Number($('#sell-perjump').value) || 0, 'isk')} a jump`;
}
const options = () => ({perJump:parseIsk($('#sell-perjump').value) ?? SELL_DEFAULTS.perJump, maxJumps:Math.max(0, Math.min(40, Math.round(Number($('#sell-jumps').value)) || 0)), lowsec:$('#sell-lowsec').checked, together:$('#sell-together').checked, returnHome:$('#sell-return').checked});
function restore() {
  if (st.restored) return;
  st.restored = true;
  const o = store.get();
  if (Number.isFinite(o.perJump)) $('#sell-perjump').value = String(o.perJump);
  if (Number.isFinite(o.maxJumps)) $('#sell-jumps').value = String(o.maxJumps);
  for (const [id, key] of [['lowsec', 'lowsec'], ['together', 'together'], ['return', 'returnHome']]) if (typeof o[key] === 'boolean') $(`#sell-${id}`).checked = o[key];
  iskEcho($('#sell-perjump'));
}

// ── Planning ──
const AGE = at => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? 'just now' : `${plural(m, 'minute')} ago`; };
export async function render() {
  const t = await tabReady('sell', 'Loading the market…', 'Sell');
  if (!t) return;
  const g = mapGraph();
  if (!g) { t.status.textContent = 'The gate map appears after the next pipeline run.'; t.content.innerHTML = ''; return; }
  restore(); fillSystemList(g);
  const cat = stations(g); fillStationList(cat.list, cat);
  const data = gather(g), sig = JSON.stringify([data.ships.map(s => [s.pilot, s.name, s.shipType, s.station, s.system, s.connected]), data.rows.map(r => [r.key, r.avail]), data.pickup, data.notes.map(n => n.text)]);
  // Drawn again only when what the pilots have changed, and never while someone is typing in the form.
  if (sig === st.sig && st.result) return;
  if (sig !== st.sig && $('#sell-form').contains(document.activeElement) && st.result) return;
  st.data = data; st.sig = sig;
  await typeInfo([...new Set([...data.rows.map(r => r.type), ...data.ships.map(s => s.shipType)])]).then(info => { st.info = new Map([...st.info, ...info]); });
  if (st.data !== data) return;
  drawForm(); iskEcho($('#sell-perjump'));
  plan();
}

async function plan() {
  const mark = ++st.run, g = mapGraph(), status = $('#sell-status'), content = $('#sell-content'), {data} = st, o = options();
  store.set(o); brief();
  const ships = data.ships.filter(s => !st.off.has(s.pilot)), live = new Set(ships.map(s => s.pilot));
  const rows = data.rows.filter(r => !st.skip.has(r.key) && qtyOf(r) > 0 && (r.from.kind === 'hangar' || live.has(r.from.pilot)));
  const sized = rows.filter(r => m3Of(r.type) !== undefined), unsized = rows.length - sized.length;
  if (!ships.length || !sized.length) {
    st.result = null; delete $('#sell').dataset.planned;
    status.textContent = !ships.length ? 'Tick at least one ship.' : 'Nothing to sell yet.'; content.innerHTML = ''; return;
  }
  status.textContent = 'Planning…'; content.setAttribute('aria-busy', 'true');
  if (!content.children.length) content.innerHTML = skeleton('Planning the sale…');
  try {
    const lots = sized.map(r => ({type:r.type, qty:qtyOf(r), m3:m3Of(r.type), from:r.from}));
    const fleet = ships.map(s => ({pilot:s.pilot, name:s.name, shipType:s.shipType, capacity:st.caps.get(s.pilot) ?? st.info.get(s.shipType)?.capacity ?? 0, system:s.system, station:s.station}));
    const pickups = [...new Set(lots.filter(l => l.from.kind === 'hangar').map(l => l.from.station))];
    const starts = [...fleet.map(s => s.system), ...pickups.map(p => systemOf(g, p))].filter(Boolean);
    const types = [...new Set(lots.map(l => l.type))];
    const loaded = await quoteBook.load(types, candidateRegions(g, {starts, hubs:HUB_SYSTEMS.map(h => h[0]), maxJumps:o.maxJumps}));
    if (mark !== st.run) return;
    const book = new Map(), stationMap = new Map();
    for (const [loc, s] of S.marketBook?.stations || []) if (g.systems.has(s.system)) stationMap.set(loc, {system:s.system, name:s.name, region:g.systems.get(s.system).region});
    for (const s of fleet) if (s.station && s.system && !g.stations.has(s.station) && !stationMap.has(s.station)) stationMap.set(s.station, {system:s.system, name:'', region:g.systems.get(s.system)?.region});
    for (const [type, list] of loaded.quotes) for (const q of list) book.set(q.order, q);
    const skills = summary(mine()).skills, meta = S.marketData.meta?.data || {};
    const result = await planSellInWorker(g, snapshotOf(S.marketData), {lots, ships:fleet, quotes:loaded.quotes, stations:stationMap, salesTax:fees(skills, meta.skills).salesTax, risk:{now:Date.now()}, options:o});
    if (mark !== st.run) return;
    await resolveNames(result.plans.flatMap(p => [...p.ships.flatMap(s => s.stops.flatMap(x => [x.station]))]).filter(id => id >= 60000000 && id < 64000000 && !stations(g).byId.has(id))).catch(() => {});
    if (mark !== st.run) return;
    st.result = {...result, book, loaded, unsized, input:{ships:fleet}};
    // The best plan is shown until someone picks another card (and for as long as that card still exists).
    if (!st.picked || !result.plans.some(p => p.key === st.mode)) { st.picked = false; st.mode = (result.plans.find(p => p.key === 'best') || result.plans.find(p => p.also.includes('best')) || result.plans[0])?.key || null; }
    content.removeAttribute('aria-busy');
    $('#sell').dataset.planned = '1';
    // On a phone the answer comes first: after the first plan the settings fold away.
    if (!st.folded && matchMedia('(max-width:720px)').matches) { $('#sell-setup').open = false; st.folded = true; }
    drawPlans();
  } catch (error) {
    if (mark !== st.run) return;
    content.removeAttribute('aria-busy'); content.innerHTML = '';
    status.textContent = `Couldn’t plan the sale: ${error.message}`;
  }
}

// ── The plans ──
const REASONS = {'no quotes':'No buy orders found', 'below floor':'Buy orders are below the price floor', 'no buyer in range':'No buyer within reach', 'no buyer on route':'No buyer on this route', 'not picked up':'Not picked up on this trip', 'no room':'No room left in the hold', 'no ship':'No ship to carry it'};
const ALSO = {here:'Sell here', best:'Best', most:'Most ISK'};
const rangeText = r => typeof r === 'number' ? (r === 0 ? 'this system' : `range ${plural(r, 'jump')}`) : r === 'region' ? 'region wide' : r === 'solarsystem' ? 'same system' : 'this station';
function drawPlans() {
  const g = mapGraph(), r = st.result, content = $('#sell-content'), status = $('#sell-status');
  if (!r) return;
  const plans = r.plans, chosen = plans.find(p => p.key === st.mode) || plans[0];
  const when = r.loaded.at ? `Buy orders as of ${AGE(r.loaded.at)}` : 'No buy orders loaded';
  status.textContent = `${plural(plans.length, 'plan')} · ${when} · ${plural(r.loaded.calls, 'request')} to EVE${r.loaded.cached ? `, ${r.loaded.cached} from the last 5 minutes` : ''}.`;
  if (!chosen) { content.innerHTML = '<article class="card"><p class="alert warn">There is no plan to show for these ships and items.</p></article>'; return; }
  const card = p => `<button type="button" class="mode ${p.key === chosen.key ? 'on' : ''}" data-sell-plan="${esc(p.key)}" aria-pressed="${p.key === chosen.key}">
    <b>${esc(p.label)}</b><span class="mode-big num">${plural(p.jumps, 'jump')}</span><small>${format(p.net, 'isk')} net · ${format(p.expectedLoss, 'isk')} expected loss</small><small>Score ${format(p.score, 'isk')} · ${Math.round(p.soldShare * 100)}% sold</small>${p.also.length ? `<small>Also ${p.also.map(k => ALSO[k] || k).join(' and ')}</small>` : ''}</button>`;
  const notes = [];
  for (const n of r.notes) {
    if (n.kind === 'no-quotes') notes.push(`No buy orders found for ${name(n.type)}.`);
    else if (n.kind === 'below-floor') notes.push(`Every buy order for ${name(n.type)} is under the price floor.`);
    else if (n.kind === 'thin' && n.plan === chosen.key) notes.push(`Thin book for ${name(n.type)}: this plan sells ${num(n.qty)}, about ${Math.round(n.share * 100)}% of the buy orders it can reach. The price will not hold.`);
  }
  const l = r.loaded;
  if (l.capped) notes.push(`Stopped after ${l.calls} requests to EVE, so some regions are missing. Try fewer jumps or fewer items.`);
  if (l.failed.length) notes.push(`Buy orders could not be loaded for ${plural(l.failed.length, 'region and item pair', 'region and item pairs')}; those prices are missing.`);
  if (r.unsized) notes.push(`${plural(r.unsized, 'item')} left out because EVE did not give its size.`);
  const unsold = chosen.unsold.filter(u => u.qty > 0).sort((a, b) => name(a.type).localeCompare(name(b.type)));
  content.innerHTML = `<div class="modes sell-modes" role="group" aria-label="Plans">${plans.map(card).join('')}</div>
    <article class="card sell-plan" aria-label="${esc(chosen.label)} plan"><div class="card-head"><div><h3>${esc(chosen.label)}</h3>
      <p class="hint">${plural(chosen.jumps, 'jump')} · ${format(chosen.net, 'isk')} after tax · ${format(chosen.expectedLoss, 'isk')} expected loss · ${Math.round(chosen.soldShare * 100)}% of the value sold${chosen.also.length ? ` · also ${chosen.also.map(k => esc(ALSO[k] || k)).join(' and ')}` : ''}.</p></div></div>
      ${chosen.ships.map(s => shipPlan(g, s, r)).join('')}
      ${unsold.length ? `<section class="sell-unsold"><h4>Not sold</h4><ul class="plain">${unsold.map(u => `<li><b>${num(u.qty)} × ${esc(name(u.type))}</b> <small>${esc(REASONS[u.reason] || u.reason)}${u.station ? ` · at ${esc(placeName(g, u.station))}` : ''}</small></li>`).join('')}</ul></section>` : ''}
      ${notes.length ? `<ul class="sell-notes">${notes.map(n => `<li class="alert warn">${esc(n)}</li>`).join('')}</ul>` : ''}</article>`;
}
function shipPlan(g, s, r) {
  const pilot = S.pilots.find(p => p.id === s.pilot), ids = s.route, label = `Sell: ${s.name}`, here = ids[0], hasRoute = ids.length > 1;
  const stops = s.stops.map(x => `<li><b>${esc(placeName(g, x.station, x.system))}</b> <small>${esc(sysName(g, x.system))}</small>
    ${x.pickups.length || x.sales.length ? `<ul class="plain">${x.pickups.map(k => `<li>Pick up ${num(k.qty)} × ${esc(name(k.type))}</li>`).join('')}${x.sales.map(k => {
      const q = r.book.get(k.order), far = k.orderLoc !== x.station;
      return `<li>Sell ${num(k.qty)} × ${esc(name(k.type))} at ${k.price.toLocaleString(undefined, {maximumFractionDigits:2})} <span class="num">· ${format(k.net, 'isk')}</span>${far ? ` <small>(buy order in ${esc(placeName(g, k.orderLoc, q?.system))}, ${rangeText(q?.range)})</small>` : ''}</li>`;
    }).join('')}</ul>` : ''}</li>`).join('');
  const can = pilot?.id && S.backend?.has(pilot.id), sendIds = hasRoute ? sendable(ids, [ids[0], ...s.stops.map(x => x.system)]) : [];
  return `<section class="sell-ship-plan" data-pilot="${esc((pilot?.name || '').toLowerCase())}" aria-label="${esc(s.name)}"><header class="sell-ship-plan__head"><div><b>${esc(s.name)}</b><small>${esc(pilot?.name || '')} · starts in ${esc(sysName(g, here))}</small></div>
    <span class="tag ${hasRoute ? '' : 'dim'}">${plural(s.jumps, 'jump')}</span><span class="num">${format(s.net, 'isk')}</span></header>
    ${s.stops.length ? `<ol class="sell-stops">${stops}</ol>` : '<p class="hint">Nothing to sell or pick up on this trip.</p>'}
    ${hasRoute ? `<p class="hint">${esc(ids.slice(0, 10).map(id => sysName(g, id)).join(' → '))}${ids.length > 10 ? ` … ${esc(sysName(g, ids.at(-1)))}` : ''}</p>` : ''}
    <div class="actions"><button type="button" class="secondary small" data-sell-map="${s.pilot}" ${hasRoute ? '' : 'disabled'}>Open in Star map</button>
      <button type="button" class="small" data-sell-send="${s.pilot}" data-ids="${sendIds.join(',')}" ${can && sendIds.length ? '' : 'disabled'}>Send to autopilot</button><span class="hint" role="status" data-sell-out="${s.pilot}">${!hasRoute ? 'Already there; nothing to send.' : can ? '' : `Connect ${esc(pilot?.name || 'this pilot')} in this browser to send this.`}</span></div></section>`;
}

// ── Wiring ──
async function refresh() { st.sig = ''; st.result = null; await render(); }
async function savePickup(station) {
  const me = mine(), g = mapGraph();
  try {
    await S.backend.setSellStation(me.id, station);
    me.sellStation = station;
    st.editing = false; st.note = station ? `Hangar contents for ${placeName(g, station)} arrive with the next sync (up to 10 minutes).` : '';
    await refresh();
  } catch (error) { st.note = `Couldn’t save the station: ${error.message}`; drawPickup(); }
}
async function paste() {
  const out = $('#sell-paste-out'), {rows, bad} = parsePaste($('#sell-paste-text').value);
  if (!rows.length) { out.textContent = bad.length ? `Couldn’t read ${plural(bad.length, 'line')}. Use “Name, tab, quantity” or “5 x Name”.` : 'Paste some items first.'; return; }
  out.textContent = 'Looking up names…';
  try {
    const found = new Map();
    const ids = await esi('universe/ids/', {method:'POST', body:JSON.stringify(rows.map(x => x.name))});
    for (const t of ids.inventory_types || []) { found.set(t.name.toLowerCase(), t.id); names.set(t.id, t.name); }
    const unknown = [];
    for (const x of rows) { const id = found.get(x.name.toLowerCase()); if (id) st.pasted.set(id, (st.pasted.get(id) || 0) + x.qty); else unknown.push(x.name); }
    const added = rows.length - unknown.length;
    out.textContent = `${added ? `Added ${plural(added, 'item')}.` : ''}${unknown.length ? ` Not found: ${unknown.join(', ')}.` : ''}${bad.length ? ` Skipped ${plural(bad.length, 'line')} it couldn’t read.` : ''}`.trim();
    if (added) { $('#sell-paste-text').value = ''; await refresh(); }
  } catch (error) { out.textContent = `Couldn’t look the names up: ${error.message}`; }
}
export function wire() {
  const form = $('#sell-form'), changed = event => {
    const t = event.target;
    if (t.matches('[data-ship-include]')) t.checked ? st.off.delete(Number(t.dataset.shipInclude)) : st.off.add(Number(t.dataset.shipInclude));
    else if (t.matches('[data-ship-cap]')) { const n = Number(t.value); if (n >= 0 && t.value !== '') st.caps.set(Number(t.dataset.shipCap), n); else st.caps.delete(Number(t.dataset.shipCap)); }
    else if (t.matches('[data-lot-include]')) { t.checked ? st.skip.delete(t.dataset.lotInclude) : st.skip.add(t.dataset.lotInclude); t.closest('.sell-lot').classList.toggle('is-off', !t.checked); }
    else if (t.matches('[data-lot-qty]')) {
      const n = Math.floor(Number(t.value)), row = st.data.rows.find(r => r.key === t.dataset.lotQty);
      if (t.value === '' || !(n >= 0)) st.qty.delete(t.dataset.lotQty); else st.qty.set(t.dataset.lotQty, n);
      t.value = qtyOf(row); t.closest('.sell-lot').querySelector('.sell-lot__m3').textContent = m3Of(row.type) === undefined ? '—' : `${m3Text(qtyOf(row) * m3Of(row.type))} m³`;
    }
    else if (!t.matches('#sell-perjump, #sell-jumps, #sell-lowsec, #sell-together, #sell-return')) return;
    if (t.matches('#sell-perjump')) iskEcho(t);
    plan();
  };
  form.addEventListener('change', changed);
  form.addEventListener('submit', event => { event.preventDefault(); plan(); });
  form.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.id === 'sell-pickup-input') { event.preventDefault(); form.querySelector('[data-sell-save]').click(); } });
  form.addEventListener('click', async event => {
    const b = event.target.closest('button');
    if (!b) return;
    if (b.matches('[data-sell-change]')) { st.editing = true; drawPickup(); $('#sell-pickup input').focus(); $('#sell-pickup input').select(); }
    else if (b.matches('[data-sell-cancel]')) { st.editing = false; drawPickup(); }
    else if (b.matches('[data-sell-docked]')) { b.disabled = true; await savePickup(null); }
    else if (b.matches('[data-sell-save]')) {
      const id = stations(mapGraph()).byName.get($('#sell-pickup input').value.trim().toLowerCase());
      if (!id) { st.note = 'Pick a station from the list.'; drawPickup(); $('#sell-pickup input').focus(); return; }
      b.disabled = true; await savePickup(id);
    } else if (b.id === 'sell-paste-add') paste();
  });
  $('#sell-content').addEventListener('click', async event => {
    const b = event.target.closest('button'), g = mapGraph();
    if (!b) return;
    if (b.dataset.sellPlan) { st.mode = b.dataset.sellPlan; st.picked = true; drawPlans(); return; }
    const chosen = st.result?.plans.find(p => p.key === st.mode);
    if (b.dataset.sellMap && chosen) {
      // Every ship's route goes on the map, the one asked for last so the map opens on it.
      const routed = chosen.ships.filter(s => s.route.length > 1).sort((a, c) => (a.pilot === Number(b.dataset.sellMap)) - (c.pilot === Number(b.dataset.sellMap)));
      for (const s of routed) S.map.layers = addLayer(S.map.layers, {label:`Sell: ${s.name}`, ids:s.route});
      showOnMap(routed.at(-1).route.at(-1));
    } else if (b.dataset.sellSend) {
      const out = $(`[data-sell-out="${b.dataset.sellSend}"]`), id = Number(b.dataset.sellSend);
      b.disabled = true; out.textContent = 'Sending…';
      try { const r = await S.backend.waypoints(id, b.dataset.ids.split(',').map(Number)); out.textContent = `Autopilot set: ${plural(r.waypoints, 'waypoint')}.`; }
      catch (error) { out.textContent = error.message; }
      b.disabled = false;
    }
  });
}
