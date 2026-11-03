// Ledger: where the ISK came from and went. One sortable table merges the wallet journal, market transactions and
// the 30-day mining ledger; industry jobs get one summary line that links to Earn → Jobs.
import {remaining} from '../../model.js';
import {jobState} from '../../jobs.js';
import {oreValue} from '../../mining.js';
import {S} from '../state.js';
import {mapGraph} from '../routes.js';
import {loadMarket} from '../marketdata.js';
import {name, place} from '../esi.js';
import {$, esc, isk, format, plural, connectButtons, openDrawer} from '../shared.js';
import {readout, pilotSeg, shownPilot, whenPilotChanges, sorter, sortBy, rowsHead, reveal, rowAttrs} from './pilot.js';

const KINDS = [['all', 'All'], ['bounty', 'Bounty'], ['market', 'Market'], ['industry', 'Industry'], ['tax', 'Tax'], ['transfer', 'Transfer'], ['mining', 'Mining']];
const kindOf = ref => /bount|agent_mission|ess_/.test(ref) ? 'bounty' : /market|broker|contract/.test(ref) ? 'market' : /industry|manufactur|research|copying|reprocess|planetary/.test(ref) ? 'industry' : /tax/.test(ref) ? 'tax' : /donation|transfer|insurance/.test(ref) ? 'transfer' : 'other';
const label = ref => String(ref).replaceAll('_', ' ');
export const markup = {ledger:`<div class="toolbar" role="toolbar" aria-label="Ledger"><div id="ledger-pilots"></div>
  <label class="field--inline field--search"><span class="sr-only">Search the ledger</span><input id="ledger-search" type="search" data-filter placeholder="Search entries  /" autocomplete="off"></label>
  <div class="chips" role="group" aria-label="Type">${KINDS.map(([v, l], i) => `<button type="button" class="chip-btn" data-ledger-kind="${v}" aria-pressed="${!i}">${l}</button>`).join('')}</div></div>
 <div id="ledger-content"></div>`};

let kind = 'all', rows = [], marketAsked = false;
const oreNames = () => new Map((S.marketData?.meta?.data?.ores || []).flatMap(o => Object.keys(o.grades).map(id => [Number(id), o])));
// Every money line as {date, kind, what, sub, amount, src}: the drawer reads src for the full record.
function collect(p) {
  const ops = p.ops || {}, out = [], tx = ops.transactions?.value;
  for (const r of ops.journal?.value || []) {
    // A market transaction shows once, from the transactions list, which names the item.
    if (Array.isArray(tx) && r.ref_type === 'market_transaction') continue;
    out.push({date:r.date, kind:kindOf(r.ref_type), what:label(r.ref_type), sub:r.description || '', amount:r.amount || 0, src:{type:'journal', r}});
  }
  for (const t of tx || []) out.push({date:t.date, kind:'market', what:`${t.is_buy ? 'Bought' : 'Sold'} ${name(t.type_id)} ×${Number(t.quantity).toLocaleString()}`, sub:place(t.location_id), amount:(t.is_buy ? -1 : 1) * t.quantity * t.unit_price, src:{type:'tx', t}});
  const ores = oreNames(), book = S.marketBook, sysName = id => mapGraph()?.systems.get(id)?.name || name(id);
  for (const m of ops.mining?.value || []) {
    const o = ores.get(m.type_id), v = o && book ? oreValue(o, book).perUnit * (1 + (o.grades[m.type_id] || 0)) * m.quantity : null;
    out.push({date:m.date, kind:'mining', what:`Mined ${o ? o.n : name(m.type_id)} ×${Number(m.quantity).toLocaleString()}`, sub:sysName(m.solar_system_id), amount:null, worth:Number.isFinite(v) ? v : null, src:{type:'mining', m}});
  }
  return out;
}
const amountCell = r => r.amount === null ? `<span role="cell" class="num rows__key">${r.worth ? `<span class="hint">worth</span> ${format(r.worth, 'isk')}` : '—'}</span>` : `<span role="cell" class="num rows__key ${r.amount < 0 ? 'neg' : 'pos'}">${esc(isk(r.amount))}</span>`;
function drawRows() {
  const st = sorter('ledger', {key:'date', dir:-1}, drawRows), q = ($('#ledger-search')?.value || '').trim().toLowerCase();
  const host = document.getElementById('ledger-table'); if (!host) return; // rendered with the view, not in the static markup
  const shown = sortBy(rows.filter(r => (kind === 'all' ? r.kind !== 'mining' : r.kind === kind) && (!q || `${r.what} ${r.sub}`.toLowerCase().includes(q))), st, (r, k) => k === 'date' ? Date.parse(r.date) : k === 'amount' ? r.amount ?? r.worth : r[k]);
  host.innerHTML = shown.length ? `<div class="rows ${reveal('ledger')}" role="table" aria-label="Wallet entries" style="--cols:96px minmax(0,1fr) 150px">${rowsHead('ledger', [['Date', 'date'], ['Entry', 'what'], ['Amount', 'amount']])}
    ${shown.slice(0, 200).map((r, i) => `<div ${rowAttrs(i, `data-ledger-row="${rows.indexOf(r)}"`)}><span role="cell" class="num rows__date">${esc(new Date(r.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}))}</span><span role="cell" class="rows__main"><span class="kind" data-kind="${r.kind}">${KINDS.find(k => k[0] === r.kind)?.[1] || 'Other'}</span><b>${esc(r.what)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>${amountCell(r)}</div>`).join('')}</div>`
    : `<div class="state"><p>${rows.length ? '<b>Nothing matches.</b> Try another type or clear the search.' : '<b>No wallet activity yet.</b> Bounties, trades and mining show up here after the next sync.'}</p></div>`;
}
const lineOf = (f, what) => !f ? 'Not synced yet. Press Refresh.' : !f.permission ? 'Permission not granted. Reconnect this pilot to allow it.' : f.error ? `${esc(f.error)}${f.value !== undefined ? ` Showing the previous ${what}.` : ''}` : '';
export function render() {
  $('#ledger-pilots').innerHTML = pilotSeg();
  const p = shownPilot(), content = $('#ledger-content');
  if (!p) { content.innerHTML = '<div class="state"><p>No pilots configured in config.json.</p></div>'; return; }
  if (!p.private) { rows = []; content.innerHTML = `<div class="state"><p><b>${esc(p.name)}’s wallet is private.</b> Connect this pilot to load the balance, journal and trades.</p>${connectButtons(p, S.pilots.indexOf(p))}</div>`; return; }
  const ops = p.ops || {}, wallet = ops.wallet, jobs = ops.jobs?.value;
  rows = collect(p);
  // Mined ore is valued from the market snapshot; fetch it once while the Ledger is on screen.
  if (!S.marketData && S.backend && ops.mining?.value?.length && !$('#ledger').hidden && !marketAsked) { marketAsked = true; loadMarket().then(render, () => {}); }
  const week = Date.now() - 7 * 86400000;
  const net = (ops.journal?.value || []).filter(r => Date.parse(r.date) >= week).reduce((t, r) => t + (r.amount || 0), 0);
  // A job past its end time is ready even while ESI still calls it active.
  const states = (jobs || []).map(j => jobState(j)), running = states.filter(st => st.active), ready = states.filter(st => st.ready).length;
  const next = running.length ? Date.now() + Math.min(...running.map(st => st.remaining)) : undefined;
  const problems = [['wallet', 'balance'], ['journal', 'journal'], ['transactions', 'transactions']].map(([k, w]) => [w, lineOf(ops[k], w)]).filter(([, m]) => m);
  content.innerHTML = `
  ${readout([['Balance', Number.isFinite(wallet?.value) ? `<span class="num" title="${esc(isk(wallet.value))}">${Math.floor(wallet.value).toLocaleString()}</span>` : '—', Number.isFinite(wallet?.value) ? 'ISK' : ''], ['Net, last 7 days', ops.journal?.value ? `<span class="num ${net < 0 ? 'neg' : 'pos'}">${net > 0 ? '+' : ''}${format(net, 'isk')}</span>` : '—'], ['Industry jobs running', Array.isArray(jobs) ? `<span class="num">${running.length}</span>` : '—']])}
  ${problems.map(([w, m]) => `<p class="alert warn">${w[0].toUpperCase() + w.slice(1)}: ${m}</p>`).join('')}
  <section class="card panel--primary ledger" data-pilot="${esc(p.name.toLowerCase())}" aria-label="${esc(p.name)}’s ledger"><div id="ledger-table"></div></section>
  <button type="button" class="card jobs-line" data-go="earn/jobs"><span><b>Industry jobs</b><small>${!ops.jobs ? 'Not synced yet' : !ops.jobs.permission ? 'Permission not granted' : jobs?.length ? `${plural(running.length, 'job')} running${ready ? `, ${ready} ready to deliver` : ''}${next ? `, next done in ${esc(remaining(next).replace(' remaining', ''))}` : ''} · ${jobs.slice(0, 3).map(j => `${esc(name(j.product_type_id || j.blueprint_type_id))} (${Number(j.runs)} runs)`).join(', ')}` : 'No current industry jobs'}</small></span><span class="jobs-line__go">Open Jobs</span></button>`;
  drawRows();
}
function rowDrawer(i) {
  const r = rows[i]; if (!r) return;
  const kv = list => `<dl class="kv">${list.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const {type, r:j, t, m} = r.src;
  openDrawer({title:r.what[0].toUpperCase() + r.what.slice(1), body:`${r.amount !== null ? `<p class="drawer-amount num ${r.amount < 0 ? 'neg' : 'pos'}">${esc(isk(r.amount))}</p>` : r.worth ? `<p class="drawer-amount num">${format(r.worth, 'isk')} <small>at today’s prices</small></p>` : ''}
    ${type === 'journal' ? kv([['When', esc(new Date(j.date).toLocaleString())], ['Type', esc(label(j.ref_type))], ['Description', esc(j.description)], ['Balance after', Number.isFinite(j.balance) ? esc(isk(j.balance)) : ''], ['Reason', esc(j.reason)]])
    : type === 'tx' ? kv([['When', esc(new Date(t.date).toLocaleString())], ['Item', esc(name(t.type_id))], ['Quantity', Number(t.quantity).toLocaleString()], ['Unit price', esc(isk(t.unit_price))], ['Where', esc(place(t.location_id))], ['Side', t.is_buy ? 'Bought' : 'Sold']])
    : kv([['Day', esc(m.date)], ['Ore', esc(r.what.replace(/^Mined /, ''))], ["System", esc(mapGraph()?.systems.get(m.solar_system_id)?.name || name(m.solar_system_id))]]) + '<p class="hint">Valued at the best of selling raw, compressed or reprocessed in the hubs today. Earn → Mine plans the next trip.</p>'}`});
}
export function wire() {
  document.getElementById('ledger').classList.add('vk');
  whenPilotChanges(render);
  $('#ledger-search').addEventListener('input', drawRows);
  document.addEventListener('click', event => {
    const chip = event.target.closest('[data-ledger-kind]');
    if (chip) { kind = chip.dataset.ledgerKind; document.querySelectorAll('[data-ledger-kind]').forEach(b => b.setAttribute('aria-pressed', String(b === chip))); drawRows(); return; }
    const row = event.target.closest('#ledger [data-ledger-row]');
    if (row && !event.target.closest('a,button')) rowDrawer(Number(row.dataset.ledgerRow));
  });
}
