// Ledger: where the ISK came from and went, per pilot (wallet, journal, market transactions, industry jobs).
import {remaining} from '../../model.js';
import {name, place} from '../esi.js';
import {$, esc, isk, head, connectButtons, pilotsOrEmpty, field} from '../shared.js';

export const markup = {ledger:'<div id="ledger-content" class="grid"></div>'};

export function render() {
  $('#ledger-content').innerHTML = pilotsOrEmpty((p, i) => `<article class="card">${head(p, i)}
    <h3>Balance</h3>${field(p, 'wallet', value => `<p class="big num">${esc(isk(value))}</p>`)}
    <h3>Recent journal</h3>${field(p, 'journal', rows => rows.length ? `<table><tbody>${rows.map(r => `<tr><td>${esc(new Date(r.date).toLocaleDateString())}</td><td>${esc(String(r.ref_type).replaceAll('_', ' '))}${r.description ? `<small>${esc(r.description)}</small>` : ''}</td><td class="num ${r.amount < 0 ? 'neg' : 'pos'}">${esc(isk(r.amount || 0))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No wallet activity.</p>')}
    <h3>Market transactions</h3>${field(p, 'transactions', rows => rows.length ? `<table><tbody>${rows.map(t => `<tr><td>${esc(new Date(t.date).toLocaleDateString())}</td><td><span class="tag ${t.is_buy ? 'neg' : 'pos'}">${t.is_buy ? 'Buy' : 'Sell'}</span> ${esc(name(t.type_id))} ×${Number(t.quantity).toLocaleString()}<small>${esc(place(t.location_id))}</small></td><td class="num ${t.is_buy ? 'neg' : 'pos'}">${esc(isk((t.is_buy ? -1 : 1) * t.quantity * t.unit_price))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No recent market transactions.</p>')}
    <h3>Industry jobs</h3>${field(p, 'jobs', jobs => jobs.length ? `<table><tbody>${jobs.slice(0, 20).map(j => `<tr><td>${esc(name(j.product_type_id || j.blueprint_type_id))}<small>${Number(j.runs)} runs</small></td><td>${esc(j.status)}</td><td class="num">${j.end_date ? esc(remaining(j.end_date)) : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No current industry jobs.</p>')}
    ${p.private ? '' : connectButtons(p, i)}</article>`);
}
