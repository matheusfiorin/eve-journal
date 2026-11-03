// Jobs: every industry job running for the wing, how far along it is, what's ready to deliver and which slots sit idle.
import {wingJobs} from '../../jobs.js';
import {skillLevels, SLOT_SKILLS} from '../../industry.js';
import {S, ordered} from '../state.js';
import {name, place} from '../esi.js';
import {$, esc, duration, plural, openDrawer} from '../shared.js';

export const markup = {jobs:`<div class="panel panel--primary jobs-head"><div class="panel__head"><div><h2>Industry jobs</h2><p id="jobs-status" class="panel__sub">What the wing has cooking, and what's ready to deliver.</p></div></div><div id="jobs-summary"></div></div>
  <div id="jobs-content"></div>`};

const jobsOf = p => p.private ? p.ops?.jobs : S.wing.get(p.id)?.jobs ? {permission:true, value:S.wing.get(p.id).jobs} : null;
const when = ms => new Date(ms).toLocaleString([], {weekday:'short', hour:'2-digit', minute:'2-digit'});
let current = [], timer = 0;

const board = () => {
  const pilots = ordered().map(p => {
    const f = jobsOf(p), skills = p.private ? p.skills : S.wing.get(p.id)?.skills;
    return {name:p.name, p, f, jobs:f?.permission ? f.value || [] : [], levels:skills?.skills ? skillLevels(skills, SLOT_SKILLS) : null};
  });
  return {pilots, w:wingJobs(pilots)};
};
// A row's identity and state; while these stay the same, the countdowns update in place.
const keyOf = x => `${x.pilot}:${x.job.job_id}:${x.ready}:${x.paused}`;
const next = w => w.next ? `${w.next.activity} · ${duration(w.next.remaining / 1000)}` : '—';
const eta = x => x.ready ? '<b class="pos">Ready to deliver</b>' : x.paused ? '<b class="warn-text">Paused</b>' : `<b class="num">${esc(duration(x.remaining / 1000))}</b><small>${esc(when(Date.parse(x.job.end_date)))}</small>`;
export function render() {
  const {pilots, w} = board();
  const focused = document.activeElement?.closest?.('#jobs-content [data-job]')?.dataset.key;
  current = w.list;
  const why = pilots.filter(x => !x.f?.permission).map(x => `${esc(x.name)}: ${!x.p.private && !S.wing.get(x.p.id) ? 'not connected or not shared' : x.f ? 'permission not granted (Reconnect)' : 'not synced yet'}`);
  $('#jobs-summary').innerHTML = `<dl class="readout"><div><dt>Running</dt><dd class="num">${w.running}</dd></div><div><dt>Ready to deliver</dt><dd class="num ${w.ready ? 'pos' : ''}">${w.ready}</dd></div><div><dt>Next to finish</dt><dd data-next>${esc(next(w))}</dd></div></dl>
    <div class="slot-row">${w.usage.map(u => `<span class="slot-chip" data-pilot="${esc(u.pilot.toLowerCase())}"><b>${esc(u.pilot)}</b>${u.total ? `build ${u.build}/${u.total.build} · science ${u.science}/${u.total.science}${u.build < u.total.build ? ` · <button type="button" class="link-btn" data-go="earn/build">${plural(u.total.build - u.build, 'idle build slot')}</button>` : ''}` : `${u.build} build · ${u.science} science`}</span>`).join('')}</div>
    ${why.length ? `<p class="hint">${why.join(' · ')}</p>` : ''}`;
  const row = (x, i) => `<li class="job ${x.ready ? 'is-ready' : x.paused ? 'is-paused' : ''}" data-pilot="${esc(x.pilot.toLowerCase())}" data-row data-job="${i}" data-key="${esc(keyOf(x))}" tabindex="0" role="button" aria-label="${esc(`${x.activity}: ${name(x.job.product_type_id || x.job.blueprint_type_id)}`)}">
    <span class="job__who">${esc(x.pilot)}</span>
    <div class="job__main"><b>${esc(name(x.job.product_type_id || x.job.blueprint_type_id))}</b><small><span class="tag ${x.kind === 'science' ? 'dim' : ''}">${esc(x.activity)}</span> ${x.job.activity_id === 5 ? `${plural(x.job.runs, 'copy', 'copies')} × ${plural(x.job.licensed_runs || 1, 'run')}` : plural(x.job.runs, 'run')} · ${esc(place(x.job.station_id || x.job.facility_id))}</small></div>
    <div class="job__bar" role="progressbar" aria-valuenow="${Math.round(x.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(x.progress * 100).toFixed(1)}%"></i></div>
    <div class="job__eta">${eta(x)}</div></li>`;
  $('#jobs-content').innerHTML = w.list.length ? `<ol class="jobs">${w.list.map(row).join('')}</ol>`
    : `<div class="empty">No jobs running. <button type="button" class="link-btn" data-go="earn/build">Find something to build</button></div>`;
  // A redraw keeps keyboard focus on the job it was on.
  if (focused) [...document.querySelectorAll('#jobs-content [data-job]')].find(el => el.dataset.key === focused)?.focus();
  clearInterval(timer);
  // Countdowns tick while the view is on screen.
  if (w.running) timer = setInterval(tick, 60000);
}
// Update progress and time left in place, so focus and a screen reader's place survive; redraw only when a job
// finishes, pauses or disappears.
function tick() {
  if ($('#jobs').hidden) { clearInterval(timer); return; }
  const {w} = board();
  if (w.list.map(keyOf).join() !== current.map(keyOf).join()) { render(); return; }
  current = w.list;
  const rows = document.querySelectorAll('#jobs-content [data-job]');
  w.list.forEach((x, i) => {
    const row = rows[i], bar = row?.querySelector('[role=progressbar]'); if (!row) return;
    bar.setAttribute('aria-valuenow', Math.round(x.progress * 100)); bar.firstElementChild.style.width = `${(x.progress * 100).toFixed(1)}%`;
    row.querySelector('.job__eta').innerHTML = eta(x);
  });
  const dd = $('#jobs-summary [data-next]'); if (dd) dd.textContent = next(w);
}
export function wire() {
  const open = el => {
    const x = current[Number(el.dataset.job)]; if (!x) return;
    const j = x.job;
    openDrawer({title:`${x.activity}: ${name(j.product_type_id || j.blueprint_type_id)}`, body:`<dl class="facts">
      <div><dt>Pilot</dt><dd>${esc(x.pilot)}</dd></div><div><dt>Status</dt><dd>${x.ready ? 'Ready to deliver' : esc(j.status)}</dd></div>
      <div><dt>Blueprint</dt><dd>${esc(name(j.blueprint_type_id))}</dd></div><div><dt>${j.activity_id === 5 ? 'Copies' : 'Runs'}</dt><dd class="num">${Number(j.runs)}${j.activity_id === 5 ? ` × ${Number(j.licensed_runs || 1)} runs` : ''}</dd></div>
      <div><dt>Started</dt><dd>${esc(new Date(j.start_date).toLocaleString())}</dd></div><div><dt>Ends</dt><dd>${esc(new Date(j.end_date).toLocaleString())}</dd></div>
      <div><dt>Where</dt><dd>${esc(place(j.station_id || j.facility_id))}</dd></div>${Number.isFinite(j.cost) ? `<div><dt>Job cost</dt><dd class="num">${esc(Math.round(j.cost).toLocaleString())} ISK</dd></div>` : ''}</dl>
      <p class="hint">${x.ready ? 'Deliver it at the station’s industry window to collect the output.' : `${Math.round(x.progress * 100)}% done.`}</p>`});
  };
  $('#jobs-content').addEventListener('click', e => { const el = e.target.closest('[data-job]'); if (el) open(el); });
  $('#jobs-content').addEventListener('keydown', e => { const el = e.target.closest('[data-job]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(el); } });
}
