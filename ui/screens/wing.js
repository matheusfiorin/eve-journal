// Wing: what the two pilots are good at together tonight (Crew map) and what they're building toward (Goals).
import {localDate} from '../../model.js';
import {crewLayout, shown, ACT} from '../../capabilities.js';
import {S, reduced, ordered, summary, assetCats} from '../state.js';
import {name} from '../esi.js';
import {$, esc, format, count, portrait, toast, persist, openDrawer, closeDrawer, go} from '../shared.js';
import {crewInput} from './bridge.js';

export const markup = {
  strengths:`<h2 class="sr-only">Crew map</h2>
  <section class="tonight panel" aria-labelledby="tonight-title" id="tonight"></section>
  <div class="cm-bar-row"><div class="seg" role="radiogroup" aria-label="Crew map view"><button role="radio" aria-checked="true" data-cm-view="map">Map</button><button role="radio" aria-checked="false" data-cm-view="list">List</button></div><p class="hint" id="cm-status" role="status"></p></div>
  <div class="cm-layout" id="cm-layout" data-view="map"></div>`,
  goals:`<section class="panel goals-summary" aria-labelledby="goals-title"><h2 id="goals-title">Our goals</h2><p class="panel__sub">What the wing is building toward. Either pilot’s milestone counts for both.</p><div id="wing-summary"></div></section>
  <div class="goals-grid">
  <div class="panel panel--primary goals-main">
   <div class="panel__head"><h3>Shared goals</h3><span id="goal-count" class="hint"></span></div>
   <form id="goal-form" class="goal-form"><label class="goal-form__title">Next milestone<input name="title" required maxlength="160" placeholder="Fly our first exploration fleet"></label><div class="row"><label>Pilot<select name="pilot" class="pilot-select"></select></label><label>Focus<select name="category"><option>Exploration</option><option>Training</option><option>Ships</option><option>Industry</option><option>Combat</option><option>Other</option></select></label><label>Target date<input name="due" type="date"></label></div><div class="row"><label>Target (ISK)<input name="target" type="number" step="any" placeholder="1000000"></label><label>Result so far (ISK)<input name="result" type="number" step="any" placeholder="Fill in when you know"></label></div><label>Steps (one per line; tick them off on the goal)<textarea name="steps" rows="3" maxlength="4000" placeholder="Research the blueprint&#10;Buy materials&#10;Run the jobs&#10;Sell the output"></textarea></label><label>Notes<textarea name="notes" rows="2" maxlength="4000" placeholder="What you invested, prices, anything to remember"></textarea></label><div class="actions"><button id="goal-submit">Add goal</button><button type="button" id="cancel-goal-edit" class="secondary" hidden>Cancel edit</button></div></form>
   <div class="row toolbar-row"><label>Show<select id="goal-filter"><option value="open">In progress</option><option value="all">All goals</option><option value="done">Completed</option></select></label></div>
   <div id="goal-list"></div>
   <p class="hint">Shared goals are stored only in this browser. Export a backup from the Logbook to keep them.</p>
  </div>
  <aside class="panel milestones" aria-labelledby="ms-title"><h3 id="ms-title">Milestones</h3><ol id="milestones" class="ms-list"></ol></aside>
  </div>`
};

// ── Crew map ──
let view = 'map', active = null, crew = null;
const WHY = cap => cap.score < 25
  ? `Nobody’s set up for ${cap.label.toLowerCase()} yet. The quickest start: ${cap.next.label.replace(': train', ' trains')}.`
  : `${cap.score >= 50 ? 'You’re ready here' : 'This is coming together'} because ${list(shown(cap).slice(0, 3).map(c => c.label.replace(/^(\w+): /, '$1 has ')))}.`;
const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const strength = s => s >= 75 ? 'strong' : s >= 50 ? 'ready' : s >= 25 ? 'getting' : 'open';
const partialNote = () => {
  const hidden = crew.pilots.filter(p => !p.known || !p.holdings).map(p => p.name), shown = crew.pilots.filter(p => !hidden.includes(p.name)).map(p => p.name);
  return hidden.length ? `<p class="cm__partial">${shown.length ? `Based on ${esc(list(shown))}’s sheet${hidden.length ? ' only' : ''}. ` : ''}${esc(list(hidden))}’s ${hidden.length > 1 ? 'sheets aren’t' : 'ships and assets aren’t'} shared yet.</p>` : '';
};
const PARTS = [['skills', 'Skills'], ['ships', 'Ships'], ['materials', 'Materials'], ['wallet', 'Wallet'], ['opportunity', 'Right now']];
const partNote = (cap, k) => {
  const of = kind => cap.contributors.filter(c => c.kind === kind).map(c => c.label);
  if (k === 'skills') return of('skill').slice(0, 2).join(', ') || 'No key skills trained yet';
  if (k === 'ships') return of('ship')[0] || 'No fitting hull on hand';
  if (k === 'materials') return cap.detail.materials ? `${format(cap.detail.materials, 'isk')} on hand` : 'Nothing useful on hand';
  if (k === 'wallet') return of('wallet')[0] || '';
  return cap.detail.opportunity?.label || 'Nothing live found nearby';
};
const who = c => c.pilot === 'wing' ? `<span class="cm-dot" data-act="${c.act}" aria-hidden="true"></span>` : portrait(S.pilots.find(p => p.name.toLowerCase() === c.pilot), 22, 'portrait--xs');
function capDetails(cap, leaf) {
  const contrib = cap.contributors.map((c, i) => `<li data-pilot="${esc(c.pilot)}" ${i === leaf ? 'class="is-focus" tabindex="-1"' : ''}>${who({...c, act:cap.activity})}<span>${esc(c.label)}</span></li>`).join('');
  return `<p class="cap-why">${esc(WHY(cap))}</p>${cap.confidence === 'partial' ? partialNote() : ''}
    <dl class="cap-parts">${PARTS.filter(([k]) => cap.parts[k] !== null).map(([k, l]) => `<div><dt>${l}</dt><dd><meter min="0" max="1" value="${cap.parts[k].toFixed(2)}" aria-label="${l} ${Math.round(cap.parts[k] * 100)}%"></meter><span>${esc(partNote(cap, k))}</span></dd></div>`).join('')}</dl>
    <h3>What each of you brings</h3>${contrib ? `<ul class="cap-contrib" role="list">${contrib}</ul>` : '<p class="hint">Nothing yet. Every skill and hull you add shows up here.</p>'}
    <h3>Make it stronger</h3><p class="cap-next"><b>${esc(cap.next.label)}</b>. ${esc(cap.next.why)}</p>`;
}
function openCapability(act, leaf) {
  const cap = crew.caps.find(c => c.activity === act);
  if (!cap) return;
  active = act;
  const svg = document.querySelector('.cm__svg');
  svg?.querySelectorAll('.cm-node').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.act === act)));
  if (svg) svg.dataset.active = act;
  const d = openDrawer({title:`${cap.label} · ${cap.score} · ${cap.word}`, body:`<div class="cap" data-act="${act}">${capDetails(cap, leaf)}</div>`,
    foot:`${cap.next.go.tab !== ACT[act].tab ? `<button class="secondary" data-plan="${act}" data-plan-next>${cap.next.kind === 'skill' ? 'Open training' : 'Go there'}</button>` : ''}<button data-plan="${act}">Plan this</button>`});
  d.querySelector('.is-focus')?.scrollIntoView({block:'nearest'});
}
// Plan this: open the activity's view and apply the next step's filters, so the view re-renders with them.
function plan(act, useNext) {
  const cap = crew?.caps.find(c => c.activity === act);
  const target = useNext && cap ? cap.next.go : {tab:ACT[act].tab, ...(cap?.next.go.tab === ACT[act].tab ? {set:cap.next.go.set} : {})};
  closeDrawer(); go(target.tab);
  for (const [sel, value] of Object.entries(target.set || {})) { const el = $(sel); if (el) { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); } }
}

const tspans = l => l.lines.map((t, i) => `<tspan x="${l.dx}" dy="${i ? 14 : l.dy - (l.anchor !== 'middle' && l.lines.length > 1 ? 7 : 0)}">${esc(t)}</tspan>`).join('');
function mapSvg(layout) {
  const {core, sats, branches} = layout, ps = crew.pilots;
  const edges = branches.map((b, i) => `<path class="cm-edge" data-act="${b.activity}" d="${b.edge.d}" style="--i:${i};stroke-width:${b.edge.width};opacity:${b.edge.opacity}"/>`
    + b.links.map(l => `<path class="cm-link" data-act="${b.activity}" data-pilot="${l.pilot}" d="${l.d}" style="stroke-width:${l.width}"/>`).join('')
    + b.leaves.map(l => `<line class="cm-twig" data-act="${b.activity}" x1="${b.x}" y1="${b.y}" x2="${l.x}" y2="${l.y}"/>`).join('')).join('');
  const satellites = sats.map(s => { const p = ps.find(x => x.key === s.key); return p ? `<g class="cm-sat" data-pilot="${s.key}"><clipPath id="cm-clip-${s.key}"><circle cx="${s.x}" cy="${s.y}" r="${s.r - 2}"/></clipPath><circle class="cm-sat__ring" cx="${s.x}" cy="${s.y}" r="${s.r}"/>${p.id ? `<image href="https://images.evetech.net/characters/${p.id}/portrait?size=64" x="${s.x - s.r}" y="${s.y - s.r}" width="${s.r * 2}" height="${s.r * 2}" clip-path="url(#cm-clip-${s.key})"/>` : `<text x="${s.x}" y="${s.y + 5}">${esc(p.name[0])}</text>`}<text class="cm-sat__name" x="${s.x}" y="${s.y + s.r + 16}">${esc(p.name)}</text></g>` : ''; }).join('');
  const nodes = branches.map((b, i) => `<g class="cm-node" data-act="${b.activity}" data-strength="${strength(b.cap.score)}" tabindex="${i ? -1 : 0}" role="button" aria-pressed="${active === b.activity}"
      aria-label="${esc(`${b.cap.label}, readiness ${b.cap.score}, ${b.cap.word}. ${b.cap.contributors.length} contributors. Press Enter for details.`)}" transform="translate(${b.x} ${b.y})">
      <g class="cm-node__body" style="--i:${i}"><circle class="cm-node__halo" r="${b.r + 6}"/><circle class="cm-node__disc" r="${b.r}"/><text class="cm-node__score num" dy="6">${b.cap.score}</text>
      <text class="cm-node__label" dy="${b.r + 18}">${esc(b.cap.label)}</text><text class="cm-node__word" dy="${b.r + 32}">${esc(b.cap.word)}</text></g></g>`).join('');
  const leaves = branches.flatMap(b => b.leaves.map(l => `<g class="cm-leaf" data-act="${b.activity}" data-key="${b.cap.contributors.indexOf(l.contributor)}" ${l.contributor.pilot === 'wing' ? '' : `data-pilot="${l.contributor.pilot}"`} tabindex="-1" role="button"
      aria-label="${esc(`${l.contributor.label}. Part of ${b.cap.label}.`)}" transform="translate(${l.x} ${l.y})" style="--i:${l.index}"><circle r="5"/><text text-anchor="${l.anchor}">${tspans(l)}</text></g>`)).join('');
  return `<svg id="cm-svg" class="cm__svg" viewBox="-60 -14 1120 668" role="group" aria-label="Wing readiness by activity. Use arrow keys to move between activities, down for what makes each one strong, Enter for details.">
    <defs><filter id="cm-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="cm-field"><stop offset="0" stop-color="var(--accent)" stop-opacity=".10"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
    <g class="cm__rings" aria-hidden="true"><circle cx="${core.x}" cy="${core.y}" r="300" fill="url(#cm-field)"/><circle class="cm-orbit" cx="${core.x}" cy="${core.y}" r="192"/><circle class="cm-orbit cm-orbit--outer" cx="${core.x}" cy="${core.y}" r="294.4"/></g>
    <g class="cm__edges" aria-hidden="true">${edges}</g>
    <g class="cm__core" aria-hidden="true"><circle class="cm-core" cx="${core.x}" cy="${core.y}" r="${core.r}"/><use href="#i-emblem" x="${core.x - 20}" y="${core.y - 20}" width="40" height="40"/>${satellites}</g>
    <g class="cm__branches">${nodes}</g><g class="cm__leaves">${leaves}</g></svg>`;
}
function listView() {
  return `<div class="cm-list" role="list">${crew.caps.map((cap, i) => `<details class="cm-branch" data-act="${cap.activity}" role="listitem" ${i ? '' : 'open'}>
    <summary><span class="cm-dot" aria-hidden="true"></span><b>${cap.label}</b><span class="cm-bar" style="--v:${cap.score}" aria-hidden="true"><i></i></span><span class="num">${cap.score}</span><small>${cap.word}</small></summary>
    ${capDetails(cap)}<button class="small" data-plan="${cap.activity}">Plan this</button></details>`).join('')}</div>`;
}
function tonight() {
  const top = crew.caps.slice(0, 3), p = crew.plan;
  const reason = cap => shown(cap).slice(0, 2).map(c => c.label).join(' · ') || cap.next.label;
  return `<h2 id="tonight-title">Tonight we’re best at</h2>
    <ol class="tonight__top">${top.map(cap => `<li class="tonight__act" data-act="${cap.activity}"><span class="tonight__name">${cap.label}</span><span class="num tonight__score">${cap.score}</span><span class="tonight__word">${cap.word}</span><p>${esc(reason(cap))}</p></li>`).join('')}</ol>
    ${p ? `<div class="tonight__plan"><p><b>Group plan:</b> ${esc(p.sentence)}</p>
      <ul class="tonight__roles" role="list">${crew.pilots.map(x => p.roles[x.key] ? `<li class="role-badge" data-pilot="${esc(x.key)}">${esc(x.name)} · ${esc(p.roles[x.key].join(', '))}</li>` : '').join('')}</ul>
      <button data-plan-session>Plan this session</button></div>` : ''}`;
}
export function renderCrew() {
  const host = $('#cm-layout');
  crew = crewInput(() => { if (!$('#strengths').hidden) renderCrew(); });
  if (!crew.pilots.length || crew.pilots.every(p => !p.known)) {
    $('#tonight').hidden = true;
    host.innerHTML = `<div class="state"><p>Connect a pilot to map what the wing can do. Skills, ships and assets fill the map in.</p>${S.backend ? '<button data-go="bridge">Connect on the Bridge</button>' : ''}</div>`;
    $('#cm-status').textContent = '';
    return;
  }
  $('#tonight').hidden = false; $('#tonight').innerHTML = tonight();
  const live = Object.values(crew.opportunities).some(v => v && typeof v === 'object');
  $('#cm-status').textContent = live ? `Readiness from live market data, ${S.marketData?.meta?.updatedAt ? `${Math.max(1, Math.round((Date.now() - S.marketData.meta.updatedAt) / 60000))} min old` : 'just loaded'}` : 'Readiness from skills, ships and wallets; live picks load with the market.';
  host.dataset.view = view;
  host.innerHTML = `<figure class="panel panel--primary cm" aria-labelledby="cm-cap">${mapSvg(crewLayout(crew.caps))}
    <figcaption id="cm-cap" class="cm__legend">Bigger, brighter nodes are where the wing is readiest tonight. <span class="who" data-pilot="fiofka">Gold</span> and <span class="who" data-pilot="decxus">teal</span> links show who adds to each activity.${partialNote() ? ` ${partialNote().replace(/<\/?p[^>]*>/g, '')}` : ''}</figcaption></figure>${listView()}`;
  const svg = document.querySelector('.cm__svg');
  if (active) svg.dataset.active = active;
  // The entry moment plays once a session.
  let seen = true;
  try { seen = sessionStorage.getItem('eve.cm.seen'); sessionStorage.setItem('eve.cm.seen', '1'); } catch { /* Plays each visit. */ }
  if (!seen && !reduced && !$('#strengths').hidden) {
    svg.querySelectorAll('.cm-edge').forEach(e => e.style.setProperty('--len', e.getTotalLength()));
    svg.classList.add('cm--enter');
  }
}
function wireMap() {
  const host = $('#cm-layout');
  host.addEventListener('keydown', e => {
    const svg = e.target.closest('#cm-svg');
    if (!svg) return;
    const nodes = [...svg.querySelectorAll('.cm-node')], node = e.target.closest('.cm-node'), leaf = e.target.closest('.cm-leaf'), i = nodes.indexOf(node);
    const focus = el => { nodes.forEach(n => n.tabIndex = -1); svg.querySelectorAll('.cm-leaf').forEach(l => l.tabIndex = -1); el.tabIndex = 0; el.focus(); svg.dataset.active = el.dataset.act; };
    const leaves = act => [...svg.querySelectorAll(`.cm-leaf[data-act="${act}"]`)];
    const k = e.key, n = nodes.length;
    if (node && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); focus(nodes[(i + (k === 'ArrowRight' ? 1 : -1) + n) % n]); }
    else if (node && (k === 'Home' || k === 'End')) { e.preventDefault(); focus(nodes[k === 'Home' ? 0 : n - 1]); }
    else if (node && k === 'ArrowDown') { const l = leaves(node.dataset.act)[0]; if (l) { e.preventDefault(); focus(l); } }
    else if (leaf && (k === 'ArrowDown' || k === 'ArrowRight' || k === 'ArrowLeft')) {
      e.preventDefault(); const ls = leaves(leaf.dataset.act), j = ls.indexOf(leaf); focus(ls[(j + (k === 'ArrowLeft' ? -1 : 1) + ls.length) % ls.length]);
    } else if (leaf && k === 'ArrowUp') { e.preventDefault(); focus(svg.querySelector(`.cm-node[data-act="${leaf.dataset.act}"]`)); }
    else if ((k === 'Enter' || k === ' ') && (node || leaf)) { e.preventDefault(); openCapability((node || leaf).dataset.act, leaf ? Number(leaf.dataset.key) : undefined); }
  });
  host.addEventListener('click', e => {
    const el = e.target.closest('.cm-node,.cm-leaf');
    if (el) openCapability(el.dataset.act, el.classList.contains('cm-leaf') ? Number(el.dataset.key) : undefined);
  });
  const hover = e => { const el = e.target.closest?.('.cm-node,.cm-leaf'), svg = document.querySelector('.cm__svg'); if (svg && el) svg.dataset.active = el.dataset.act; };
  const leave = e => { const svg = document.querySelector('.cm__svg'); if (svg && !e.relatedTarget?.closest?.('.cm-node,.cm-leaf') && !$('#drawer').open) { if (active) svg.dataset.active = active; else delete svg.dataset.active; } };
  host.addEventListener('mouseover', hover); host.addEventListener('focusin', hover);
  host.addEventListener('mouseout', leave); host.addEventListener('focusout', leave);
  $('#drawer').addEventListener('close', () => {
    if (!active) return;
    active = null; const svg = document.querySelector('.cm__svg');
    if (svg) { delete svg.dataset.active; svg.querySelectorAll('.cm-node').forEach(n => n.setAttribute('aria-pressed', 'false')); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-plan],[data-plan-session],[data-cm-view]');
    if (!b) return;
    if (b.dataset.cmView) {
      view = b.dataset.cmView; $('#cm-layout').dataset.view = view;
      document.querySelectorAll('[data-cm-view]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      return;
    }
    if (b.dataset.plan) return plan(b.dataset.plan, b.hasAttribute('data-plan-next'));
    // Plan this session: open my own assignment.
    const mineKey = S.me?.toLowerCase(), act = crew?.plan?.assign[mineKey] || crew?.caps[0]?.activity;
    if (act) plan(act);
  });
}

// ── Goals & milestones ──
// Combine before you split: wing totals first, each pilot only as a contribution, behind details.
const SP_MARKS = [100e6, 50e6, 20e6, 10e6, 5e6, 2e6, 1e6, 5e5], WORTH_MARKS = [1e9, 500e6, 250e6, 100e6, 75e6, 50e6, 25e6, 10e6];
function milestones(ps, sums, worth) {
  const out = [];
  const wingMark = WORTH_MARKS.find(m => worth >= m);
  if (wingMark) out.push({who:'wing', text:`The wing passed ${format(wingMark, 'isk')}.`});
  ps.forEach((p, i) => {
    const s = sums[i], mark = SP_MARKS.find(m => s.sp >= m);
    if (mark) out.push({who:p.name.toLowerCase(), p, text:`${p.name} reached ${format(mark, 'isk').replace(' ISK', '')} skill points.`});
    for (const sk of (s.skills?.skills || []).filter(x => x.trained_skill_level === 5).slice(0, 3)) out.push({who:p.name.toLowerCase(), p, text:`${p.name} trained ${name(sk.skill_id)} V.`});
  });
  for (const g of S.data.goals.filter(g => g.done).slice(-4).reverse()) out.push({who:'wing', text:`Goal done: ${g.title}.`});
  return out;
}
function renderSummary() {
  const ps = ordered(), sums = ps.map(summary);
  const sum = values => values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const total = sum(sums.map(x => x.worth)), done = S.data.goals.filter(g => g.done).length;
  const top = sums.flatMap((x, i) => (x.holdings?.rows || []).slice(0, 10).map(r => ({...r, owner:ps[i]}))).sort((a, b) => b.value - a.value).slice(0, 10);
  const groups = new Map();
  for (const r of top) { const c = assetCats.get(r.type) || 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(r); }
  const missing = ps.filter((p, i) => sums[i].worth === undefined).map(p => p.name);
  $('#wing-summary').innerHTML = `<dl class="readout">
      <div><dt>Combined net worth</dt><dd class="wing-total">${count('wing-total', total, 'isk')}</dd></div>
      <div><dt>Combined skill points</dt><dd>${count('wing-sp-total', sum(sums.map(x => x.sp)))}</dd></div>
      <div><dt>Goals done</dt><dd><span class="num">${done}</span><small>of ${S.data.goals.length}</small></dd></div></dl>
    ${missing.length ? `<p class="hint">Not counted yet: ${missing.map(esc).join(', ')}. Wallet and assets appear after connecting with the asset permission${missing.some(n => n !== S.me) ? ' and wingmate sharing' : ''}.</p>` : ''}
    <details class="own"><summary>What we own</summary>${top.length ? [...groups].map(([c, rows]) => `<h4>${esc(c)}</h4><ul class="holdings">${rows.map(r => `<li data-pilot="${esc(r.owner.name.toLowerCase())}">${portrait(r.owner, 24, 'portrait--xs')}<span>${esc(name(r.type))}<small>×${Number(r.quantity).toLocaleString()} · ${esc(r.owner.name)}</small></span><b>${format(r.value, 'isk')}</b></li>`).join('')}</ul>`).join('') : '<p class="hint">Nothing valued yet.</p>'}
      <ul class="plain">${ps.map((p, i) => `<li data-pilot="${esc(p.name.toLowerCase())}"><b>${esc(p.name)}</b> <span class="role-badge">${esc(sums[i].title || 'Unranked')}</span><small>adds ${format(sums[i].worth, 'isk')} and ${format(sums[i].sp)} skill points</small></li>`).join('')}</ul></details>`;
  const ms = milestones(ps, sums, total);
  $('#milestones').innerHTML = ms.length ? ms.map(m => `<li data-pilot="${esc(m.who)}">${m.p ? portrait(m.p, 22, 'portrait--xs') : '<svg class="ms-emblem" viewBox="0 0 32 32" aria-hidden="true"><use href="#i-emblem"/></svg>'}<span>${esc(m.text)}</span></li>`).join('')
    : '<li class="hint">No milestones yet. The first one lands when either of you finishes a skill.</li>';
}

let editingGoal = null;
// A goal's target against its result, its steps as a checklist, and its notes.
function goalDetails(g) {
  const doneSteps = (g.steps || []).filter(st => st.done).length;
  const target = Number.isFinite(g.target) ? `<div class="goal-target"><span class="stack"><i class="fill" style="width:${Number.isFinite(g.result) && g.target > 0 ? Math.max(0, Math.min(100, g.result / g.target * 100)).toFixed(1) : 0}%"></i></span><small>${Number.isFinite(g.result) ? `${format(g.result, 'isk')} of ${format(g.target, 'isk')}${g.result >= g.target ? ' · <span class="pos">target reached</span>' : ''}` : `Target ${format(g.target, 'isk')} · no result yet`}</small></div>` : '';
  const steps = g.steps?.length ? `<ol class="goal-steps" aria-label="Steps, ${doneSteps} of ${g.steps.length} done">${g.steps.map((st, i) => `<li><label><input type="checkbox" data-goal-step="${esc(g.id)}:${i}" ${st.done ? 'checked' : ''}>${esc(st.text)}</label></li>`).join('')}</ol>` : '';
  return `${target}${steps}${g.notes ? `<p class="goal-notes">${esc(g.notes)}</p>` : ''}`;
}
const owner = g => S.pilots.some(p => p.name === g.pilot) ? g.pilot.toLowerCase() : 'wing';
export function renderGoals() {
  renderSummary();
  const data = S.data, done = data.goals.filter(g => g.done).length, filter = $('#goal-filter').value;
  const goals = data.goals.filter(g => filter === 'all' || (filter === 'done' ? g.done : !g.done));
  $('#goal-count').textContent = `${done} of ${data.goals.length} goals complete`;
  $('#goal-list').innerHTML = goals.length ? goals.map(g => `<article class="goal ${g.done ? 'done' : ''}" data-pilot="${esc(owner(g))}"><div><label><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? 'checked' : ''}>${esc(g.title)}</label><small>${owner(g) === 'wing' ? 'For the wing' : `${esc(g.pilot)}’s, for the wing`} · ${esc(g.category || 'Other')}${g.due ? ` · <span class="${!g.done && g.due < localDate() ? 'error' : ''}">Target ${esc(g.due)}</span>` : ''}</small>${goalDetails(g)}</div><div class="actions"><button data-edit-goal="${esc(g.id)}" class="secondary small">Edit</button><button data-delete-goal="${esc(g.id)}" class="secondary small" aria-label="Delete ${esc(g.title)}">Delete</button></div></article>`).join('')
    : `<div class="empty">${data.goals.length ? 'No goals in this view.' : 'No shared goals yet. Add one you both want, like “Fly our first exploration fleet”.'}</div>`;
}
function resetGoal() {
  editingGoal = null; $('#goal-form').reset(); $('#goal-submit').textContent = 'Add goal'; $('#cancel-goal-edit').hidden = true;
}
export function wire() {
  wireMap();
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
    const goal = S.data.goals.find(g => g.id === event.target.dataset.goal);
    if (!persist({...S.data, goals:S.data.goals.map(g => g.id === event.target.dataset.goal ? {...g, done:event.target.checked} : g)})) event.target.checked = !event.target.checked;
    else if (event.target.checked && goal) toast(`Goal done: ${goal.title}. Nice flying, both of you.`, 'ok');
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
      $('#goal-submit').textContent = 'Save changes'; $('#cancel-goal-edit').hidden = false; f.scrollIntoView({behavior:reduced ? 'auto' : 'smooth'}); f.elements.title.focus();
    }
    if (b?.dataset.deleteGoal && confirm('Delete this local goal?')) {
      if (persist({...S.data, goals:S.data.goals.filter(g => g.id !== b.dataset.deleteGoal)}) && editingGoal === b.dataset.deleteGoal) resetGoal();
    }
  });
}

