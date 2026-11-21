// Plan → Build for the Android app: the web's industry tab (ui/screens/earn.js renderIndustry) without the HTML. Prices
// NPC-sold T1 blueprints for a pilot (fees with standings, slots, Alpha tax, skills, wallet, owned blueprints), splits
// the best ones across the wing, and plans each pick's trip and material bill. ESI's adjusted prices and industry cost
// indices are loaded once an hour (build.esi); station owners for standings come with each call.
import {levelOf} from '../../../model.js';
import {fees} from '../../../market.js';
import {skillLevels, isAlpha, slots, evaluate, rank, wingAssign, stage, nextSkills, SCC, NPC_FACILITY_TAX, ALPHA_TAX} from '../../../industry.js';
import {owned as ownedMap, ownedLabel, library} from '../../../blueprints.js';
import {facilities, nearest, leg} from '../../../route.js';
import {feeBook, brokerFee} from '../../../standings.js';

const HUB_SYSTEMS = [30000142, 30002187, 30002659, 30002510, 30002053];
const SKILL_LABELS = {industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production', advancedMassProduction:'Advanced Mass Production', science:'Science',
  labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research', accounting:'Accounting', brokerRelations:'Broker Relations'};
const FLAGS = {thin:['Thin market', 'Under 10 sold per day at the hub'], crowded:['Crowded', '10+ stations already list it'], capital:['Budget-sized', 'Your wallet covers fewer runs than the market would take; output grows as you reinvest'],
  slow:['Slow seller', 'The market takes under one a day'], margin:['Thin margin', 'Under 10% after fees; a small undercut wipes it out']};
const isNpcStation = id => id >= 60000000 && id < 64000000;
const sysOut = s => s && {id:s.id, name:s.name, sec:s.sec, region:s.region};

// ESI's public lists, kept between calls: adjusted prices (markets/prices) and cost indices (industry/systems).
let adjusted = new Map(), costIndices = new Map(), esiStamp = null;
/** The lists for the other Plan adapters (Trade uses both). */
export const esiLists = () => ({adjusted, costIndices});

export const api = ({graph, meta, book}) => ({
  /** {prices:[{type_id, adjusted_price}], systems:[{solar_system_id, cost_indices:[{activity, cost_index}]}], stamp} */
  'build.esi': ({prices = [], systems = [], stamp = null}) => {
    adjusted = new Map(prices.map(r => [r.type_id, r.adjusted_price || 0]));
    costIndices = new Map(systems.map(r => [r.solar_system_id, Object.fromEntries((r.cost_indices || []).map(c => [c.activity, c.cost_index]))]));
    esiStamp = stamp;
    return {prices:adjusted.size, systems:costIndices.size, stamp};
  },
  'build.esiStamp': () => esiStamp,
  /**
   * {system, budget?, category?, sort, showAll, me:{name, skills, wallet, blueprints, standings}, mate?:{…}, owners:{loc:[corp, faction]}}
   * → {ready, summary, wing, picks, categories, facilities, guide, library, needOwners}
   */
  'build.plan': ({system, budget, category = '', sort = 'profit', showAll = false, me: meIn = {}, mate: mateIn = null, owners = {}}) => {
    const g = graph(), m = meta(), b = book(), catalog = m.starters || [];
    if (!b.items.size || !catalog.length) return {ready:false};
    const ownerOf = loc => { const o = owners[loc]; return o ? {corp:o[0], faction:o[1] || undefined} : undefined; };
    const at = loc => { const st = b.stations.get(loc); return {loc, system:st?.system ?? null, name:st?.name || `Station ${loc}`}; };
    const sysName = id => g.systems.get(id)?.name ?? null;
    const idx = costIndices.get(system) || {};
    // The pilot: levels, Alpha, slots, fees with standings at the hubs and the rows' stations.
    const x = meIn, levels = skillLevels(x.skills, m.skills || {}), alpha = isAlpha(x.skills), s = slots(levels), known = Boolean(x.skills?.skills);
    const broker = feeBook({level:levelOf(x.skills, m.skills?.brokerRelations), standings:Array.isArray(x.standings) ? x.standings : undefined, owner:ownerOf});
    const f = {...fees(x.skills, m.skills), brokerAt:broker.at};
    const myBps = ownedMap(x.blueprints), theirBps = ownedMap(mateIn?.blueprints);
    // Plan around the cheapest safe NPC factory and lab near the starting system.
    const here = g.systems.get(system);
    const factories = here ? facilities(g, system, 1, id => costIndices.get(id)?.manufacturing) : [];
    const labs = here ? facilities(g, system, 2, id => costIndices.get(id)?.researching_material_efficiency) : [];
    const factory = factories[0], lab = labs[0];
    const buildIndex = factory?.index ?? idx.manufacturing ?? 0, researchIndex = lab?.index ?? idx.researching_material_efficiency ?? 0;
    const cache = new Map();
    const sellerNames = m.bpoSurvey?.names || {};
    const sellerOf = pick => here ? nearest(g, system, (pick.sellers || []).map(([loc, sys, price]) => ({loc, system:sys, price, name:sellerNames[loc] || at(loc).name})), cache) : null;
    const categories = [...new Set(catalog.map(item => item.cat))].sort();
    const skillOf = x.skills?.skills ? id => levelOf(x.skills, id) : undefined;
    const priceFor = pilot => rank(catalog.filter(item => !category || item.cat === category).map(item => evaluate(item, {book:b, adjusted, index:buildIndex, researchIndex, ...pilot})), pilot.budget);
    const ranked = priceFor({fees:f, levels, alpha, skillOf, budget, owned:bp => myBps.get(bp)}).map(pick => ({...pick, seller:pick.owned ? null : sellerOf(pick)}));
    const SORTS = {profit:(a, c) => c.profitDay - a.profitDay, payback:(a, c) => a.payback - c.payback, margin:(a, c) => c.margin - a.margin, invest:(a, c) => a.invest - c.invest,
      near:(a, c) => (a.owned ? -1 : a.seller?.route.jumps ?? 999) - (c.owned ? -1 : c.seller?.route.jumps ?? 999)};
    const overBudget = ranked.filter(pick => !pick.affordable).length;
    const list = (SORTS[sort] ? [...ranked].sort((a, c) => (c.affordable - a.affordable) || SORTS[sort](a, c)) : ranked).filter(pick => showAll || pick.affordable).slice(0, 20);
    const jobTax = buildIndex + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0);
    // The wingmate's plan, priced with their own skills, fees, Alpha status and wallet; a product goes first to whoever owns its blueprint.
    const ox = mateIn, oLevels = ox ? skillLevels(ox.skills, m.skills || {}) : null;
    const themRanked = ox ? priceFor({fees:fees(ox.skills, m.skills), levels:oLevels, alpha:isAlpha(ox.skills), skillOf:ox.skills?.skills ? id => levelOf(ox.skills, id) : undefined, budget:ox.wallet ?? undefined, owned:bp => theirBps.get(bp)}) : [];
    const [mePlan, themPlan = null] = wingAssign([{ranked, slots:known ? s.build : 2, budget:budget ?? Infinity}, ...(ox ? [{ranked:themRanked, slots:ox.skills?.skills ? slots(oLevels).build : 2, budget:ox.wallet ?? Infinity}] : [])]);
    const ownerName = pick => mePlan.chosen.some(c => c.bp === pick.bp) ? x.name : themPlan?.chosen.some(c => c.bp === pick.bp) ? ox.name : null;
    const skillName = id => m.skillNames?.[id] || `Skill ${id}`;
    const legOut = (label, place, from, to, note) => { const r = from && to ? leg(g, from, to, cache) : null; return {label, place, jumps:r ? r.jumps : null, risky:r ? r.risky : 0, note}; };
    const pickOut = pick => {
      const seller = pick.seller, start = seller?.place.system ?? system, mats = at(pick.materialsAt), hub = at(pick.sell.loc), fee = broker.explain(pick.sell.loc);
      const legs = [];
      if (!pick.owned) legs.push(seller ? {label:'Buy the blueprint', place:seller.place.name, jumps:seller.route.jumps, risky:seller.route.risky, note:`${Math.round(seller.place.price)}`} : {label:'Buy the blueprint', place:null, jumps:null, risky:0, note:'none'});
      if (lab && pick.research.me > pick.research.from) legs.push(legOut(`Research to ME ${pick.me}`, lab.station.name, start, lab.system.id, `ME index ${lab.index}`));
      legs.push(legOut('Buy materials', mats.name, lab?.system.id ?? start, mats.system, pick.materialsRegion));
      if (factory) legs.push(legOut('Build', factory.station.name, mats.system ?? start, factory.system.id, `index ${factory.index}`));
      legs.push(legOut('Sell', hub.name, factory?.system.id ?? mats.system ?? start, hub.system, `${pick.sell.price}`));
      const theirs = theirBps.get(pick.bp);
      return {
        bp:pick.bp, type:pick.type, name:pick.n, cat:pick.cat, rank:pick.rank, affordable:pick.affordable, plan:ownerName(pick),
        owned:pick.owned ? ownedLabel(pick.owned) : null, ownedKind:pick.owned?.kind ?? null, ownedTe:pick.owned?.te ?? null, ownedRuns:pick.owned?.kind === 'bpc' ? pick.owned.runs : null,
        mateOwns:!pick.owned && theirs ? ownedLabel(theirs) : null,
        missing:(pick.missing || []).map(([id, lvl]) => ({name:skillName(id), level:lvl})),
        flags:pick.flags.filter(fl => FLAGS[fl]).map(fl => ({key:fl, label:FLAGS[fl][0], why:FLAGS[fl][1]})),
        profitDay:pick.profitDay, payback:pick.payback, invest:pick.invest, margin:pick.margin, me:pick.me, runs:pick.runs,
        price:pick.seller?.place.price ?? pick.listPrice, sellers:(pick.sellers || []).length, sellerJumps:seller ? seller.route.jumps : null,
        research:{from:pick.research.from, me:pick.research.me, seconds:pick.research.seconds, cost:pick.research.cost},
        unitsPerDay:pick.unitsPerDay, sellPrice:pick.sellPrice, profitAtZero:pick.profitAtZero,
        broker:{fee:fee.fee, applied:fee.applied, at:hub.name},
        daily:pick.daily, listings:pick.listings, trend:pick.trend ?? null,
        materialsRegion:pick.materialsRegion,
        bill:pick.bill.map(r => ({type:r.type, name:m.types?.[r.type]?.n ?? null, qty:r.qty, price:r.price, at:at(r.loc).name})),
        legs,
      };
    };
    const pilotPlan = (who, pl, wallet, free) => ({name:who.name, chosen:pl.chosen.map(c => ({name:c.n, owned:Boolean(c.owned)})), profitDay:pl.profitDay, spent:pl.spent, slots:free, wallet:wallet ?? null});
    const crew = [pilotPlan(x, mePlan, budget, known ? s.build : 2), ...(ox ? [pilotPlan(ox, themPlan, ox.wallet, ox.skills?.skills ? slots(oLevels).build : 2)] : [])];
    const affordable = ranked.filter(r => r.affordable), top = affordable[0];
    const cheaper = factory && factory.system.id !== system && factory.index < (idx.manufacturing ?? Infinity) * 0.8;
    const facility = (fx, kind) => ({station:fx.station.name, system:sysOut(fx.system), jumps:fx.jumps, index:fx.index,
      tax:fx.index + NPC_FACILITY_TAX + (kind === 'ME' ? SCC.research : SCC.manufacturing) + (alpha ? ALPHA_TAX : 0)});
    const plan = stage(x.wallet), next = nextSkills(levels, alpha);
    const lib = who => who && who.blueprints !== undefined ? library(who.blueprints, () => null).map(o => ({type:o.type, kind:o.kind, label:o.label, me:o.me, te:o.te, copies:o.copies, loc:o.loc ?? null})) : null;
    // Owners still unknown: the hubs' stations and the stations the picks sell at (the app looks them up and asks again).
    const hubLocs = HUB_SYSTEMS.map(id => [...b.stations].find(([, st]) => st.system === id)?.[0]).filter(Boolean);
    const needOwners = Array.isArray(x.standings) ? [...new Set([...hubLocs, ...list.map(p => p.sell.loc)])].filter(loc => isNpcStation(loc) && !owners[loc]) : [];
    return {
      ready:true, categories,
      summary:{fit:affordable.length, of:ranked.length, best:top ? top.profitDay : null, buildIn:factory?.system.name || here?.name || null, buildIndex, known, alpha,
        build:s.build, science:s.science, jobTax, salesTax:f.salesTax, brokerFee:brokerFee(levelOf(x.skills, m.skills?.brokerRelations)),
        cheaper:cheaper ? {system:factory.system.name, jumps:factory.jumps, index:factory.index, here:idx.manufacturing || 0} : null, overBudget},
      wing:crew, picks:list.map(pickOut),
      facilities:{build:factories.map(fx => facility(fx, 'build')), research:labs.map(fx => facility(fx, 'ME'))},
      guide:{stage:plan.name, goal:plan.goal, steps:plan.steps, wallet:x.wallet ?? null, train:next.map(k => ({...k, name:SKILL_LABELS[k.key] || k.key})), alpha,
        fees:f.salesTax + f.brokerFee, science:s.science, scc:SCC, npcTax:NPC_FACILITY_TAX},
      library:{me:lib(x), mate:ox ? lib(ox) : null},
      needOwners,
      survey:m.bpoSurvey ? {regions:m.bpoSurvey.regions, of:m.bpoSurvey.of} : null, catalog:catalog.length,
    };
  },
});
