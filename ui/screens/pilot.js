// Pilot: the training queue, the skill sheet and clones for both pilots.
import {remaining, queueState, trainingProgress, levelOf} from '../../model.js';
import {ROMAN, typeGroup} from '../state.js';
import {name, place} from '../esi.js';
import {$, esc, when, plural, fact, head, connectButtons, trainingAlert, pilotsOrEmpty, field} from '../shared.js';

const INFOMORPH_SYNCHRONIZING = 33399;
export const markup = {
  training:'<div id="training-content" class="grid"></div>',
  skills:'<div id="skills-content" class="grid"></div>',
  clones:'<div id="clones-content" class="grid"></div>'
};

export function renderTraining() {
  const now = Date.now();
  $('#training-content').innerHTML = pilotsOrEmpty((p, i) => {
    const state = queueState(p.queue, now);
    if (!state) return `<article class="card">${head(p, i)}<div class="empty">Connect ${esc(p.name)} to see the training queue.</div>${connectButtons(p, i)}</article>`;
    const timed = state.pending.filter(q => q.finish_date);
    const start = Math.min(now, ...timed.map(q => Date.parse(q.start_date)));
    const span = (state.end || now) - start || 1;
    return `<article class="card">${head(p, i, trainingAlert(p))}
      ${state.active ? `<div class="active"><span class="label">Training now</span><h3>${esc(name(state.active.skill_id))} ${ROMAN[state.active.finished_level]}</h3><progress max="100" value="${trainingProgress(state.active, now)}" aria-label="Current skill progress"></progress><p class="hint">${esc(remaining(state.active.finish_date, now))} · ends ${esc(when(state.active.finish_date))}</p></div>` : ''}
      <p class="hint">${plural(state.pending.length, 'skill')} queued${state.end ? ` · queue ends ${esc(when(state.end))}` : ''}</p>
      <ol class="timeline">${state.pending.map(q => {
        const a = Date.parse(q.start_date), b = Date.parse(q.finish_date);
        const bar = Number.isFinite(a) && Number.isFinite(b) ? `<span class="bar"><i style="left:${Math.max(0, (Math.max(a, start) - start) / span * 100).toFixed(2)}%;width:${Math.max(0.5, (b - Math.max(a, start)) / span * 100).toFixed(2)}%"></i></span>` : '<span class="bar"></span>';
        return `<li><span>${esc(name(q.skill_id))} <b>${ROMAN[q.finished_level]}</b></span>${bar}<small>${q.finish_date ? esc(remaining(q.finish_date, now)) : 'Paused / not scheduled'}</small></li>`;
      }).join('') || '<li class="hint">Your training queue is empty. Add a skill in EVE Online.</li>'}</ol>${p.private ? '' : connectButtons(p, i)}</article>`;
  });
}
export function renderSkills() {
  $('#skills-content').innerHTML = pilotsOrEmpty((p, i) => {
    const list = p.skills?.skills;
    if (!list) return `<article class="card">${head(p, i)}<div class="empty">${p.skills ? `${Number(p.skills.total_sp).toLocaleString()} skill points. ` : ''}Connect ${esc(p.name)} to see the full skill sheet.</div>${connectButtons(p, i)}</article>`;
    const groups = new Map();
    for (const s of list) {
      const g = typeGroup.get(s.skill_id) || 'Other skills';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const maxed = list.filter(s => s.trained_skill_level === 5).length;
    return `<article class="card">${head(p, i)}<dl class="facts">${fact('Total SP', Number(p.skills.total_sp).toLocaleString())}${fact('Unallocated SP', Number(p.skills.unallocated_sp || 0).toLocaleString())}${fact('Skills trained', list.length)}${fact('At level V', maxed)}</dl>
      <label>Find a skill<input type="search" data-skill-search data-filter placeholder="Search ${esc(p.name)}’s skills"></label>
      <div class="skill-groups">${[...groups].sort(([a],[b]) => a.localeCompare(b)).map(([group, skills]) => `<details class="skill-group"><summary><b>${esc(group)}</b><span class="hint">${plural(skills.length, 'skill')} · ${skills.reduce((t, s) => t + (s.skillpoints_in_skill || 0), 0).toLocaleString()} SP</span></summary>${skills.sort((a,b) => name(a.skill_id).localeCompare(name(b.skill_id))).map(s => `<div class="skill"><span>${esc(name(s.skill_id))}</span><span class="pips" aria-label="Level ${s.trained_skill_level}">${[1,2,3,4,5].map(n => `<i class="${n <= s.active_skill_level ? 'on' : n <= s.trained_skill_level ? 'idle' : ''}"></i>`).join('')}</span><small>${s.active_skill_level < s.trained_skill_level ? `Active ${s.active_skill_level} of ${s.trained_skill_level}` : `Level ${s.trained_skill_level}`}${s.skillpoints_in_skill ? ` · ${s.skillpoints_in_skill.toLocaleString()} SP` : ''}</small></div>`).join('')}</details>`).join('')}</div></article>`;
  });
}
function cloneJump(p, clones) {
  if (!clones.last_clone_jump_date) return 'Clone jump available';
  const ready = Date.parse(clones.last_clone_jump_date) + (24 - levelOf(p.skills, INFOMORPH_SYNCHRONIZING)) * 3600000;
  return ready <= Date.now() ? 'Clone jump available' : `Next clone jump ${esc(remaining(ready).replace('remaining', 'from now'))}`;
}
export function renderClones() {
  $('#clones-content').innerHTML = pilotsOrEmpty((p, i) => `<article class="card">${head(p, i)}
    <h3>Attributes</h3>${field(p, 'attributes', a => `<dl class="attributes">${['intelligence','memory','perception','willpower','charisma'].map(k => fact(k[0].toUpperCase() + k.slice(1), a[k])).join('')}</dl><p class="hint">${a.bonus_remaps || 0} bonus remaps · ${!a.accrued_remap_cooldown_date || Date.parse(a.accrued_remap_cooldown_date) <= Date.now() ? 'yearly remap available' : `yearly remap ${esc(new Date(a.accrued_remap_cooldown_date).toLocaleDateString())}`}</p>`)}
    <h3>Active implants</h3>${field(p, 'implants', ids => ids.length ? `<ul class="plain">${ids.map(id => `<li>${esc(name(id))}</li>`).join('')}</ul>` : '<p class="hint">No implants plugged in.</p>')}
    <h3>Clones</h3>${field(p, 'clones', c => `<p>Home: <b>${esc(c.home_location ? place(c.home_location.location_id, c.home_location.location_type) : 'Unknown')}</b></p><p class="hint">${cloneJump(p, c)}</p>${(c.jump_clones || []).length ? `<ul class="plain">${c.jump_clones.map(j => `<li><b>${esc(j.name || place(j.location_id, j.location_type))}</b>${j.name ? `<small>${esc(place(j.location_id, j.location_type))}</small>` : ''}<small>${j.implants?.length ? j.implants.map(id => esc(name(id))).join(', ') : 'No implants'}</small></li>`).join('')}</ul>` : '<p class="hint">No jump clones.</p>'}`)}
    ${p.private ? '' : connectButtons(p, i)}</article>`);
}
export function wire() {
  document.addEventListener('input', event => {
    if (!event.target.matches('[data-skill-search]')) return;
    const term = event.target.value.trim().toLowerCase();
    event.target.closest('.card').querySelectorAll('.skill-group').forEach(group => {
      let shown = 0;
      group.querySelectorAll('.skill').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); shown += !row.hidden; });
      group.hidden = !shown; group.open = Boolean(term) && shown > 0;
    });
  });
}
