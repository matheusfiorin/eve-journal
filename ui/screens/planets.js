// Planets: each pilot's planetary colonies, what their extractors are doing and when they run out.
// Colony state comes from ESI, which only refreshes it when the colony is viewed in game; every figure is as of that visit.
import {colonies} from '../../colonies.js';
import {S, ordered, opsOf} from '../state.js';
import {esi, name, resolveNames} from '../esi.js';
import {$, esc, plural, duration, when, permissionBanner, wingNote} from '../shared.js';

const volumes = new Map(), asked = new Set();
let run = 0;
// m3 per unit for the stored goods, from ESI's public type data; storage fill appears once these are in.
async function loadVolumes(ids) {
  const todo = [...new Set(ids)].filter(id => !volumes.has(id) && !asked.has(id));
  todo.forEach(id => asked.add(id));
  await Promise.all(todo.map(async id => { try { volumes.set(id, (await esi(`universe/types/${id}/`)).volume); } catch { asked.delete(id); } }));
  return todo.length > 0 && todo.some(id => volumes.has(id));
}
const ago = (at, now) => { const s = Math.max(0, (now - at) / 1000); return s < 90 ? 'just now' : `${duration(s)} ago`; };
const state = {
  expired:x => `<span class="tag neg">Expired ${esc(ago(x.end, Date.now()))}</span>`,
  soon:x => `<span class="tag flag">Expires in ${esc(duration((x.end - Date.now()) / 1000))}</span>`,
  ok:x => `<span class="tag dim">Expires in ${esc(duration((x.end - Date.now()) / 1000))}</span>`,
  unknown:() => '<span class="tag dim">No expiry known</span>'
};
const rate = x => x.perHour ? `${Math.round(x.perHour).toLocaleString()} an hour` : 'rate unknown';
function colonyHtml(c, now) {
  const where = name(c.system), pins = c.pending ? 'Details still loading' : `${plural(c.pinCount ?? 0, 'pin')}${c.factories ? ` · ${plural(c.factories, 'factory', 'factories')}` : ''}`;
  const badge = c.worst === 'expired' ? '<span class="chip chip--danger">Extractor expired</span>' : c.worst === 'soon' ? '<span class="chip chip--warn">Expires within a day</span>' : c.worst === 'ok' ? '<span class="chip chip--ok">Running</span>' : '';
  const fill = c.storage?.fill;
  return `<li class="colony" data-row data-colony tabindex="0" data-find="${esc(`${c.name} ${where} ${c.ext.map(x => name(x.product)).join(' ')}`.toLowerCase())}">
    <div class="colony__head"><b>${esc(c.name)} planet</b><span>${esc(where)}</span>${c.level !== undefined ? `<span class="tag dim">Level ${c.level}</span>` : ''}${badge}</div>
    <p class="colony__meta">${pins}${c.links !== undefined && !c.pending ? ` · ${plural(c.links, 'link')}` : ''}${c.hasRates ? ` · about ${Math.round(c.perHour).toLocaleString()} units an hour now` : ''}</p>
    ${c.ext.length ? `<ul class="colony__ext" aria-label="Extractors on this ${esc(c.name.toLowerCase())} planet">${c.ext.map(x => `<li><span>${esc(name(x.product))}<small>${plural(x.heads, 'head')} · ${rate(x)}</small></span>${state[x.state](x)}</li>`).join('')}</ul>` : c.pending ? '' : '<p class="colony__meta">No extractors.</p>'}
    ${c.storage ? (fill === null ? `<p class="colony__meta">Storage holds up to ${c.storage.cap.toLocaleString()} m³.</p>` : `<div class="colony__store"><span class="stack" role="img" aria-label="Storage ${Math.round(fill * 100)}% full"><i class="fill" style="width:${(fill * 100).toFixed(0)}%"></i></span><small>Storage ${Math.round(fill * 100)}% full (${Math.round(c.storage.held).toLocaleString()} of ${c.storage.cap.toLocaleString()} m³)</small></div>`) : ''}
    <p class="colony__meta">${c.updated ? `Last updated in game ${esc(ago(c.updated, now))}` : 'Last update unknown'}${c.updated && now - c.updated > 86400000 ? ` (${esc(when(c.updated))})` : ''}</p></li>`;
}
export async function render() {
  const mark = ++run, status = $('#planets-status'), content = $('#planets-content');
  if (!S.backend) { status.textContent = 'Planets need the backend.'; content.innerHTML = '<div class="state state--empty"><p><b>Planets need the backend.</b> Set <code>backendUrl</code> in config.json, then reload.</p></div>'; return; }
  const pilots = ordered().map(p => ({p, f:opsOf(p).planets, list:opsOf(p).planets?.value?.planets}));
  const ids = pilots.flatMap(x => (x.list || []).flatMap(pl => [pl.system, ...(pl.pins?.ext || []).map(e => e[0]), ...(pl.pins?.vault || []).map(v => v[0])]));
  await resolveNames(ids).catch(() => {});
  if (mark !== run) return;
  const now = Date.now(), all = pilots.map(x => ({...x, rows:colonies(x.list, now, id => volumes.get(id))}));
  const rows = all.flatMap(x => x.rows), expired = rows.filter(c => c.worst === 'expired').length, soon = rows.filter(c => c.worst === 'soon').length;
  status.textContent = rows.length ? `${plural(rows.length, 'colony', 'colonies')} across ${plural(all.filter(x => x.rows.length).length, 'pilot')}` : 'No colonies to show yet.';
  const section = (x, i) => {
    const lacking = x.p.private && x.f && !x.f.permission, shared = !x.p.private && Boolean(S.wing.get(x.p.id)?.sharing && S.wing.get(x.p.id).shareLevel >= 2);
    const body = lacking ? permissionBanner(x.p, ['planetary colonies'])
      : x.rows.length ? `<ul class="colonies">${x.rows.map(c => colonyHtml(c, now)).join('')}</ul>`
      : x.p.private || shared ? `<p class="hint">${x.f?.permission || shared ? 'No colonies found.' : 'Not synced yet.'}</p>`
      : `<p class="hint">${esc(x.p.name)}’s colonies are not shared with the wing.</p>${wingNote(x.p)}`;
    return `<section class="panel colony-group" data-pilot="${esc(x.p.name.toLowerCase())}" aria-labelledby="planets-h-${i}"><div class="panel__head"><h2 id="planets-h-${i}">${esc(x.p.name)}’s colonies</h2>${x.rows.length ? `<span class="hint">${plural(x.rows.length, 'colony', 'colonies')}</span>` : ''}</div>${body}</section>`;
  };
  content.innerHTML = `<section class="panel earn-sum" aria-label="Summary"><dl class="readout"><div><dt>Colonies</dt><dd class="num">${rows.length}</dd></div><div><dt>Extractors expired</dt><dd class="num ${expired ? 'neg' : ''}">${expired}</dd></div><div><dt>Expiring within a day</dt><dd class="num ${soon ? 'warn-text' : ''}">${soon}</dd></div></dl>
    <p class="earn-sum__line">EVE only refreshes a colony’s state when you view it in game, so expiry times and storage are as of your last visit. Open the colony in game to update them here.</p></section>${all.map(section).join('')}`;
  apply();
  // Storage fill needs each stored good's volume; draw again once they are in.
  loadVolumes(all.flatMap(x => (x.list || []).flatMap(pl => (pl.pins?.vault || []).map(v => v[0])))).then(changed => { if (changed && mark === run) render(); });
}
function apply() {
  const q = ($('#planets-filter')?.value || '').trim().toLowerCase(), items = [...document.querySelectorAll('#planets [data-colony]')];
  items.forEach(li => { li.hidden = Boolean(q) && !li.dataset.find.includes(q); });
  const none = $('#planets-none');
  if (none) none.hidden = !q || items.length === 0 || items.some(li => !li.hidden);
}
export function wire() { $('#planets-filter').addEventListener('input', apply); }
