// A pilot's contracts for the Ledger: open, in progress and recently over, with the courier terms up front and a drawer per
// contract. Items are read on demand (one request per contract), never by the sync.
import {contractDue} from '../orders.js';
import {S} from './state.js';
import {name, place, resolveNames} from './esi.js';
import {esc, isk, format, when, left, plural, permissionBanner, openDrawer} from './shared.js';

const TYPE = {item_exchange: 'Item exchange', courier: 'Courier', auction: 'Auction', loan: 'Loan', unknown: 'Contract'};
const STATUS = {outstanding: 'Outstanding', in_progress: 'In progress', finished: 'Completed', finished_issuer: 'Completed', finished_contractor: 'Completed', failed: 'Failed', rejected: 'Rejected', cancelled: 'Cancelled', reversed: 'Reversed', expired: 'Expired'};
const DAY = 86400000;
const over = c => c.status === 'outstanding' && Date.parse(c.date_expired) <= Date.now();
// Open (not yet past expiry), in progress, and the most recent that are over (finished, failed, or run out).
export function groups(list, now = Date.now()) {
  const open = list.filter(c => c.status === 'outstanding' && !over(c)), going = list.filter(c => c.status === 'in_progress');
  const done = list.filter(c => !open.includes(c) && !going.includes(c)).map(c => over(c) ? {...c, status: 'expired'} : c)
    .sort((a, b) => Date.parse(b.date_completed || b.date_expired || b.date_issued) - Date.parse(a.date_completed || a.date_expired || a.date_issued)).slice(0, 8);
  return {open, going, done};
}
// Due within a day: the flag every open contract can carry.
export const expiring = (c, now = Date.now()) => { const due = contractDue(c); return due !== null && due > now && due - now < DAY; };
const terms = c => c.type === 'courier' ? `Reward ${format(c.reward, 'isk')} · Collateral ${format(c.collateral, 'isk')}`
  : c.price > 0 ? `Asks ${format(c.price, 'isk')}` : c.reward > 0 ? `Pays ${format(c.reward, 'isk')}` : 'No price';
const row = c => {
  const due = contractDue(c), soon = expiring(c);
  const route = c.type === 'courier' ? `${esc(place(c.start_location_id))} → ${esc(place(c.end_location_id))}${c.volume ? ` · ${Math.round(c.volume).toLocaleString()} m³` : ''}` : esc(c.title || '');
  return `<li><button type="button" class="crow" data-contract="${c.contract_id}" aria-label="${esc(`${TYPE[c.type] || TYPE.unknown} contract, ${STATUS[c.status] || c.status}${soon ? ', expires soon' : ''}`)}">
    <span class="crow__main"><b>${esc(TYPE[c.type] || TYPE.unknown)}${c.title && c.type === 'courier' ? ` · ${esc(c.title)}` : ''}</b><small>${route ? `${route} · ` : ''}${esc(terms(c))}</small></span>
    <span class="crow__tags"><span class="chip">${STATUS[c.status] || esc(c.status)}</span>${soon ? `<span class="chip chip--warn" data-expiring>Expires in ${esc(left(due))}</span>` : due && due > Date.now() && c.status === 'outstanding' ? `<small>${esc(left(due))} left</small>` : ''}</span></button></li>`;
};
export function contractsSection(p) {
  const wrap = body => `<section class="card contracts" aria-labelledby="contracts-title"><div class="panel__head"><div><h2 id="contracts-title">Contracts</h2><p class="panel__sub">Open, in progress and recently finished. Contracts expiring within a day are flagged.</p></div></div>${body}</section>`;
  const c = p.ops?.contracts;
  if (!p.private) return '';
  if (!c) return wrap('<p class="hint">Not synced yet. Press Refresh.</p>');
  if (!c.permission) return wrap(permissionBanner(p, ['contracts']));
  if (!Array.isArray(c.value)) return wrap(`<p class="hint">${esc(c.error || 'Not synced yet. Press Refresh.')}</p>`);
  const g = groups(c.value), section = (title, list) => list.length ? `<h3 class="ed-h">${title} <span class="num seg__n">${list.length}</span></h3><ul class="clist">${list.map(row).join('')}</ul>` : '';
  const none = !g.open.length && !g.going.length && !g.done.length;
  return wrap(`${none ? '<div class="state"><p><b>No contracts.</b> Contracts you issue or accept show up here after the next sync.</p></div>' : section('Outstanding', g.open) + section('In progress', g.going) + section('Recently finished or expired', g.done)}${c.error ? `<p class="error">${esc(c.error)} Showing the previous contracts.</p>` : ''}`);
}
const kv = list => `<dl class="kv">${list.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
export function contractDrawer(p, id) {
  const c = (p.ops?.contracts?.value || []).find(x => x.contract_id === id); if (!c) return;
  const status = over(c) ? 'expired' : c.status, due = contractDue(c), who = x => x ? esc(name(x)) : '';
  const courier = c.type === 'courier';
  openDrawer({title: `${TYPE[c.type] || TYPE.unknown} contract`, body: `
    ${kv([['Status', STATUS[status] || esc(status)], ['Issued by', who(c.issuer_id)], [c.acceptor_id ? 'Accepted by' : 'Assigned to', who(c.acceptor_id || c.assignee_id) || (c.availability === 'public' ? 'Anyone' : '')],
      ['Issued', esc(when(c.date_issued))], [c.date_completed ? 'Completed' : due && c.status === 'in_progress' ? 'Due' : 'Expires', esc(when(c.date_completed || due || c.date_expired))],
      ['Price', c.price > 0 ? esc(isk(c.price)) : ''], ['Reward', c.reward > 0 ? esc(isk(c.reward)) : ''], ['Collateral', c.collateral > 0 ? esc(isk(c.collateral)) : ''],
      ['Volume', c.volume ? `${Math.round(c.volume).toLocaleString()} m³` : ''], ['Pick up at', c.start_location_id ? esc(place(c.start_location_id)) : ''], [courier ? 'Deliver to' : 'Location', c.end_location_id && courier ? esc(place(c.end_location_id)) : ''],
      ['Days to complete', c.days_to_complete ? String(c.days_to_complete) : '']])}
    ${expiring(c) ? `<p class="alert warn">This contract runs out in ${esc(left(due))}.</p>` : ''}
    ${courier ? '<p class="hint">Courier contracts carry cargo, not a list of items.</p>' : `<div class="actions"><button type="button" class="secondary small" data-contract-items="${c.contract_id}">Show items</button></div><div id="contract-items" aria-live="polite"></div>`}`});
}
/** Read the contract's items from the backend and list them in the open drawer. */
export async function showItems(p, id) {
  const host = document.getElementById('contract-items'); if (!host) return;
  host.innerHTML = '<p class="hint">Loading items…</p>';
  try {
    const items = await S.backend.contractItems(p.id, id);
    await resolveNames(items.map(i => i.type_id)).catch(() => {});
    if (!document.getElementById('contract-items')) return; // the drawer was closed meanwhile
    const line = i => `<li><b>${esc(name(i.type_id))}</b> <span class="num">×${Number(i.quantity).toLocaleString()}</span></li>`;
    const given = items.filter(i => i.is_included), asked = items.filter(i => !i.is_included);
    host.innerHTML = !items.length ? '<p class="hint">This contract has no items.</p>'
      : `${given.length ? `<h3 class="ed-h">${plural(given.length, 'item')} included</h3><ul class="plain">${given.map(line).join('')}</ul>` : ''}${asked.length ? `<h3 class="ed-h">Wanted in return</h3><ul class="plain">${asked.map(line).join('')}</ul>` : ''}`;
  } catch (error) { if (document.getElementById('contract-items')) host.innerHTML = `<p class="error">${esc(error.message)}</p>`; }
}
