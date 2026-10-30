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
export function evaluate(s, {book, adjusted, fees, index = 0, researchIndex = 0, levels = {}, alpha = false, capture = 0.05}) {
  const product = book.items.get(s.type);
  const ask = type => book.items.get(type)?.sells[0]?.price;
  if (!product?.sells.length || s.m.some(([type]) => !ask(type))) return null;
  const me = researchTarget(s.rank);
  const perUnit = s.t / s.q;
  const unitsPerDay = Math.max(1, Math.min(product.daily * capture, slots(levels).build * 86400 / buildSeconds(perUnit, levels)));
  // Batch one day's output per job so ME rounding works for us.
  const runs = Math.max(1, Math.ceil(unitsPerDay / s.q));
  const materials = level => s.m.reduce((t, [type, qty]) => t + materialsFor(qty, runs, level) * ask(type), 0) / (runs * s.q);
  const eiv = s.m.reduce((t, [type, qty]) => t + qty * (adjusted.get(type) || 0), 0);
  const jobFee = eiv * (index + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0)) / s.q;
  // Sell where the item trades most, at that hub's lowest ask.
  const hub = Object.entries(product.byRegion || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const sell = product.sells.find(x => book.stations.get(x.loc)?.region === hub) || product.sells[0];
  const revenue = sell.price * (1 - fees.salesTax - fees.brokerFee);
  // Fetch materials where the costliest input is cheapest.
  const main = s.m.reduce((a, b) => qtyCost(b) > qtyCost(a) ? b : a);
  function qtyCost([type, qty]) { return qty * ask(type); }
  const unitProfit = level => revenue - materials(level) - jobFee;
  const profit = unitProfit(me), profitDay = profit * unitsPerDay;
  const research = {me, seconds:researchTime(s.rank, 0, me, levels), cost:researchCost(eiv, 0, me, researchIndex, alpha)};
  const invest = s.price + research.cost + materials(me) * unitsPerDay;
  return {...s, me, research, unitsPerDay, revenue, sell, materialsAt:book.items.get(main[0]).sells[0].loc, materialCost:materials(me), jobFee, profit, profitAtZero:unitProfit(0),
    margin:profit / revenue, profitDay, payback:profitDay > 0 ? (s.price + research.cost) / profitDay + research.seconds / 86400 : Infinity,
    invest, daily:product.daily, sellers:product.sells.length};
}
export function rank(list, budget) {
  return list.filter(x => x && x.profit > 0 && x.payback < 60)
    .map(x => ({...x, affordable:!(budget >= 0) || x.invest <= budget}))
    .sort((a, b) => (b.affordable - a.affordable) || (b.profitDay / Math.max(1, b.payback)) - (a.profitDay / Math.max(1, a.payback)));
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
