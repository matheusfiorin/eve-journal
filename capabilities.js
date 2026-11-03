// Crew map: how ready the wing is for each activity, who brings what, the cheapest next step, a group plan for
// tonight and a deterministic radial layout. Pure functions; the UI supplies skills, ships, holdings and live picks.
import {SHIPS, SKILL, canFly} from './mining.js';
import {EXPLORERS} from './exploration.js';
import {stage} from './industry.js';
import {compactNumber} from './model.js';

// Fixed ring order, so the map doesn't reshuffle when scores move.
export const ACTIVITIES = ['mining', 'industry', 'hauling', 'trade', 'combat', 'exploration'];
export const ACT = {
  mining:{label:'Mining', noun:'Miner', tab:'mining', does:'mines the nearest quiet belt'},
  industry:{label:'Industry', noun:'Builder', tab:'industry', does:'keeps the build slots busy'},
  hauling:{label:'Hauling', noun:'Hauler', tab:'hauling', does:'hauls for the wing'},
  trade:{label:'Trade', noun:'Trader', tab:'market', does:'works the market'},
  combat:{label:'Combat', noun:'Escort', tab:'training', does:'flies escort'},
  exploration:{label:'Exploration', noun:'Explorer', tab:'exploration', does:'scans for relic and data sites'}
};
export const WORDS = [[75, 'Strong'], [50, 'Ready'], [25, 'Getting there'], [0, 'Open']];
export const word = score => WORDS.find(([min]) => score >= min)[1];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const W = {skills:0.35, ships:0.25, materials:0.10, wallet:0.10, opportunity:0.20};

// Skill type ids (EVE static data). Racial lists are Caldari, Gallente, Amarr, Minmatar.
const FRIGATE = [3330, 3328, 3331, 3329], INDUSTRIAL = [3342, 3340, 3343, 3341], SMALL_WEAPON = [3301, 3302, 3303, 3321, 3436];
export const SKILL_NAMES = {[SKILL.mining]:'Mining', [SKILL.astrogeology]:'Astrogeology', [SKILL.miningFrigate]:'Mining Frigate', [SKILL.miningBarge]:'Mining Barge', [SKILL.reprocessing]:'Reprocessing',
  3380:'Industry', 3387:'Mass Production', 3402:'Science', 3388:'Advanced Industry', 3453:'Evasive Maneuvering', 3455:'Warp Drive Operation', 16622:'Accounting', 3446:'Broker Relations', 3443:'Trade',
  3300:'Gunnery', 3327:'Spaceship Command', 3301:'Small Hybrid Turret', 3302:'Small Projectile Turret', 3303:'Small Energy Turret', 3321:'Light Missiles', 3436:'Drones',
  3412:'Astrometrics', 13278:'Archaeology', 21718:'Hacking', 3330:'Caldari Frigate', 3328:'Gallente Frigate', 3331:'Amarr Frigate', 3329:'Minmatar Frigate',
  3342:'Caldari Industrial', 3340:'Gallente Industrial', 3343:'Amarr Industrial', 3341:'Minmatar Industrial'};
// [skill ids (the best of them counts), target level, why it helps]
const KEY_SKILLS = {
  mining:[[[SKILL.mining], 4, 'Miner II and +5% yield a level'], [[SKILL.astrogeology], 3, '+5% yield a level'], [[SKILL.miningFrigate], 1, 'flies the Venture'], [[SKILL.miningBarge], 1, 'flies a mining barge, about 3× a Venture'], [[SKILL.reprocessing], 3, 'more minerals from every ore']],
  industry:[[[3380], 4, 'faster builds'], [[3387], 3, 'one more build slot a level'], [[3402], 3, 'opens research'], [[3388], 3, 'faster builds and research']],
  hauling:[[INDUSTRIAL, 1, 'flies a T1 industrial'], [[3453], 3, 'aligns faster at gates'], [[3455], 3, 'shorter trips']],
  trade:[[[16622], 3, 'lower sales tax'], [[3446], 3, 'lower broker fees'], [[3443], 3, 'more orders at once']],
  combat:[[[3300], 4, 'better turret handling'], [SMALL_WEAPON, 3, 'a frigate weapon that hits'], [FRIGATE, 3, 'a combat frigate with its hull bonuses'], [[3327], 3, 'faster ships']],
  exploration:[[[3412], 3, 'finds sites at all'], [[13278], 3, 'opens relic cans'], [[21718], 3, 'opens data cans'], [FRIGATE, 3, 'an exploration frigate with its bonuses']]
};
// shortcut: T1 industrial hull ids from memory of the SDE; extend when a pilot's hauler isn't recognised.
export const INDUSTRIALS = {648:'Badger', 649:'Tayra', 650:'Nereus', 651:'Hoarder', 652:'Mammoth', 653:'Wreathe', 654:'Kryos', 655:'Epithal', 656:'Miasmos', 657:'Iteron Mark V', 1944:'Bestower', 19744:'Sigil'};
const EXPLORER = Object.fromEntries(Object.entries(EXPLORERS).map(([key, e]) => [e.id, {...e, skill:{caldariFrigate:3330, gallenteFrigate:3328, amarrFrigate:3331, minmatarFrigate:3329}[key]}]));
const MATERIALS = {mining:{cats:['Material', 'Asteroid'], cap:20e6}, industry:{cats:['Material', 'Blueprint'], cap:30e6}, combat:{cats:['Charge'], cap:5e6}, trade:{not:['Ship', 'Implant', 'Skill', 'Blueprint'], cap:50e6}};
const WALLET = {industry:stage(0).goal, trade:100e6, hauling:50e6, mining:10e6, exploration:10e6, combat:20e6};
const article = name => /^[AEIOU]/.test(name) ? `an ${name}` : `a ${name}`;
const clamp = v => Math.max(0, Math.min(1, v));

// Each pilot's part 0–1 plus the facts behind it. The wing takes the best pilot, +0.1 when both add something.
function wingPart(perPilot) {
  const values = perPilot.map(x => x.value), best = Math.max(0, ...values);
  return clamp(best + (values.filter(v => v > 0).length > 1 ? 0.1 : 0));
}
function skillsOf(act, p) {
  const list = KEY_SKILLS[act], facts = [];
  let total = 0;
  for (const [ids, target] of list) {
    const id = ids.reduce((a, b) => p.level(b) > p.level(a) ? b : a), level = p.level(id), v = Math.min(level / target, 1);
    total += v / list.length;
    if (level) facts.push({pilot:p.key, kind:'skill', label:`${p.name}: ${SKILL_NAMES[id]} ${ROMAN[level]}`, amount:v / list.length, typeId:id});
    const q = (p.queue || []).find(item => ids.includes(item.skill_id) && item.finished_level > level);
    if (q) {
      const gain = (Math.min(q.finished_level / target, 1) - v) / list.length;
      if (gain > 0) facts.push({pilot:p.key, kind:'training', label:`${p.name} is training ${SKILL_NAMES[q.skill_id]} ${ROMAN[q.finished_level]}`, amount:gain, typeId:q.skill_id, finish:q.finish_date});
    }
  }
  return {value:p.known ? total : 0, facts};
}
function shipsOf(act, p) {
  const owned = id => p.ships.includes(id), fact = (label, typeId, amount) => ({pilot:p.key, kind:'ship', label, typeId, amount});
  const options = [];
  if (act === 'mining') for (const id of Object.keys(SHIPS).map(Number)) {
    const name = SHIPS[id].name, fly = canFly(id, p.level);
    if (owned(id)) options.push(fact(fly ? `${p.name} owns ${article(name)}` : `${p.name} owns ${article(name)}, not trained yet`, id, fly ? 1 : 0.6));
    else if (fly) options.push(fact(`${p.name} can fly ${article(name)}`, id, SHIPS[id].frigate ? 0.3 : 0.6));
  }
  if (act === 'exploration') for (const [id, e] of Object.entries(EXPLORER)) {
    const fly = p.level(e.skill) >= 1;
    if (owned(Number(id))) options.push(fact(`${p.name} owns ${article(e.ship)}`, Number(id), fly ? 1 : 0.6));
    else if (fly) options.push(fact(`${p.name} can fly ${article(e.ship)}`, Number(id), 0.5));
  }
  const hauler = p.ships.find(id => INDUSTRIALS[id]), canHaul = INDUSTRIAL.some(id => p.level(id) >= 1);
  if (act === 'hauling') {
    if (hauler) options.push(fact(`${p.name} owns ${article(INDUSTRIALS[hauler])}`, hauler, canHaul ? 1 : 0.6));
    else if (canHaul) options.push(fact(`${p.name} can fly a T1 industrial`, undefined, 0.6));
  }
  if (act === 'combat') {
    const hull = p.ships.find(id => !SHIPS[id] && !INDUSTRIALS[id] && !EXPLORER[id]), armed = SMALL_WEAPON.some(id => p.level(id) >= 1) || p.level(3300) >= 1;
    if (hull) options.push(fact(`${p.name} has ${article(p.shipName(hull))} to fight in`, hull, armed ? 1 : 0.3));
    else if (armed) options.push(fact(`${p.name} can fit frigate guns`, undefined, 0.3));
  }
  // Industry and trade are station work: a hauler helps, nothing else matters much.
  if (act === 'industry' || act === 'trade') return {value:hauler ? 1 : 0.5, facts:hauler ? [fact(`${p.name} owns ${article(INDUSTRIALS[hauler])} to move goods`, hauler, 1)] : []};
  const best = options.sort((a, b) => b.amount - a.amount)[0];
  return {value:best?.amount || (act === 'hauling' ? 0.3 : 0), facts:best ? [best] : []};
}
function materialsOf(act, pilots) {
  const rule = MATERIALS[act];
  if (!rule || pilots.every(p => !p.holdings)) return null;
  const fits = h => rule.cats ? rule.cats.includes(h.cat) : !rule.not.includes(h.cat);
  const facts = [];
  let total = 0;
  for (const p of pilots) {
    const rows = (p.holdings || []).filter(fits), sum = rows.reduce((t, h) => t + h.value, 0), top = [...rows].sort((a, b) => b.value - a.value)[0];
    total += sum;
    if (top?.value > 0) facts.push({pilot:p.key, kind:'material', label:`${p.name} has ${compactNumber(top.qty)} ${top.name}`, amount:sum, typeId:top.type});
  }
  const value = clamp(total / rule.cap);
  facts.forEach(f => f.amount = total ? value * f.amount / total : 0);
  return {value, facts, total};
}
function walletOf(act, pilots) {
  const known = pilots.filter(p => Number.isFinite(p.wallet));
  if (!known.length) return null;
  const sum = known.reduce((t, p) => t + p.wallet, 0), value = clamp(sum / WALLET[act]);
  return {value, total:sum, facts:[{pilot:'wing', kind:'wallet', label:value >= 1 ? `Wing wallet covers ${act === 'industry' ? 'a starter run' : act === 'trade' ? 'a full order book' : act === 'hauling' ? 'courier collateral' : 'a lost ship'}` : `Wing wallet ${compactNumber(sum)} of ${compactNumber(WALLET[act])} ISK useful`, amount:value}]};
}
function opportunityOf(act, o) {
  if (!o) return null;
  const value = clamp({mining:() => o.iskHour / 5e6, industry:() => o.profitDay / 1e6, exploration:() => o.quiet / 5 + (o.shortcutJumps <= 5 ? 0.2 : 0),
    hauling:() => o.perJump / 2e6 * (o.risk > 0.01 ? 0.5 : 1), trade:() => o.daily / 2e6}[act]?.() || 0);
  return {value, facts:o.label ? [{pilot:'wing', kind:'opportunity', label:o.label, amount:value}] : []};
}

// The cheapest move that raises the score most: the lowest missing skill level, else a hull, else a session.
function nextStep(act, pilots, parts) {
  const best = [];
  for (const [ids, target, why] of KEY_SKILLS[act]) for (const p of pilots.filter(x => x.known)) {
    const id = ids.reduce((a, b) => p.level(b) > p.level(a) ? b : a), level = p.level(id);
    if (level < target && !pilots.some(x => x.known && ids.some(i => x.level(i) >= target))) best.push({p, id, level, target, why, has:skillsOf(act, p).value});
  }
  // Low levels train fastest; entry skills (target I) first; then the pilot already furthest along in this activity.
  best.sort((a, b) => a.level - b.level || a.target - b.target || b.has - a.has);
  const s = best[0];
  if (s) return {kind:'skill', pilot:s.p.key, label:`${s.p.name}: train ${SKILL_NAMES[s.id]} ${ROMAN[s.level + 1]}`, why:`It ${s.why}.`, typeId:s.id, go:{tab:'training'}};
  const lead = pilots[0];
  if (parts.ships < 1 && lead && (act === 'mining' || act === 'exploration' || act === 'hauling')) {
    const hull = act === 'mining' ? (canFly(17480, lead.level) ? 17480 : 32880) : null;
    const name = act === 'mining' ? SHIPS[hull].name : act === 'hauling' ? 'T1 industrial' : 'exploration frigate';
    return {kind:'ship', pilot:lead.key, label:`${lead.name}: buy ${article(name)}`, why:'The skills are there; a hull of your own puts them to work.', go:{tab:ACT[act].tab, ...(hull ? {set:{'#mining-ship':String(hull)}} : {})}};
  }
  return {kind:'route', pilot:'wing', label:`Plan a ${ACT[act].label.toLowerCase()} session`, why:'The wing is set up for this; the live picks show where it pays tonight.', go:{tab:ACT[act].tab}};
}

/**
 * @param {{pilots:Array<{key:string,name:string,known:boolean,level:(id:number)=>number,ships:number[],shipName?:(id:number)=>string,
 *   holdings:Array<{type:number,name:string,qty:number,value:number,cat:string}>|null,wallet:number|null,queue:Array}>,
 *   opportunities?:Record<string,object|null>}} input
 * @returns sorted by score, best first: {activity,label,score,word,confidence,parts,contributors,next}
 */
export function capabilities({pilots, opportunities = {}}) {
  pilots = pilots.map(p => ({ships:[], holdings:null, wallet:null, queue:[], shipName:id => `ship #${id}`, ...p}));
  return ACTIVITIES.map(act => {
    const skills = pilots.map(p => skillsOf(act, p)), ships = pilots.map(p => shipsOf(act, p));
    const materials = materialsOf(act, pilots), wallet = walletOf(act, pilots), opportunity = act === 'combat' ? null : opportunityOf(act, opportunities[act]);
    const parts = {skills:wingPart(skills), ships:wingPart(ships), materials:materials?.value ?? null, wallet:wallet?.value ?? null, opportunity:opportunity?.value ?? null};
    const weightSum = Object.entries(parts).reduce((t, [k, v]) => t + (v === null ? 0 : W[k]), 0);
    const score = Math.round(100 * Object.entries(parts).reduce((t, [k, v]) => t + (v === null ? 0 : W[k] * v), 0) / weightSum);
    // Spread each part's points over its facts, in proportion to what each fact adds.
    const spread = (key, facts) => { const sum = facts.reduce((t, f) => t + f.amount, 0); return facts.map(f => ({...f, points:sum ? W[key] * parts[key] * f.amount / sum / weightSum : 0})); };
    const facts = [...spread('skills', skills.flatMap(x => x.facts)), ...spread('ships', ships.flatMap(x => x.facts)), ...(materials ? spread('materials', materials.facts) : []),
      ...(wallet ? spread('wallet', wallet.facts) : []), ...(opportunity ? spread('opportunity', opportunity.facts) : [])].filter(f => f.points > 0 || f.kind === 'training');
    const total = facts.reduce((t, f) => t + f.points, 0) || 1;
    const contributors = facts.map(({amount, points, ...f}) => ({...f, weight:Math.max(points / total, f.kind === 'training' ? 0.02 : 0)})).sort((a, b) => b.weight - a.weight);
    const partial = pilots.some(p => !p.known || !p.holdings) || (act !== 'combat' && !opportunities[act]);
    return {activity:act, label:ACT[act].label, score, word:word(score), confidence:partial ? 'partial' : 'full', parts, contributors, next:nextStep(act, pilots, parts),
      detail:{materials:materials?.total ?? null, wallet:wallet?.total ?? null, opportunity:opportunities[act] || null}};
  }).sort((a, b) => b.score - a.score || (b.parts.opportunity ?? 0) - (a.parts.opportunity ?? 0));
}

// The facts worth drawing: the shared wallet only when nothing more specific explains a branch.
export const shown = cap => { const own = cap.contributors.filter(c => c.kind !== 'wallet'); return own.length ? own : cap.contributors; };
// What a pilot adds to a branch, in score points.
export const brings = (cap, key) => cap.contributors.filter(c => c.pilot === key).reduce((t, c) => t + c.weight, 0) * cap.score;
const TOGETHER = new Set(['mining', 'exploration']);
const COMPLEMENT = new Set(['mining>hauling', 'industry>hauling', 'mining>industry']);
const paired = (x, y) => COMPLEMENT.has(`${x}>${y}`) || COMPLEMENT.has(`${y}>${x}`);
const phrase = (act, o, partner) => {
  if (act === 'hauling' && partner === 'mining') return 'hauls the ore to market';
  if (act === 'hauling' && partner === 'industry') return 'hauls materials in and builds out';
  if (act === 'industry' && partner === 'mining') return o?.plan ? `builds from the ore and starts ${o.plan}` : 'builds from the ore';
  if (!o?.plan) return ACT[act].does;
  return {mining:`mines ${o.plan}`, industry:`starts ${o.plan}`, hauling:`hauls ${o.plan}`, trade:`trades ${o.plan}`, exploration:`scans ${o.plan}`, combat:ACT.combat.does}[act];
};
/** Tonight's group plan: one activity per pilot from the top three, the pair that brings the most, complementary pairs first. */
export function groupPlan(caps, pilots, opportunities = {}) {
  const top = caps.slice(0, 3), [a, b] = pilots;
  if (!a || !top.length) return null;
  if (!b) return {sentence:`${a.name} ${phrase(top[0].activity, opportunities[top[0].activity])}.`, roles:{[a.key]:[ACT[top[0].activity].noun]}, assign:{[a.key]:top[0].activity}};
  let pick = null;
  for (const x of top) for (const y of top) {
    if (x === y && !TOGETHER.has(x.activity)) continue;
    const value = brings(x, a.key) + brings(y, b.key) + (paired(x.activity, y.activity) ? 15 : 0) + (x === y ? 5 : 0);
    if (!pick || value > pick.value) pick = {x, y, value};
  }
  const {x, y} = pick;
  // The pilot on the stronger activity leads the sentence.
  const [first, second, fx, sx] = x.score >= y.score ? [a, b, x, y] : [b, a, y, x];
  const o = act => opportunities[act];
  let sentence;
  if (x === y && x.activity === 'mining') sentence = `${a.name} and ${b.name} ${o('mining')?.plan ? `mine ${o('mining').plan}` : 'mine one belt'} together and share one hauler trip.`;
  else if (x === y) sentence = `${first.name} scouts the gates while ${second.name} ${phrase('exploration', o('exploration'))}.`;
  else sentence = `${first.name} ${phrase(fx.activity, o(fx.activity), sx.activity)}, while ${second.name} ${phrase(sx.activity, o(sx.activity), fx.activity)}.`;
  return {sentence, roles:{[a.key]:[ACT[x.activity].noun], [b.key]:[ACT[y.activity].noun]}, assign:{[a.key]:x.activity, [b.key]:y.activity}};
}

// Deterministic radial layout: wing core in the centre, the pilots beside it, one branch per activity on a ring and
// up to four contributor leaves outside it. Branches start half a step off the vertical so no label fan stacks on itself.
export function crewLayout(caps, {w = 1000, h = 640, pilots = ['fiofka', 'decxus']} = {}) {
  const cx = w / 2, cy = h / 2, m = Math.min(w, h), R1 = 0.30 * m, R2 = 0.46 * m, rad = d => d * Math.PI / 180;
  const at = (r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
  const r1 = n => Math.round(n * 10) / 10;
  const sats = pilots.map((key, i) => ({key, x:cx + (i ? 58 : -58), y:cy, r:20}));
  const list = ACTIVITIES.map(act => caps.find(c => c.activity === act)).filter(Boolean), n = list.length;
  const branches = list.map((cap, i) => {
    const angle = -90 + (i + 0.5) * 360 / n, [x, y] = at(R1, angle), [qx, qy] = at(R1 * 0.55, angle - 8);
    const leaves = shown(cap).slice(0, 4), k = leaves.length, step = Math.min(14, 300 / (n * Math.max(1, k)));
    return {activity:cap.activity, cap, angle, x:r1(x), y:r1(y), r:r1(16 + 0.26 * cap.score),
      edge:{d:`M${cx} ${cy}Q${r1(qx)} ${r1(qy)} ${r1(x)} ${r1(y)}`, width:r1(1 + 3 * cap.score / 100), opacity:Math.round((0.25 + 0.6 * cap.score / 100) * 100) / 100},
      links:sats.map(s => ({pilot:s.key, weight:brings(cap, s.key) / Math.max(1, cap.score)})).filter(l => l.weight > 0).map(l => {
        const s = sats.find(t => t.key === l.pilot), mx = (s.x + x) / 2, my = (s.y + y) / 2, nx = -(y - s.y), ny = x - s.x, len = Math.hypot(nx, ny) || 1, bend = l.pilot === pilots[0] ? 26 : -26;
        return {...l, width:r1(0.75 + 2 * l.weight), d:`M${s.x} ${s.y}Q${r1(mx + nx / len * bend)} ${r1(my + ny / len * bend)} ${r1(x)} ${r1(y)}`};
      }),
      leaves:leaves.map((c, j) => {
        const a = angle + (j - (k - 1) / 2) * step, [lx, ly] = at(R2, a), cos = Math.cos(rad(a));
        const anchor = cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle', dx = anchor === 'start' ? 10 : anchor === 'end' ? -10 : 0, dy = anchor === 'middle' ? (Math.sin(rad(a)) > 0 ? 16 : -10) : 4;
        return {contributor:c, index:j, x:r1(lx), y:r1(ly), anchor, dx, dy, lines:wrap(c.label, 28)};
      })};
  });
  return {w, h, core:{x:cx, y:cy, r:34}, sats, branches};
}
export function wrap(text, max) {
  if (text.length <= max + 4) return [text]; // a short overflow reads better than a one-word second line
  const cut = text.lastIndexOf(' ', max);
  const head = text.slice(0, cut > 0 ? cut : max), tail = text.slice(head.length).trim();
  return [head, tail.length > max ? `${tail.slice(0, max - 1)}…` : tail];
}
