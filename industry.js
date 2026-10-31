// Early-game industry: slots, research and BPO payback from live prices. Pure functions; the UI supplies data.
// Formulas follow EVE University (Manufacturing, Research, Job cost) and CCP patch notes as of Oct 2026.
export const SCC = {manufacturing:0.04, research:0.02}; // shortcut: research SCC was halved "temporarily" in July 2025; verify in-game.
export const NPC_FACILITY_TAX = 0.0025;
export const ALPHA_TAX = 0.02; // shortcut: CCP sources disagree (0.25% vs 2%); assume the higher figure.
// Rank-1 research seconds for each ME level; multiply by the blueprint rank.
export const RESEARCH_SECONDS = [0, 105, 250, 595, 1414, 3360, 8000, 19000, 45255, 107700, 256000];

export function skillLevels(skills, ids = {}) {
  const level = id => skills?.skills?.find(s => s.skill_id === id)?.active_skill_level || 0;
  return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, level(id)]));
}
// Alpha clones see a lower active level than the level they trained.
export const isAlpha = skills => Boolean(skills?.skills?.some(s => s.active_skill_level < s.trained_skill_level));
export function slots(l) {
  return {build:1 + (l.massProduction || 0) + (l.advancedMassProduction || 0), science:1 + (l.labOperation || 0) + (l.advancedLabOperation || 0)};
}
// Rounding happens per job, never below one unit per run.
export function materialsFor(base, runs, me) {
  return Math.max(runs, Math.ceil(Math.round(base * runs * (1 - me / 100) * 100) / 100));
}
export const researchTarget = rank => rank <= 3 ? 10 : rank <= 6 ? 8 : 6;
export function researchTime(rank, from, to, l = {}) {
  let seconds = 0;
  for (let n = from + 1; n <= to; n++) seconds += RESEARCH_SECONDS[n] * rank;
  return seconds * (1 - 0.05 * (l.metallurgy || 0)) * (1 - 0.03 * (l.advancedIndustry || 0));
}
export function researchCost(eiv, from, to, index, alpha = false) {
  let multiplier = 0;
  for (let n = from + 1; n <= to; n++) multiplier += RESEARCH_SECONDS[n] / 105;
  return eiv * 0.02 * multiplier * (index + NPC_FACILITY_TAX + SCC.research + (alpha ? ALPHA_TAX : 0));
}
export function buildSeconds(base, l = {}) {
  return base * (1 - 0.04 * (l.industry || 0)) * (1 - 0.03 * (l.advancedIndustry || 0));
}

// Price one starter blueprint end to end: research to the target ME, then run it for as long as the market absorbs it.
// skillOf(id) gives the pilot's active level for a skill type, or undefined when skills are unknown.
export function evaluate(s, {book, adjusted, fees, index = 0, researchIndex = 0, levels = {}, alpha = false, capture = 0.05, skillOf}) {
  const product = book.items.get(s.type);
  if (!product?.sells.length) return null;
  const region = loc => book.stations.get(loc)?.region;
  // Buy the whole bill in one region (one shopping trip): the region where it costs least.
  const regions = [...new Set(s.m.flatMap(([type]) => (book.items.get(type)?.sells || []).map(x => region(x.loc))))];
  const askIn = (type, r) => book.items.get(type)?.sells.find(x => region(x.loc) === r);
  const bills = regions.map(r => ({r, asks:s.m.map(([type]) => askIn(type, r))})).filter(b => b.asks.every(Boolean))
    .map(b => ({...b, cost:s.m.reduce((t, [, qty], i) => t + qty * b.asks[i].price, 0)})).sort((x, y) => x.cost - y.cost);
  const bill = bills[0];
  if (!bill) return null;
  const ask = type => bill.asks[s.m.findIndex(([t]) => t === type)].price;
  const me = researchTarget(s.rank);
  const perUnit = s.t / s.q;
  // Sell where the item trades most. A thin market's lowest ask is often a wishful listing, so never count on
  // more than 15% above the 7-day average price.
  const hub = Object.entries(product.byRegion || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const sell = product.sells.find(x => region(x.loc) === hub) || product.sells[0];
  const average = product.avgByRegion?.[hub];
  const sellPrice = average ? Math.min(sell.price, average * 1.15) : sell.price;
  const daily = product.byRegion?.[hub] ?? product.daily;
  const capacity = slots(levels).build * 86400 / buildSeconds(perUnit, levels);
  const unitsPerDay = Math.min(daily * capture, capacity);
  // Batch about a day of output per job (at least one run) so ME rounding works for us.
  const runs = Math.max(1, Math.ceil(unitsPerDay / s.q));
  const materials = level => s.m.reduce((t, [type, qty]) => t + materialsFor(qty, runs, level) * ask(type), 0) / (runs * s.q);
  const eiv = s.m.reduce((t, [type, qty]) => t + qty * (adjusted.get(type) || 0), 0);
  const jobFee = eiv * (index + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0)) / s.q;
  const revenue = sellPrice * (1 - fees.salesTax - fees.brokerFee);
  const unitProfit = level => revenue - materials(level) - jobFee;
  const profit = unitProfit(me), profitDay = profit * unitsPerDay;
  const research = {me, seconds:researchTime(s.rank, 0, me, levels), cost:researchCost(eiv, 0, me, researchIndex, alpha)};
  const batch = materials(me) * runs * s.q;
  const invest = s.price + research.cost + batch;
  const trend = average ? sell.price / average - 1 : null;
  const missing = skillOf ? (s.sk || []).filter(([id, level]) => (skillOf(id) || 0) < level) : [];
  const flags = [daily < 10 && 'thin', trend > 0.15 && 'spike', product.sells.length >= 10 && 'crowded', missing.length && 'skills', unitsPerDay < 1 && 'slow', profit / revenue < 0.1 && 'margin'].filter(Boolean);
  return {...s, me, research, unitsPerDay, runs, revenue, sellPrice, sell, materialsRegion:bill.r, bill:s.m.map(([type, qty], i) => ({type, qty:materialsFor(qty, runs, me), price:bill.asks[i].price, loc:bill.asks[i].loc})),
    materialsAt:bill.asks[s.m.reduce((best, [, qty], i) => qty * bill.asks[i].price > s.m[best][1] * bill.asks[best].price ? i : best, 0)].loc,
    materialCost:materials(me), jobFee, profit, profitAtZero:unitProfit(0), margin:profit / revenue, profitDay,
    payback:profitDay > 0 ? (s.price + research.cost) / profitDay + research.seconds / 86400 : Infinity,
    invest, daily, listings:product.sells.length, trend, missing, flags};
}
// Profitable picks you can afford and build first; risky markets count for less.
const RISK = {thin:0.5, spike:0.6, crowded:0.8, slow:0.7, margin:0.7};
export const confidence = pick => pick.flags.reduce((c, f) => c * (RISK[f] || 1), 1);
export function rank(list, budget) {
  return list.filter(x => x && x.profit > 0 && x.payback < 60)
    .map(x => ({...x, flags:x.flags || [], affordable:!(budget >= 0) || x.invest <= budget}))
    .map(x => ({...x, score:x.profitDay / Math.max(1, x.payback) * confidence(x)}))
    .sort((a, b) => (b.affordable - a.affordable) || (a.flags.includes('skills') - b.flags.includes('skills')) || b.score - a.score);
}
// Fill the pilot's build slots with the best distinct picks the budget covers.
export function portfolio(picks, {slots:free = 1, budget = Infinity} = {}) {
  const chosen = []; let spent = 0;
  for (const pick of picks) {
    if (chosen.length >= free) break;
    if (!pick.affordable || pick.flags.includes('skills') || spent + pick.invest > budget) continue;
    chosen.push(pick); spent += pick.invest;
  }
  return {chosen, spent, profitDay:chosen.reduce((t, x) => t + x.profitDay, 0)};
}

// Where the pilot is in the plan, and which skills move them forward next.
export function stage(wallet) {
  if (!(wallet >= 20e6)) return {name:'Week 1 · bootstrap', goal:20e6, steps:['Earn the first 10–20M with missions, exploration or a Venture; never price your own ore at zero.', 'Buy 1–2 cheap rank-1 BPOs (drones or small ammo) and start ME research right away.', 'Build in small batches in a quiet 0.5+ system near a hub and learn the relist cycle.']};
  if (!(wallet >= 100e6)) return {name:'Weeks 2–4 · expand', goal:100e6, steps:['Run 4–8 BPOs across both pilots, each pilot on its own product lines so you never undercut each other.', 'Keep every slot busy with multi-run jobs; research the next BPO while the current one builds.', 'Reinvest about 70% of profit into materials and keep 30% as a buffer.']};
  return {name:'Months 2–3 · scale', goal:500e6, steps:['Go Omega on the main builder and push Mass Production V and Laboratory Operation IV.', 'Add destroyer, Mobile Depot or MTU blueprints researched to ME 6–8.', 'Move builds to a low-index player Engineering Complex, then start the invention skill chain.']};
}
const SKILL_PLAN = [
  ['industry', 3, false, 'Unlocks Mass Production; −4% build time per level'],
  ['massProduction', 3, false, '+1 manufacturing slot per level'],
  ['science', 3, false, 'Prerequisite for research skills; −5% copy time'],
  ['brokerRelations', 2, false, '−0.3% broker fee per level'],
  ['labOperation', 3, true, '+1 research slot per level'],
  ['accounting', 3, true, '−11% sales tax per level'],
  ['brokerRelations', 3, true, '−0.3% broker fee per level'],
  ['massProduction', 4, true, 'A fifth manufacturing slot'],
  ['metallurgy', 3, true, '−5% ME research time per level'],
  ['advancedIndustry', 3, true, '−3% build and research time per level'],
  ['industry', 5, false, 'Fastest builds; required for Mass Production V'],
  ['science', 4, false, 'Required for Metallurgy and invention'],
  ['accounting', 5, true, 'Sales tax down to about 3.4%'],
  ['massProduction', 5, true, '6 manufacturing slots; unlocks Advanced Mass Production'],
  ['labOperation', 5, true, '6 research slots']
];
export function nextSkills(l, alpha, count = 4) {
  return SKILL_PLAN.filter(([key, level, omega]) => (l[key] || 0) < level && !(omega && alpha)).slice(0, count)
    .map(([key, level, omega, why]) => ({key, from:l[key] || 0, level, omega, why}));
}
