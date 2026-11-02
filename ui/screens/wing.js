// Wing: what the two pilots have together (Crew map) and the goals they share.
import {pilotRoles, localDate} from '../../model.js';
import {S, ordered, summary, assetCats, typeGroup} from '../state.js';
import {name} from '../esi.js';
import {$, esc, format, count, portrait, toast, persist} from '../shared.js';

export const markup = {
  strengths:'<div id="crew-content"></div>',
  goals:`<p class="hint">Shared goals are stored only in this browser. Export a backup from the Logbook to keep them.</p>
  <div class="card panel--primary">
   <h2>Shared goals</h2>
   <form id="goal-form"><label>Next milestone<input name="title" required maxlength="160" placeholder="Fly our first exploration fleet"></label><div class="row"><label>Pilot<select name="pilot" class="pilot-select"></select></label><label>Focus<select name="category"><option>Exploration</option><option>Training</option><option>Ships</option><option>Industry</option><option>Combat</option><option>Other</option></select></label><label>Target date<input name="due" type="date"></label></div><div class="row"><label>Target (ISK)<input name="target" type="number" step="any" placeholder="1000000"></label><label>Result so far (ISK)<input name="result" type="number" step="any" placeholder="Fill in when you know"></label></div><label>Steps (one per line; tick them off on the goal)<textarea name="steps" rows="3" maxlength="4000" placeholder="Research the blueprint&#10;Buy materials&#10;Run the jobs&#10;Sell the output"></textarea></label><label>Notes<textarea name="notes" rows="3" maxlength="4000" placeholder="What you invested, prices, anything to remember"></textarea></label><div class="actions"><button id="goal-submit">Add goal</button><button type="button" id="cancel-goal-edit" class="secondary" hidden>Cancel edit</button></div></form>
   <div class="row toolbar-row"><label>Show<select id="goal-filter"><option value="open">In progress</option><option value="all">All goals</option><option value="done">Completed</option></select></label><span id="goal-count" class="hint"></span></div>
   <div id="goal-list"></div>
  </div>`
};

// Combine before you split: one wing figure first, each pilot's part only as a contribution in details.
export function renderCrew() {
  const ps = ordered(), sums = ps.map(summary);
  if (!ps.length) { $('#crew-content').innerHTML = '<div class="empty">No pilots configured.</div>'; return; }
  const sum = list => list.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const total = sum(sums.map(x => x.worth));
  const cats = new Map();
  sums.forEach(x => (x.holdings?.rows || []).slice(0, 60).forEach(r => { const c = assetCats.get(r.type) || 'Other'; cats.set(c, (cats.get(c) || 0) + r.value); }));
  const catRows = [...cats].filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8), maxCat = catRows[0]?.[1] || 1;
  // What we own: the top holdings, grouped by category, each with its owner's portrait.
  const top = sums.flatMap((x, i) => (x.holdings?.rows || []).slice(0, 10).map(r => ({...r, owner:ps[i]}))).sort((a, b) => b.value - a.value).slice(0, 10);
  const groups = new Map();
  for (const r of top) { const c = assetCats.get(r.type) || 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(r); }
  const missing = ps.filter((p, i) => sums[i].worth === undefined).map(p => p.name);
  $('#crew-content').innerHTML = `
  <section class="card panel--primary wing-hero">
    <div><h2>Wing net worth</h2><p class="wing-total">${count('wing-total', total, 'isk')}</p><p class="hint">Wallets plus assets valued at average market prices.</p>
    ${missing.length ? `<p class="hint">Not counted yet: ${missing.map(esc).join(', ')}. Wallet and assets appear after connecting with the asset permission${missing.some(n => n !== S.me) ? ' and wingmate sharing' : ''}.</p>` : ''}
    <details><summary>What each of you adds</summary><ul class="plain">${ps.map((p, i) => `<li data-pilot="${esc(p.name.toLowerCase())}"><b>${esc(p.name)}</b><small>${format(sums[i].worth, 'isk')} · ${format(sums[i].sp)} skill points</small></li>`).join('')}</ul></details></div>
    <dl class="readout">${[['Wing skill points', sum(sums.map(x => x.sp))], ['Skills at V', sum(sums.map(x => x.maxed))]].map(([l, v]) => `<div><dt>${l}</dt><dd>${count(`wing-${l}`, v)}</dd></div>`).join('')}</dl>
  </section>
  <div class="grid">
    <article class="card"><h3>Holdings by category</h3>${catRows.length ? catRows.map(([c, v]) => `<div class="share-row"><span>${esc(c)}</span><span class="stack"><i class="fill" style="width:${(v / maxCat * 100).toFixed(1)}%"></i></span><b>${format(v, 'isk')}</b></div>`).join('') : '<p class="hint">No valued assets yet.</p>'}</article>
    <article class="card"><h3>What we own</h3>${top.length ? [...groups].map(([c, rows]) => `<h4>${esc(c)}</h4><ul class="holdings">${rows.map(r => `<li data-pilot="${esc(r.owner.name.toLowerCase())}">${portrait(r.owner, 24, 'portrait--xs')}<span>${esc(name(r.type))}<small>×${Number(r.quantity).toLocaleString()} · ${esc(r.owner.name)}</small></span><b>${format(r.value, 'isk')}</b></li>`).join('')}</ul>`).join('') : '<p class="hint">Nothing valued yet.</p>'}</article>
  </div>
  <div class="grid">${ps.map((p, i) => {
    const roles = sums[i].skills?.skills ? pilotRoles(sums[i].skills, id => typeGroup.get(id)).filter(r => r.sp > 0) : [];
    return `<article class="card title-card" data-pilot="${esc(p.name.toLowerCase())}"><div class="pilot-head">${portrait(p, 56)}<div><h2>${esc(p.name)}</h2><span class="role-badge">${esc(sums[i].title || 'Unranked')}</span></div></div>${roles.length ? `<details><summary>How ${esc(p.name)}’s skill points are spread</summary>${roles.map(r => `<div class="share-row"><span>${esc(r.label)}</span><span class="stack"><i class="fill" style="width:${(r.share * 100).toFixed(1)}%"></i></span><b>${Math.round(r.share * 100)}%</b></div>`).join('')}</details>` : `<p class="hint">${esc(p.name)}’s skill sheet is private${p.name !== S.me ? ' until they share it with you' : ' until you connect'}.</p>`}</article>`;
  }).join('')}</div>`;
}

let editingGoal = null;
// A goal's target against its result, its steps as a checklist, and its notes.
function goalDetails(g) {
  const doneSteps = (g.steps || []).filter(st => st.done).length;
  const target = Number.isFinite(g.target) ? `<div class="goal-target"><span class="stack"><i class="fill" style="width:${Number.isFinite(g.result) && g.target > 0 ? Math.max(0, Math.min(100, g.result / g.target * 100)).toFixed(1) : 0}%"></i></span><small>${Number.isFinite(g.result) ? `${format(g.result, 'isk')} of ${format(g.target, 'isk')}${g.result >= g.target ? ' · <span class="pos">target reached</span>' : ''}` : `Target ${format(g.target, 'isk')} · no result yet`}</small></div>` : '';
  const steps = g.steps?.length ? `<ol class="goal-steps" aria-label="Steps, ${doneSteps} of ${g.steps.length} done">${g.steps.map((st, i) => `<li><label><input type="checkbox" data-goal-step="${esc(g.id)}:${i}" ${st.done ? 'checked' : ''}>${esc(st.text)}</label></li>`).join('')}</ol>` : '';
  return `${target}${steps}${g.notes ? `<p class="goal-notes">${esc(g.notes)}</p>` : ''}`;
}
export function renderGoals() {
  const data = S.data, done = data.goals.filter(g => g.done).length, filter = $('#goal-filter').value;
  const goals = data.goals.filter(g => filter === 'all' || (filter === 'done' ? g.done : !g.done));
  $('#goal-count').textContent = `${done} of ${data.goals.length} goals complete`;
  $('#goal-list').innerHTML = goals.length ? goals.map(g => `<article class="goal ${g.done ? 'done' : ''}"><div><label><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? 'checked' : ''}>${esc(g.title)}</label><small>${esc(g.pilot)} · ${esc(g.category || 'Other')}${g.due ? ` · <span class="${!g.done && g.due < localDate() ? 'error' : ''}">Target ${esc(g.due)}</span>` : ''}</small>${goalDetails(g)}</div><div class="actions"><button data-edit-goal="${esc(g.id)}" class="secondary small">Edit</button><button data-delete-goal="${esc(g.id)}" class="secondary small" aria-label="Delete ${esc(g.title)}">Delete</button></div></article>`).join('')
    : `<div class="empty">${data.goals.length ? 'No goals in this view.' : 'No shared goals yet. Add one you both want, like “Fly our first exploration fleet”.'}</div>`;
}
function resetGoal() {
  editingGoal = null; $('#goal-form').reset(); $('#goal-submit').textContent = 'Add goal'; $('#cancel-goal-edit').hidden = true;
}
export function wire() {
  if (S.store.locked) document.querySelectorAll('#goal-form button').forEach(b => b.disabled = true);
  document.addEventListener('data-change', renderGoals);
  $('#goal-form').onsubmit = event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.target));
    if (!fields.title.trim()) return;
    const prior = S.data.goals.find(g => g.id === editingGoal), number = v => v === '' || v === undefined ? undefined : Number(v);
    // Steps keep their ticks when the goal is edited and the line text is unchanged.
    const steps = fields.steps.split('\n').map(t => t.trim()).filter(Boolean).slice(0, 30).map(text => ({text:text.slice(0, 160), done:prior?.steps?.find(st => st.text === text.slice(0, 160))?.done || false}));
    const goal = {...fields, title:fields.title.trim(), notes:fields.notes.trim(), target:number(fields.target), result:number(fields.result), steps, id:editingGoal || crypto.randomUUID(), done:prior?.done || false};
    if (persist({...S.data, goals:editingGoal ? S.data.goals.map(g => g.id === editingGoal ? goal : g) : [...S.data.goals, goal]})) { resetGoal(); toast('Goal saved in this browser.', 'ok'); }
  };
  $('#cancel-goal-edit').onclick = resetGoal;
  $('#goal-filter').onchange = renderGoals;
  document.addEventListener('change', event => {
    if (event.target.matches('[data-goal-step]')) {
      const [id, i] = event.target.dataset.goalStep.split(':');
      if (!persist({...S.data, goals:S.data.goals.map(g => g.id === id ? {...g, steps:g.steps.map((st, n) => n === Number(i) ? {...st, done:event.target.checked} : st)} : g)})) event.target.checked = !event.target.checked;
      return;
    }
    if (!event.target.matches('[data-goal]')) return;
    if (!persist({...S.data, goals:S.data.goals.map(g => g.id === event.target.dataset.goal ? {...g, done:event.target.checked} : g)})) event.target.checked = !event.target.checked;
  });
  document.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (b?.dataset.editGoal) {
      const g = S.data.goals.find(g => g.id === b.dataset.editGoal); if (!g) return;
      editingGoal = g.id;
      const f = $('#goal-form');
      if (g.category && ![...f.elements.category.options].some(o => o.value === g.category)) f.elements.category.add(new Option(g.category, g.category));
      for (const key of ['title','pilot','due','category','notes']) f.elements[key].value = g[key] || (key === 'category' ? 'Other' : '');
      f.elements.target.value = g.target ?? ''; f.elements.result.value = g.result ?? ''; f.elements.steps.value = (g.steps || []).map(st => st.text).join('\n');
      $('#goal-submit').textContent = 'Save changes'; $('#cancel-goal-edit').hidden = false; f.scrollIntoView({behavior:'smooth'}); f.elements.title.focus();
    }
    if (b?.dataset.deleteGoal && confirm('Delete this local goal?')) {
      if (persist({...S.data, goals:S.data.goals.filter(g => g.id !== b.dataset.deleteGoal)}) && editingGoal === b.dataset.deleteGoal) resetGoal();
    }
  });
}
