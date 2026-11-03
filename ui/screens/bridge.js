// Bridge (home): what to do now. Alerts and the pilot line, "Next up" ranked from the planning modules, and the wing together.
// Also owns the live inputs the Crew map scores (crewInput), so both screens read one cached computation.
import {levelOf, queueState, remaining} from '../../model.js';
import {fees, hauls, stationTrades} from '../../market.js';
import {skillLevels, isAlpha, evaluate, rank} from '../../industry.js';
import {SHIPS, yieldRate, holdOf, canFly, oreValue, sites} from '../../mining.js';
import {rankSystems} from '../../exploration.js';
import {capabilities, groupPlan, ACT} from '../../capabilities.js';
import {S, mine, wingmate, ordered, summary, assetCats} from '../state.js';
import {name} from '../esi.js';
import {loadMarket} from '../marketdata.js';
import {$, esc, isk, when, count, fact, format, plural, portrait, corpLine, connectButtons, trainingAlert} from '../shared.js';
import {mapGraph, route} from '../routes.js';

export const markup = {bridge:'<div id="pilots"></div>'};
const keyOf = p => p.name.toLowerCase();

// ── Live opportunities near the chosen pilot (market snapshot + pure modules), cached per data state. ──
let opps = {key:null, value:{}}, loading = null, failed = -1;
const waiting = new Set();
const oppKey = () => { const p = mine(), x = summary(p); return [S.marketData ? 1 : 0, S.costIndices ? 1 : 0, S.me, p?.private, x.wallet, p?.ops?.location?.value?.solar_system_id, p?.ops?.ship?.value?.ship_type_id, x.skills?.total_sp].join('|'); };
const safely = fn => { try { return fn() || null; } catch { return null; } };
function compute() {
  const g = mapGraph(), meta = S.marketData?.meta?.data, book = S.marketBook, p = mine();
  if (!g || !meta || !book || !p) return {};
  const x = summary(p), level = id => levelOf(x.skills, id), f = fees(x.skills, meta.skills);
  const here = p.ops?.location?.value?.solar_system_id || S.wing.get(p.id)?.location?.solar_system_id;
  const from = g.systems.has(here) ? here : 30000142, start = g.systems.get(from)?.name || 'Jita';
  const budget = x.wallet ?? Infinity, sysOf = loc => book.stations.get(loc)?.system, item = id => meta.types?.[id]?.n || name(id);
  return {from, start,
    mining:safely(() => {
      const now = p.ops?.ship?.value?.ship_type_id;
      const ship = SHIPS[now] ? now : Object.keys(SHIPS).map(Number).filter(id => canFly(id, level)).sort((a, b) => yieldRate(b, level) - yieldRate(a, level))[0] || 32880;
      const values = new Map((meta.ores || []).map(o => [o.n, oreValue(o, book, {salesTax:f.salesTax, level})]));
      const best = sites(g, from, {values, rate:yieldRate(ship, level), hold:holdOf(ship, level), activity:meta.activity || {}, limit:1})[0];
      return best && {iskHour:best.iskHour, ship:SHIPS[ship].name, flyable:canFly(ship, level), system:best.system.name, jumps:best.jumps, kills:best.kills, ore:best.ores[0].n,
        label:`${format(best.iskHour, 'isk')}/h at ${best.system.name}${best.jumps ? `, ${plural(best.jumps, 'jump')}` : ''}`, plan:`${best.ores[0].n} at ${best.system.name}`};
    }),
    industry:safely(() => {
      const levels = skillLevels(x.skills, meta.skills || {}), idx = S.costIndices?.get(from) || {}, skillOf = x.skills?.skills ? level : undefined;
      const list = (meta.starters || []).map(s => evaluate(s, {book, adjusted:S.adjusted, fees:f, index:idx.manufacturing || 0, researchIndex:idx.researching_material_efficiency || 0, levels, alpha:isAlpha(x.skills), skillOf, budget:x.wallet}));
      const best = rank(list, x.wallet).find(r => r.affordable && !r.flags.includes('skills'));
      return best && {profitDay:best.profitDay, payback:best.payback, invest:best.invest, name:best.n, label:`+${format(best.profitDay, 'isk')}/day from ${best.n}`, plan:`a ${best.n} run`};
    }),
    exploration:safely(() => {
      const risk = meta.risk?.s || {}, act = meta.activity || {};
      const list = rankSystems(g, from, {traffic:meta.traffic?.s || {}, kills:Object.fromEntries(Object.entries(risk).map(([id, v]) => [id, v[0]])),
        hour:{jumps:Object.fromEntries(Object.entries(act).map(([id, a]) => [id, a[2]])), kills:Object.fromEntries(Object.entries(act).map(([id, a]) => [id, a[0]]))}, limit:10}).filter(r => r.system.id !== from);
      const quiet = list.filter(r => !r.kills).length, best = list[0];
      return best && {quiet, best:best.system.name, jumps:best.jumps, label:`${plural(quiet, 'quiet system')} within 10 jumps of ${start}`, plan:`a quiet loop from ${start}`};
    }),
    hauling:safely(() => {
      const list = hauls(book, {salesTax:f.salesTax, cargo:5000, volumeOf:id => meta.types?.[id]?.v, budget, limit:20}).map(h => {
        const a = route(from, sysOf(h.from.loc)), b = route(sysOf(h.from.loc), sysOf(h.to.loc));
        return a && b ? {...h, jumps:a.jumps + b.jumps, perJump:h.profit / Math.max(1, a.jumps + b.jumps), to:g.systems.get(sysOf(h.to.loc))?.name} : null;
      }).filter(Boolean).sort((a, b) => b.perJump - a.perJump);
      const best = list[0];
      return best && {perJump:best.perJump, profit:best.profit, label:`${format(best.profit, 'isk')} hauling ${item(best.type)} to ${best.to}`, plan:`${item(best.type)} to ${best.to}`};
    }),
    trade:safely(() => {
      const best = stationTrades(book, {...f, budget, limit:10}).filter(t => route(from, sysOf(t.loc))?.jumps <= 10).sort((a, b) => b.daily - a.daily)[0];
      return best && {daily:best.daily, label:`${(best.margin * 100).toFixed(1)}% spread on ${item(best.type)}, ~${format(best.daily, 'isk')}/day`, plan:`${item(best.type)} spreads`};
    })};
}
/** Opportunities now (or {} while the market loads); onReady re-renders when the snapshot arrives. */
export function opportunities(onReady) {
  if (!S.backend || !mine()) return {};
  if (!S.marketData || !S.costIndices) {
    if (onReady) waiting.add(onReady);
    if (!loading && failed !== S.generation) {
      loading = loadMarket().catch(() => { failed = S.generation; }).finally(() => { loading = null; const fns = [...waiting]; waiting.clear(); fns.forEach(fn => fn()); });
    }
    return {};
  }
  const key = oppKey();
  if (opps.key !== key) opps = {key, value:compute()};
  return opps.value;
}

// The Crew map's input for each pilot: skills, hulls on hand, holdings, wallet and queue.
export function crewInput(onReady) {
  const pilots = ordered().map(p => {
    const x = summary(p), w = S.wing.get(p.id), ship = (p.private ? p.ops?.ship?.value : w?.ship)?.ship_type_id;
    const holdings = x.holdings ? x.holdings.rows.map(r => ({type:r.type, name:name(r.type), qty:r.quantity, value:r.value, cat:assetCats.get(r.type) || 'Other'})) : null;
    const ships = [...new Set([...(holdings || []).filter(h => h.cat === 'Ship').map(h => h.type), ...(ship ? [ship] : [])])];
    return {key:keyOf(p), name:p.name, id:p.id, known:Boolean(x.skills?.skills), level:id => levelOf(x.skills, id), ships, shipName:name, holdings, wallet:x.wallet ?? null, queue:p.queue || []};
  });
  const o = opportunities(onReady), caps = pilots.length ? capabilities({pilots, opportunities:o}) : [];
  return {pilots, opportunities:o, caps, plan:caps.length ? groupPlan(caps, pilots, o) : null};
}

// ── Next up: alerts first, then one passive pick, the best active picks, then training, jobs, haul and goal steps. ──
function haulSaved() { try { return JSON.parse(localStorage.getItem('eve-haul:v1')) || {}; } catch { return {}; } }
function nextUp(p, crew) {
  const o = crew.opportunities, steps = [], me = keyOf(p);
  const q = queueState(p.queue);
  if (q?.kind === 'empty') steps.push({kind:'alert', label:'Training', title:'Add a skill to your queue', why:'Nothing is training. Every idle hour is skill points lost.', go:'training', button:'Open training'});
  if (q?.kind === 'paused') steps.push({kind:'alert', label:'Training', title:'Start your skill queue', why:'Skills are queued but paused. Start the queue in game.', go:'training', button:'Open training'});
  if (q?.kind === 'ending') steps.push({kind:'alert', label:'Training', title:'Queue more skills', why:`Your queue runs out in ${remaining(q.end).replace(' remaining', '')}.`, go:'training', button:'Open training'});
  // Industry jobs from either connected pilot that are done or finish within a day.
  const jobs = S.pilots.filter(x => x.private).flatMap(x => (x.ops?.jobs?.value || []).map(j => ({...j, who:x.name})))
    .filter(j => j.status === 'ready' || (j.status === 'active' && Date.parse(j.end_date) - Date.now() < 86400000));
  if (jobs.length) {
    const ready = jobs.filter(j => j.status === 'ready' || Date.parse(j.end_date) <= Date.now()), soon = jobs.find(j => !ready.includes(j));
    steps.push({kind:'alert', label:'Jobs', title:ready.length ? `Deliver ${plural(ready.length, 'finished job')}` : `${name(soon.product_type_id)} job finishes soon`,
      why:ready.length ? `${[...new Set(ready.map(j => j.who))].join(' and ')} can collect the output and start the next run.` : `${soon.who}’s ${plural(soon.runs, 'run')} ${soon.runs === 1 ? 'is' : 'are'} done in ${remaining(soon.end_date).replace(' remaining', '')}. Have the next job ready.`,
      figure:ready.length ? `${ready.length}` : remaining(soon.end_date).replace(' remaining', ''), note:ready.length ? 'ready' : 'left', go:'earn/jobs', button:'Open jobs'});
  }
  if (o.industry) steps.push({kind:'passive', act:'industry', label:'Industry', title:`Start ${o.industry.plan}`, why:`${format(o.industry.invest, 'isk')} to start, pays back in ${o.industry.payback < 1 ? 'under a day' : `${o.industry.payback.toFixed(1)} days`}, and it builds while you fly.`, figure:`+${format(o.industry.profitDay, 'isk').replace(' ISK', '')}`, note:'ISK/day', go:'industry', button:'Plan the build'});
  if (o.mining) steps.push({kind:'active', act:'mining', label:'Mining', title:`Mine ${o.mining.plan}`, why:`${o.mining.jumps ? plural(o.mining.jumps, 'jump') : 'Right here'} in ${o.mining.flyable ? `your ${o.mining.ship}` : `a ${o.mining.ship} (train its hull skill first)`}${o.mining.kills ? ` · ${plural(o.mining.kills, 'ship')} killed there last hour` : ' · quiet last hour'}.`, figure:format(o.mining.iskHour, 'isk').replace(' ISK', ''), note:'ISK/hour', go:'mining', button:'Show the belts'});
  if (o.exploration) steps.push({kind:'active', act:'exploration', label:'Exploration', title:`Scan from ${o.exploration.best}`, why:`${o.exploration.best} is ${plural(o.exploration.jumps, 'jump')} out, the start of a quiet loop from ${o.start}.`, figure:String(o.exploration.quiet), note:'quiet systems', go:'exploration', button:'Plan the loop'});
  // The wing's best activity tells you which skill to queue next.
  const train = crew.caps.find(c => c.next.kind === 'skill' && c.next.pilot === me && c.score >= 25);
  if (train) steps.push({kind:'training', act:train.activity, label:'Training', title:train.next.label.replace(`${p.name}: train`, 'Queue'), why:`${train.next.why} ${train.label} is one of the wing’s strengths tonight.`, figure:String(train.score), note:`${train.label} readiness`, go:'training', button:'Open training'});
  const haul = haulSaved().stops?.filter(Boolean);
  if (haul?.length > 1) steps.push({kind:'together', act:'hauling', label:'Hauling', title:`Finish your haul to ${haul.at(-1)}`, why:`${plural(haul.length, 'stop')} saved in your haul plan.`, go:'hauling', button:'Resume'});
  const goal = S.data.goals.filter(g => !g.done && g.steps?.some(st => !st.done)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
  if (goal) steps.push({kind:'together', label:'Goal', title:goal.steps.find(st => !st.done).text, why:`Next step toward “${goal.title}”${goal.due ? `, due ${goal.due}` : ''}.`, figure:`${goal.steps.filter(st => st.done).length}/${goal.steps.length}`, note:'steps done', go:'goals', button:'Open goals'});
  return steps.slice(0, 5);
}
const stepRow = (s, i) => `<li class="course__step" data-kind="${s.kind}" ${s.act ? `data-act="${s.act}"` : ''} style="--i:${i}">
  <span class="course__kind">${esc(s.label)}</span>
  <div class="course__body"><b>${esc(s.title)}</b><small>${esc(s.why)}</small></div>
  <div class="course__figure">${s.figure ? `<span class="num">${esc(s.figure)}</span><small>${esc(s.note)}</small>` : ''}</div>
  <button class="secondary small" data-go="${s.go}">${esc(s.button)}</button></li>`;

// Together: exactly one suggestion that needs both pilots.
function together(p, o, crew) {
  if (!o) return '<p class="together__line">Add your wingmate to config.json to plan sessions together.</p>';
  const sharing = o.private || S.wing.get(o.id)?.sharing;
  if (!sharing) return `<p class="together__line">${esc(o.name)} hasn’t shared their sheet yet. Once they reconnect and tick “share with my wingmate”, their plans show up here.</p>`;
  if (crew.plan) {
    const mine = crew.plan.assign[keyOf(p)];
    return `<p class="together__line">${esc(crew.plan.sentence)}</p><ul class="tonight__roles" role="list">${crew.pilots.map(x => `<li class="role-badge" data-pilot="${esc(x.key)}">${esc(x.name)} · ${esc((crew.plan.roles[x.key] || []).join(', '))}</li>`).join('')}</ul>
      ${mine ? `<button class="small" data-go="${ACT[mine].tab}">Plan this session</button>` : ''}`;
  }
  const here = S.wing.get(o.id)?.location?.solar_system_id;
  return `<p class="together__line">${esc(o.name)} is ${here ? `in ${esc(name(here))}` : 'flying with you'}. Open the crew map to see what you cover together.</p>`;
}
function wingCard(p, s, o, crew) {
  if (!o) return '';
  const t = summary(o), sharing = o.private || S.wing.get(o.id)?.sharing;
  const goal = S.data.goals.find(g => !g.done);
  const progress = !goal ? null : Number.isFinite(goal.target) && goal.target > 0 ? Math.min(1, (goal.result || 0) / goal.target) : goal.steps?.length ? goal.steps.filter(st => st.done).length / goal.steps.length : null;
  const [a, b] = crew.caps;
  return `<section class="panel wing-card" aria-labelledby="wing-mini-title"><h2 id="wing-mini-title">Your wing</h2>
    <div class="pilot-head" data-pilot="${esc(keyOf(o))}">${portrait(o, 40, 'portrait--sm')}<div><h3>${esc(o.name)}</h3><p class="hint">${corpLine(o)}</p></div>${t.title ? `<span class="role-badge">${esc(t.title)}</span>` : ''}</div>
    ${trainingAlert(o)}
    <dl class="readout">${fact('Net worth', count('wing-worth', t.worth, 'isk'))}${fact('Skill points', count('wing-sp', t.sp))}</dl>
    ${sharing ? '' : `<p class="hint">${esc(o.name)} hasn’t shared their sheet yet. Once they reconnect and tick “share with my wingmate”, their plans show up here.</p>`}
    ${goal ? `<div class="goal-mini"><span>${esc(goal.title)}</span>${progress === null ? '' : `<span class="stack" role="img" aria-label="${Math.round(progress * 100)}% done"><i class="fill" style="width:${(progress * 100).toFixed(1)}%"></i></span>`}</div>` : ''}
    ${a ? `<p class="wing-mini__best">Tonight you’re best at <b data-act="${a.activity}">${a.label}</b> (${a.score})${b ? `, then ${b.label} (${b.score})` : ''}.</p>` : ''}
    <button class="secondary small" data-go="strengths">Open the crew map</button></section>`;
}

export function render() {
  const p = mine(), o = wingmate();
  if (!p) { $('#pilots').innerHTML = '<div class="empty">Choose your pilot to begin.</div>'; return; }
  const i = S.pilots.indexOf(p), s = summary(p), ops = p.ops || {}, loc = ops.location?.value, ship = ops.ship?.value;
  const crew = crewInput(() => { if (!$('#bridge').hidden) render(); });
  const birthday = p.profile?.birthday, age = birthday ? Math.floor((Date.now() - Date.parse(birthday)) / 86400000) : null;
  const where = loc ? `${loc.station_id ? 'Docked at' : loc.structure_id ? 'Docked in a structure in' : 'In space in'} <b>${esc(loc.station_id ? name(loc.station_id) : name(loc.solar_system_id))}</b>${ship ? ` in a ${esc(name(ship.ship_type_id))}` : ''}` : '';
  const steps = nextUp(p, crew), loadingMarket = S.backend && !S.marketData && !p.refreshing;
  $('#pilots').innerHTML = `
  <header class="me-banner pilot-line" data-pilot="${esc(keyOf(p))}">
    ${portrait(p, 72, 'portrait--lg')}
    <div class="pilot-line__main"><h1 class="screen-title">${esc(p.name)}</h1>
      <p class="pilot-line__where">${where ? `${where} · ` : ''}${corpLine(p)}${age === null ? '' : ` · capsuleer for ${age.toLocaleString()} days`}</p>
      ${trainingAlert(p)}${p.error ? `<p class="error">${esc(p.error)}</p>` : ''}${connectButtons(p, i)}</div>
    <div class="pilot-line__side"><span class="role-badge">${esc(s.title || 'Unranked capsuleer')}</span>
      <dl class="readout">${fact('Skill points', count('me-sp', s.sp))}${fact('Net worth', count('me-worth', s.worth, 'isk'))}</dl></div>
  </header>
  <div class="bridge-grid">
    <section class="panel panel--primary next-up" aria-labelledby="next-title">
      <div class="panel__head"><h2 id="next-title">Next up</h2><p class="panel__sub">Best first, sized to your ship, skills${s.wallet === undefined ? '' : ` and ${esc(format(s.wallet, 'isk'))}`}</p></div>
      ${steps.length ? `<ol class="course">${steps.map(stepRow).join('')}</ol>` : ''}
      ${loadingMarket ? '<div class="skel-rows" aria-busy="true" aria-label="Pricing tonight’s options"><p class="skel-label">Pricing tonight’s options…</p><i></i><i></i></div>' : ''}
      ${!steps.length && !loadingMarket ? `<div class="state"><p>Nothing to suggest yet. Connect ${esc(p.name)} to share location, wallet and skills, and the Bridge will plan your next session.</p></div>` : ''}
    </section>
    <aside class="bridge-side">
      <section class="panel together" aria-labelledby="together-title"><h2 id="together-title">Together</h2>${together(p, o, crew)}</section>
      ${wingCard(p, s, o, crew)}
    </aside>
  </div>
  <section class="panel ship-card" aria-labelledby="ship-title"><h2 id="ship-title">Ship &amp; position</h2><dl class="facts">
      ${fact('Location', loc ? `${esc(name(loc.solar_system_id))}<small>${loc.station_id ? esc(name(loc.station_id)) : loc.structure_id ? 'Docked in a structure' : 'In space'}</small>` : '—')}
      ${fact('Ship', ship ? `${esc(name(ship.ship_type_id))}<small>${esc(ship.ship_name || '')}</small>` : '—')}
      ${fact('Wallet', s.wallet !== undefined ? esc(isk(s.wallet)) : '—')}
      ${fact('Security status', Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—')}
    </dl>
    <details><summary>Corporation history</summary>${p.corp ? `<p class="hint">${Number(p.corp.member_count).toLocaleString()} members · ${(p.corp.tax_rate * 100).toFixed(1)}% tax</p>` : ''}${p.careerError ? `<p class="error">History unavailable: ${esc(p.careerError)}</p>` : ''}<ol class="career">${(p.career || []).map(item => `<li><b>${esc(item.name)}</b><span>Joined ${esc(new Date(item.start_date).toLocaleDateString())}</span></li>`).join('')}</ol></details>
  </section>
  <p class="freshness hint">${p.synced ? `EVE data from ${esc(when(p.synced))}` : S.backend ? 'Connect to share training and see private data.' : ''}</p>`;
}
