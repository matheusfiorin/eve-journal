// Bridge (home): what to do now. Alerts and the pilot line, "Next up" ranked from the planning modules, and the wing together.
// Also owns the live inputs the Crew map scores (crewInput), so both screens read one cached computation.
import {levelOf, queueState} from '../../model.js';
import {fees, hauls, stationTrades} from '../../market.js';
import {skillLevels, isAlpha, evaluate, rank} from '../../industry.js';
import {SHIPS, yieldRate, holdOf, canFly, oreValue, sites} from '../../mining.js';
import {rankSystems} from '../../exploration.js';
import {capabilities, groupPlan, ACT} from '../../capabilities.js';
import {SLOTS, fitGroups, fitCounts, eft} from '../../fit.js';
import {S, mine, wingmate, ordered, summary, assetCats, opsOf, viaWing} from '../state.js';
import {name, named} from '../esi.js';
import {loadMarket} from '../marketdata.js';
import {$, esc, isk, when, day, left, count, fact, format, plural, portrait, corpLine, connectButtons, trainingAlert, permissionBanner, wingNote, toast, openDrawer} from '../shared.js';
import {mapGraph, route} from '../routes.js';
import {haulSaved} from '../prefs.js';

export const markup = {bridge:'<div id="pilots"></div>'};
const keyOf = p => p.name.toLowerCase();
// A figure, or the reason it is missing, so an empty value never reads as zero or as a broken page.
const money = (key, value, none) => Number.isFinite(value) ? count(key, value, 'isk') : `<span class="hint">${none}</span>`;

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
function nextUp(p, crew) {
  const o = crew.opportunities, steps = [], me = keyOf(p);
  const q = queueState(p.queue);
  if (q?.kind === 'empty') steps.push({kind:'alert', label:'Training', title:'Add a skill to your queue', why:'Nothing is training. Every idle hour is skill points lost.', go:'training', button:'Open training'});
  if (q?.kind === 'paused') steps.push({kind:'alert', label:'Training', title:'Start your skill queue', why:'Skills are queued but paused. Start the queue in game.', go:'training', button:'Open training'});
  if (q?.kind === 'ending') steps.push({kind:'alert', label:'Training', title:'Queue more skills', why:`Your queue runs out in ${left(q.end)}.`, go:'training', button:'Open training'});
  // Industry jobs from either connected pilot that are done or finish within a day.
  const jobs = S.pilots.flatMap(x => (opsOf(x).jobs?.value || []).map(j => ({...j, who:x.name})))
    .filter(j => j.status === 'ready' || (j.status === 'active' && Date.parse(j.end_date) - Date.now() < 86400000));
  if (jobs.length) {
    const ready = jobs.filter(j => j.status === 'ready' || Date.parse(j.end_date) <= Date.now()), soon = jobs.find(j => !ready.includes(j));
    steps.push({kind:'alert', label:'Jobs', title:ready.length ? `Deliver ${plural(ready.length, 'finished job')}` : `${name(soon.product_type_id)} job finishes soon`,
      why:ready.length ? `${[...new Set(ready.map(j => j.who))].join(' and ')} can collect the output and start the next run.` : `${soon.who}’s ${plural(soon.runs, 'run')} ${soon.runs === 1 ? 'is' : 'are'} done in ${left(soon.end_date)}. Have the next job ready.`,
      figure:ready.length ? `${ready.length}` : left(soon.end_date), note:ready.length ? 'ready' : 'left', go:'earn/jobs', button:'Open jobs'});
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
  if (!sharing) return `<p class="together__line">Plans for the two of you appear here once ${esc(o.name)} shares.</p>`;
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
    ${sharing || o.problem ? trainingAlert(o) : ''}
    ${sharing ? '' : `<p class="hint">${esc(o.name)} hasn’t shared their sheet yet. Once they reconnect and tick “share with my wingmate”, their plans show up here.</p>`}
    <dl class="readout">${fact('Net worth', money('wing-worth', t.worth, sharing ? 'Not shared yet' : 'Connect to see'))}${fact('Skill points', Number.isFinite(t.sp) ? count('wing-sp', t.sp) : '<span class="hint">Connect to see</span>')}</dl>
    ${goal ? `<div class="goal-mini"><span>${esc(goal.title)}</span>${progress === null ? '' : `<span class="stack" role="img" aria-label="${Math.round(progress * 100)}% done"><i class="fill" style="width:${(progress * 100).toFixed(1)}%"></i></span>`}</div>` : ''}
    ${a ? `<p class="wing-mini__best">Tonight you’re best at <b data-act="${a.activity}">${a.label}</b> (${a.score})${b ? `, then ${b.label} (${b.score})` : ''}.</p>` : ''}
    <button class="secondary small" data-go="strengths">Open the crew map</button></section>`;
}

// ── Current fit: what is in the ship the pilot flies now (the Worker keeps only the ship's own items). ──
const catOf = id => assetCats.get(id) || null;
const SUM = {high:'high', mid:'mid', low:'low', rig:'rigs', sub:'subsystems', drones:'drones', fighters:'fighters', special:'in holds', cargo:'in cargo'};
const fitText = p => { const ops = opsOf(p), ship = ops.ship?.value; return eft({ship:ship.ship_type_id, title:ship.ship_name, items:ops.fit.value.items, nameOf:name, catOf}); };
// The same module twice in a row reads as one line with a count, as in game.
const lines = list => list.reduce((out, m) => { const last = out.at(-1); if (last && last.type === m.type && last.charge === m.charge) last.n += m.qty; else out.push({...m, n:m.qty}); return out; }, []);
function fitCard(p, own) {
  const ops = opsOf(p), ship = ops.ship?.value, f = ops.fit, who = own ? 'Current fit' : `${p.name}’s current fit`, id = `fit-title-${keyOf(p)}`;
  const wrap = body => `<section class="panel fit-card" data-pilot="${esc(keyOf(p))}" aria-labelledby="${id}"><div class="panel__head"><h2 id="${id}">${esc(who)}</h2>${ship ? `<p class="panel__sub">${esc(name(ship.ship_type_id))}${ship.ship_name ? ` · ${esc(ship.ship_name)}` : ''}</p>` : ''}</div>${body}</section>`;
  if (!own && !f?.value) return !p.private && S.wing.get(p.id)?.shareLevel === 2 ? wrap(`<p class="hint">${esc(p.name)}’s fit is not shared with the wing.</p>${wingNote(p, 3)}`) : '';
  if (!f) return wrap(p.refreshing ? '<p class="hint">Loading…</p>' : '<p class="hint">Not synced yet. Press Refresh.</p>');
  if (!f.permission) return wrap(permissionBanner(p, ['your current fit']));
  if (!f.value || !ship) return wrap('<p class="hint">The fit appears after the next asset refresh.</p>');
  // The fit was read for one ship; after a change of hull it waits for the next asset refresh (about an hour).
  if (f.value.ship !== ship.ship_item_id) return wrap('<p class="hint">You changed ships. The fit of this one appears after the next asset refresh, which can take up to an hour.</p>');
  const groups = fitGroups(f.value.items, catOf), counts = fitCounts(f.value.items, catOf), parts = SLOTS.filter(([k]) => counts[k]);
  if (!parts.length) return wrap('<p class="hint">Nothing is fitted in this ship.</p>');
  const mods = ['high', 'mid', 'low', 'rig', 'sub'];
  return wrap(`<p class="fit-card__sum">${parts.map(([k]) => `<span><b class="num">${counts[k]}</b> ${SUM[k]}</span>`).join('')}</p>
    <div class="fit-card__groups">${parts.map(([k, l]) => `<details class="fit-group" ${mods.includes(k) ? 'open' : ''}><summary>${l} <span class="num seg__n">${counts[k]}</span></summary><ul class="plain">${lines(groups[k]).map(m => `<li>${esc(name(m.type))}${m.charge ? ` <small>${esc(name(m.charge))}</small>` : ''}${m.n > 1 ? ` <span class="num">×${m.n.toLocaleString()}</span>` : ''}</li>`).join('')}</ul></details>`).join('')}</div>
    <div class="actions"><button type="button" class="secondary small" data-copy-eft="${esc(p.name)}">Copy as EFT</button></div>`);
}
async function copyFit(button) {
  const p = S.pilots.find(x => x.name === button.dataset.copyEft); if (!p || !opsOf(p).fit?.value || !opsOf(p).ship?.value) return;
  const text = fitText(p);
  try { await navigator.clipboard.writeText(text); toast('Fit copied. Paste it into EVE or a fitting tool.', 'ok'); }
  catch { openDrawer({title:'Copy this fit', body:`<p class="hint">Your browser would not copy it for you. Select the text and copy it.</p><textarea class="eft" readonly rows="14" aria-label="Fit as EFT text">${esc(text)}</textarea>`}); $('#drawer .eft')?.select(); }
}

export function render() {
  const p = mine(), o = wingmate();
  if (!p) { $('#pilots').innerHTML = '<div class="empty">Choose your pilot to begin.</div>'; return; }
  const i = S.pilots.indexOf(p), s = summary(p), ops = opsOf(p), loc = ops.location?.value, ship = ops.ship?.value;
  const crew = crewInput(() => { if (!$('#bridge').hidden) render(); });
  const birthday = p.profile?.birthday, age = birthday ? Math.floor((Date.now() - Date.parse(birthday)) / 86400000) : null;
  const resolving = S.settling && loc && ![loc.station_id || loc.solar_system_id, ship?.ship_type_id].filter(Boolean).every(named);
  const where = resolving ? 'Locating…' : loc ? `${loc.station_id ? 'Docked at' : loc.structure_id ? 'Docked in a structure in' : 'In space in'} <b>${esc(loc.station_id ? name(loc.station_id) : name(loc.solar_system_id))}</b>${ship ? ` in a ${esc(name(ship.ship_type_id))}` : ''}` : '';
  const steps = nextUp(p, crew), loadingMarket = S.backend && !S.marketData && !p.refreshing, linked = p.private || viaWing(p);
  const badge = s.title ? `<span class="role-badge">${esc(s.title)}</span>` : p.refreshing || S.settling ? '<span class="role-badge role-badge--skel" aria-hidden="true"></span>' : '';
  $('#pilots').innerHTML = `
  <header class="me-banner pilot-line" data-pilot="${esc(keyOf(p))}">
    ${portrait(p, 72, 'portrait--lg')}
    <div class="pilot-line__main"><h1 class="screen-title">${esc(p.name)}</h1>
      <p class="pilot-line__where">${where ? `${where} · ` : ''}${corpLine(p)}${age === null ? '' : ` · capsuleer for ${age.toLocaleString()} days`}</p>
      ${linked || p.problem || p.refreshing || p.error || queueState(p.queue) ? (p.error && !linked && !p.problem ? '' : trainingAlert(p)) : `<p class="alert muted">Connect ${esc(p.name)} to see training, net worth and your next moves.</p>`}${p.error && !p.problem ? `<p class="error">${esc(p.error)}</p>` : ''}${connectButtons(p, i)}</div>
    <div class="pilot-line__side">${badge}
      <dl class="readout">${fact('Skill points', Number.isFinite(s.sp) ? count('me-sp', s.sp) : '<span class="hint">Connect to see</span>')}${fact('Net worth', money('me-worth', s.worth, 'Connect to see'))}</dl></div>
  </header>
  <div class="bridge-grid">
    <section class="panel panel--primary next-up" aria-labelledby="next-title">
      <div class="panel__head"><h2 id="next-title">Next up</h2><p class="panel__sub">Best first, sized to your ship, skills${s.wallet === undefined ? '' : ` and ${esc(format(s.wallet, 'isk'))}`}</p></div>
      ${steps.length ? `<ol class="course">${steps.map(stepRow).join('')}</ol>` : ''}
      ${loadingMarket ? '<div class="skel-rows" aria-busy="true" aria-label="Pricing tonight’s options"><p class="skel-label">Pricing tonight’s options…</p><i></i><i></i></div>' : ''}
      ${!steps.length && !loadingMarket && linked ? '<div class="state"><p>Nothing to suggest right now. New picks appear as the market and your sheet update.</p></div>' : ''}
      ${!steps.length && !loadingMarket && !linked ? '<p class="hint next-up__idle">Your next moves appear here once you’re connected.</p>' : ''}
    </section>
    <div class="bridge-side">
      <section class="panel together" aria-labelledby="together-title"><h2 id="together-title">Together</h2>${together(p, o, crew)}</section>
      ${wingCard(p, s, o, crew)}
    </div>
  </div>
  <section class="panel ship-card" aria-labelledby="ship-title"><h2 id="ship-title">Ship &amp; position</h2><dl class="facts">
      ${fact('Location', loc ? `${esc(name(loc.solar_system_id))}<small>${loc.station_id ? esc(name(loc.station_id)) : loc.structure_id ? 'Docked in a structure' : 'In space'}</small>` : '<span class="hint">Connect to see</span>')}
      ${fact('Ship', ship ? `${esc(name(ship.ship_type_id))}<small>${esc(ship.ship_name || '')}</small>` : '<span class="hint">Connect to see</span>')}
      ${fact('Wallet', s.wallet !== undefined ? esc(isk(s.wallet)) : linked ? '<span class="hint">Not synced yet</span>' : '<span class="hint">Connect to see</span>')}
      ${fact('Security status', Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—')}
    </dl>
    <details><summary>Corporation history</summary>${p.corp ? `<p class="hint">${Number(p.corp.member_count).toLocaleString()} members · ${(p.corp.tax_rate * 100).toFixed(1)}% tax</p>` : ''}${p.careerError ? `<p class="error">History unavailable: ${esc(p.careerError)}</p>` : ''}<ol class="career">${(p.career || []).map(item => `<li><b>${esc(item.name)}</b><span>Joined ${esc(day(item.start_date))}</span></li>`).join('')}</ol></details>
  </section>
  ${linked ? fitCard(p, true) : ''}${o ? fitCard(o, false) : ''}
  <p class="freshness hint">${p.synced ? `EVE data from ${esc(when(p.synced))}` : ''}</p>`;
}
// Next up names the saved haul: redraw when another tab or device changes it.
export function wire() {
  document.addEventListener('click', event => { const b = event.target.closest('#bridge [data-copy-eft]'); if (b) copyFit(b); });
  document.addEventListener('pref-change', event => { if (event.detail.remote && event.detail.name === 'haul' && !$('#bridge').hidden) render(); }); }
