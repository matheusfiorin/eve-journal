// Rendering helpers every screen uses: formatting, pilot headers, toasts, the drawer, skeletons and the tab scaffold.
import {escapeHTML as esc, remaining, queueState, compactNumber} from '../model.js';
import {S, ROMAN, reduced, counters, viaWing, opsOf} from './state.js';
import {name} from './esi.js';
import {loadMarket} from './marketdata.js';

export {esc};
export const $ = selector => document.querySelector(selector);
export const isk = value => `${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ISK`;
export const when = date => new Date(date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const pct = v => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;
export const duration = sec => sec >= 86400 ? `${(sec / 86400).toFixed(1)} d` : sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : `${Math.max(1, Math.round(sec / 60))} min`;
export const scannedAgo = () => S.marketData?.regions?.length ? `scanned ${Math.max(1, Math.round((Date.now() - Math.min(...S.marketData.regions.map(r => r.updatedAt))) / 60000))} min ago` : 'no recent scan';
export function format(value, kind) {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'isk') return `${compactNumber(value)} ISK`;
  if (kind === 'pct') return `${Math.round(value)}%`;
  if (kind === 'h') return value >= 24 ? `${Math.floor(value / 24)}d ${Math.round(value % 24)}h` : `${Math.round(value)}h`;
  return Math.round(value).toLocaleString();
}
// Numbers roll from their previous value; reduced motion shows the final value at once.
export const count = (key, value, kind = '') => Number.isFinite(value) ? `<span class="num" data-count="${value}" data-key="${esc(key)}" data-kind="${kind}">${format(value, kind)}</span>` : '—';
export function countUps() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count), key = el.dataset.key, from = counters.get(key) ?? 0, kind = el.dataset.kind;
    counters.set(key, target);
    if (reduced || from === target || el.closest('[hidden]')) { el.textContent = format(target, kind); return; }
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / 600);
      el.textContent = format(from + (target - from) * (1 - Math.pow(1 - k, 3)), kind);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
export function fact(label, value) { return `<div><dt>${label}</dt><dd>${value}</dd></div>`; }
export const portrait = (p, size, cls = '') => p?.id ? `<img class="portrait ${cls}" src="https://images.evetech.net/characters/${p.id}/portrait?size=${size >= 100 ? 256 : 128}" alt="Portrait of ${esc(p.name)}" width="${size}" height="${size}">` : `<span class="portrait ${cls}" aria-hidden="true"></span>`;
export const corpLine = p => p.corp ? `${esc(p.corp.name)} [${esc(p.corp.ticker)}]` : p.refreshing ? 'Loading…' : '';
export function connectButtons(p, index) {
  if (!S.backend) return '<p class="hint">Private data needs the backend, which is not configured here.</p>';
  // A wingmate who connected on their own device is already connected: offer "Connect here too", never a bare Connect.
  const label = p.private ? 'Reconnect' : viaWing(p) ? 'Connect here too' : 'Connect with EVE';
  return `<div class="actions"><button data-connect="${index}" class="${p.private || viaWing(p) ? 'secondary' : ''} small" ${!p.id || p.refreshing ? 'disabled' : ''}>${label}</button>${S.backend.has(p.id) ? `<button data-disconnect="${p.id}" class="secondary small">Disconnect</button>` : ''}</div>`;
}
// Why a wingmate's shared data is thin: an older consent (level 1 shares only wallet and assets) or a failing sync.
export function wingNote(p) {
  const w = !p.private && S.wing.get(p.id);
  if (!w?.sharing) return '';
  if (w.lastError) return `<p class="alert warn">${esc(p.name)}’s last sync failed: ${esc(w.lastError)}</p>`;
  if (w.shareLevel < 2) return `<p class="alert muted">${esc(p.name)} shares skills, wallet and assets. To share ship, location, jobs and mining too, ${esc(p.name)} reconnects once with the wing box ticked.</p>`;
  return '';
}
export function head(p, index, extra = '') {
  return `<div class="pilot-head" data-pilot="${esc(p.name.toLowerCase())}">${portrait(p, 56)}<div><h2>${esc(p.name)}</h2><p class="hint">${corpLine(p) || 'Corporation unavailable'}</p></div><span class="pill ${p.private || viaWing(p) ? 'ok' : ''}">${p.private ? 'Connected' : viaWing(p) ? 'Shared with the wing' : p.shared ? 'Shared' : 'Public'}</span></div>${extra}${p.error ? `<p class="error">${esc(p.error)}</p>` : ''}${wingNote(p)}`;
}
export function trainingAlert(p) {
  const state = queueState(p.queue);
  if (!state) return `<p class="alert muted">Training is private until ${esc(p.name)} connects.</p>`;
  if (state.kind === 'empty') return '<p class="alert danger">Not training. The skill queue is empty.</p>';
  if (state.kind === 'paused') return '<p class="alert warn">Training is paused. Start the queue in game.</p>';
  const active = `<b>${esc(name(state.active.skill_id))} ${ROMAN[state.active.finished_level]}</b>`;
  if (state.kind === 'ending') return `<p class="alert warn">Queue runs out in ${esc(remaining(state.end).replace(' remaining',''))}. Add skills soon. Training ${active}.</p>`;
  return `<p class="alert ok">Training ${active} · queue ends in ${esc(remaining(state.end).replace(' remaining',''))}</p>`;
}
export function pilotsOrEmpty(render) {
  return S.pilots.length ? [...S.pilots].sort((a,b) => (b.name === S.me) - (a.name === S.me)).map(p => render(p, S.pilots.indexOf(p))).join('') : '<div class="empty">No pilots configured in config.json.</div>';
}
// One private ESI field of a connected pilot, with the reason when it's missing.
export function field(p, key, render) {
  if (!p.private && viaWing(p)) {
    const f = opsOf(p)[key];
    return f ? render(f.value) : `<p class="hint">${esc(p.name)} keeps this on their own device. Connect ${esc(p.name)} in this browser too to see it here.</p>`;
  }
  if (!p.private) return '<p class="hint">Connect this pilot to load this data.</p>';
  const f = p.ops?.[key];
  if (!f) return '<p class="hint">Not synced yet. Press Refresh.</p>';
  if (!f.permission) return '<p class="hint">Permission not granted. Reconnect this pilot to allow it.</p>';
  return `${f.value !== undefined ? render(f.value) : ''}${f.error ? `<p class="error">${esc(f.error)}${f.value !== undefined ? ' Showing the previous data.' : ''}</p>` : ''}`;
}
// "Train next" list: [{name, level, from, why, omega}].
export const trainNext = items => `<ul class="plain">${items.map(k => `<li><b>${esc(k.name)} ${ROMAN[k.level]}</b>${k.omega ? ' <span class="tag">Omega</span>' : ''}<small>${k.from ? `from ${ROMAN[k.from]} · ` : ''}${esc(k.why)}</small></li>`).join('')}</ul>`;

// Every route on the page can be previewed on hover and opened in the 3D map modal.
export const routeAttrs = (ids, label) => `data-route="${ids.join(',')}" data-label="${esc(label)}"`;
export const mapButton = (ids, label) => ids.length > 1 ? `<button type="button" class="map-btn secondary small" data-map-route="${ids.join(',')}" data-label="${esc(label)}">3D view</button>` : '';

// Messages that last (errors, storage problems) go to #notice; transient confirmations are toasts.
export function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; }
export function toast(message, kind = 'info', ms = 4000) {
  const t = document.createElement('div');
  t.className = `toast toast--${kind}`; t.setAttribute('role', kind === 'danger' ? 'alert' : 'status'); t.textContent = message;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('toast--out'); setTimeout(() => t.remove(), reduced ? 0 : 240); }, ms);
}
// Navigate anywhere (a view id, an old tab id, "earn" or "earn/mine"); app.js owns the router.
export const go = key => document.dispatchEvent(new CustomEvent('go', {detail:key}));
// Save the journal store; screens that show goals or entries re-render on 'data-change'.
export function persist(next) {
  try { S.data = S.store.save(next); document.dispatchEvent(new Event('data-change')); return true; }
  catch (error) { notice(`${error.message} Your change was not saved.`); return false; }
}
// Pilot <select>s on the goal and entry forms: both pilots, everyone who has written, and the current value.
export function pilotOptions() {
  document.querySelectorAll('.pilot-select').forEach(select => {
    const prior = select.value;
    const options = [...new Set(['Both pilots', ...S.pilots.map(p => p.name), ...S.data.entries.map(e => e.pilot), ...S.data.goals.map(g => g.pilot), ...(prior ? [prior] : [])])];
    select.innerHTML = options.map(n => `<option>${esc(n)}</option>`).join('');
    if (prior) select.value = prior;
  });
}

export const skeleton = label => `<div class="skel-rows" aria-busy="true" aria-label="${esc(label)}"><p class="skel-label">${esc(label)}</p><i></i><i></i><i></i><i></i></div>`;
// The shared start of every market-backed view: backend check, skeleton, loadMarket, error line, stale-run guard.
// prefix names the view's #<prefix>-status and #<prefix>-content elements.
const runs = {};
export async function tabReady(prefix, loading, label) {
  const status = $(`#${prefix}-status`), content = $(`#${prefix}-content`);
  if (!S.backend) { status.textContent = `${label} needs the backend.`; return null; }
  const run = runs[prefix] = (runs[prefix] || 0) + 1;
  try { if (!S.marketData) content.innerHTML = skeleton(loading); await loadMarket(); }
  catch (error) { status.textContent = `Market data unavailable: ${error.message}`; content.innerHTML = ''; return null; }
  if (run !== runs[prefix]) return null;
  return {status, content, stale:() => run !== runs[prefix]};
}

// The right-hand drawer (a bottom sheet on phones). body and foot are trusted HTML built by the caller with esc().
export function openDrawer({title, body, foot = ''}) {
  const d = $('#drawer');
  $('#drawer-title').textContent = title; $('#drawer-body').innerHTML = body;
  $('#drawer-foot').innerHTML = foot; $('#drawer-foot').hidden = !foot;
  if (!d.open) d.showModal();
  return d;
}
export const closeDrawer = () => { if ($('#drawer').open) $('#drawer').close(); };
// After a person moves to another view: keep focus on the sub-view tabs if they were using them, otherwise move it to
// the screen's title, and announce where they landed.
export function landOn(id, viaTabs) {
  const view = document.getElementById(id), bar = $('#viewbar');
  const target = (viaTabs && bar.querySelector('[role=tab][aria-selected="true"]')) || view.querySelector('.screen-title') || (!bar.hidden && bar.querySelector('.screen-title')) || view;
  if (!target.matches('[role=tab]')) target.tabIndex = -1;
  target.focus({preventScroll:true});
  $('#announcer').textContent = document.title.replace(/ · Echelon$/, '');
}
