// Hourly market pipeline: scans ESI orders for the watchlist in trade hubs and the
// pilots' current regions, keeps only the best prices per station, and stores the
// compact result in the Worker for the dashboard to rank opportunities.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ESI = 'https://esi.evetech.net/latest';
export const HUBS = [10000002, 10000043, 10000032, 10000030, 10000042]; // The Forge, Domain, Sinq Laison, Heimatar, Metropolis
const SDE = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const HEADERS = {Accept:'application/json', 'User-Agent':'eve-journal market pipeline (github.com/matheusfiorin/eve-journal)'};
const TOP = 6;
const isStation = id => id >= 60000000 && id < 64000000;

// Keep the cheapest sells and richest buys per NPC station; player structures may refuse docking.
// ESI history has no rows for days without trades, so daily volume is the last 7 calendar days' total / 7.
export function aggregate(orders, history = [], now = Date.now()) {
  const sells = new Map(), buys = new Map(), systems = new Map();
  for (const o of orders) {
    if (!isStation(o.location_id)) continue;
    systems.set(o.location_id, o.system_id);
    const side = o.is_buy_order ? buys : sells;
    const best = side.get(o.location_id);
    const better = !best || (o.is_buy_order ? o.price > best.price : o.price < best.price);
    side.set(o.location_id, better ? {price:o.price, volume:o.volume_remain + (best && Math.abs(best.price - o.price) <= o.price * 0.02 ? best.volume : 0)}
      : {...best, volume:best.volume + (Math.abs(best.price - o.price) <= best.price * 0.02 ? o.volume_remain : 0)});
  }
  const top = (side, dir) => [...side].sort((a,b) => dir * (a[1].price - b[1].price)).slice(0, TOP).map(([loc, v]) => [loc, v.price, v.volume]);
  const since = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const recent = history.filter(h => h.date >= since);
  return {
    d: Math.round(recent.reduce((t, h) => t + h.volume, 0) / 7),
    p: recent.length ? Math.round(recent.reduce((t, h) => t + h.average, 0) / recent.length * 100) / 100 : 0,
    s: top(sells, 1), b: top(buys, -1), systems
  };
}
// Manufacturing recipes for watchlist products from the SDE's blueprints.jsonl; skip long material trees.
export function recipes(blueprints, wanted) {
  const out = {}, id = x => x?.typeID ?? x?.typeId;
  for (const bp of blueprints) {
    const job = bp.activities?.manufacturing, product = job?.products?.[0];
    if (!wanted.has(id(product)) || !job.materials?.length || job.materials.length > 15) continue;
    out[id(product)] = {bp:bp.blueprintTypeID ?? bp._key, q:product.quantity, m:job.materials.map(m => [id(m), m.quantity])};
  }
  return out;
}

export const stats = {limited:0};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function esi(path, options = {}, attempt = 0) {
  const response = await fetch(`${ESI}${path}`, {...options, headers:{...HEADERS, ...options.headers}, signal:AbortSignal.timeout(30000)});
  if (Number(response.headers.get('X-ESI-Error-Limit-Remain')) < 20) await sleep((Number(response.headers.get('X-ESI-Error-Limit-Reset')) || 10) * 1000);
  // Market orders share a token bucket (2 tokens per 200); a 429 says how long until it refills.
  if ((response.status === 420 || response.status === 429) && attempt < 4) {
    stats.limited++;
    await sleep(Math.min(900, Number(response.headers.get('Retry-After')) || 60) * 1000);
    return esi(path, options, attempt + 1);
  }
  if (response.status >= 500 && attempt < 3) {
    await sleep(2000 * (attempt + 1));
    return esi(path, options, attempt + 1);
  }
  if (!response.ok) { const e = new Error(`ESI ${response.status} ${path}`); e.status = response.status; throw e; }
  return {body:await response.json(), pages:Number(response.headers.get('X-Pages')) || 1};
}
async function pool(items, size, work) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:size}, async () => { while (next < items.length) { const i = next++; results[i] = await work(items[i]); } }));
  return results;
}
async function allPages(path) {
  const first = await esi(path), rows = [first.body];
  for (let page = 2; page <= first.pages; page++) rows.push((await esi(`${path}&page=${page}`)).body);
  return rows.flat();
}
const sdeName = value => typeof value === 'string' ? value : value?.en;
// Cheap NPC-seeded T1 blueprints a new industrialist can start with. The SDE base price is the NPC seed price.
const STARTER_CATEGORIES = new Set(['Ship','Module','Charge','Drone','Deployable']);
const STARTER_SHIPS = new Set(['Frigate','Destroyer']);
// NPC sell orders run for 365 days; players can list for 90 at most. Cheapest per station.
export function npcSellers(orders) {
  const best = new Map();
  for (const o of orders) if (!o.is_buy_order && o.duration >= 365 && isStation(o.location_id) && !(best.get(o.location_id)?.[2] <= o.price)) best.set(o.location_id, [o.location_id, o.system_id, o.price]);
  return [...best.values()].sort((a, b) => a[2] - b[2]);
}
// Survey regions never seen or older than maxAge, the pilots' and hubs' regions first.
export function surveyQueue(done, regions, priority, now, maxAge = 20 * 3600000) {
  const first = r => priority.includes(r) ? 1 : 0;
  return regions.filter(r => !(done[r] > now - maxAge)).sort((a, b) => first(b) - first(a) || (done[a] || 0) - (done[b] || 0));
}
// Replace one region's sellers. A few stations per region is enough to find a nearby one and keeps the snapshot small.
export function mergeRegion(sellers, region, ids, found, perRegion = 2) {
  for (const id of ids) {
    const kept = (sellers[id] || []).filter(s => s[3] !== region);
    const added = (found[id] || []).slice(0, perRegion).map(([loc, system, price]) => [loc, system, price, region]);
    if (kept.length || added.length) sellers[id] = [...kept, ...added].sort((a, b) => a[2] - b[2]); else delete sellers[id];
  }
  return sellers;
}
// Ship kills per system as exponentially decayed sums over ~24 h and ~7 days, updated from ESI's last-hour counts.
// shortcut: hours the pipeline missed are filled with the latest hour's rate (at most 6).
export function decayRisk(prev, kills, now) {
  const hours = prev?.at ? Math.max(0, (now - prev.at) / 3600000) : 1, weight = Math.min(hours, 6), s = {};
  for (const [id, [d, w]] of Object.entries(prev?.s || {})) s[id] = [d * Math.exp(-hours / 24), w * Math.exp(-hours / 168)];
  for (const k of kills) if (k.ship_kills) { const v = s[k.system_id] ||= [0, 0]; v[0] += k.ship_kills * weight; v[1] += k.ship_kills * weight; }
  for (const id of Object.keys(s)) { s[id] = s[id].map(x => Math.round(x * 100) / 100); if (s[id][1] < 0.05) delete s[id]; }
  return {at:now, since:prev?.since || now, s};
}
// Jumps per system as a ~24-hour decayed sum: how busy a system is over a day, not just this hour.
export function decayTraffic(prev, jumps, now) {
  const hours = prev?.at ? Math.max(0, (now - prev.at) / 3600000) : 1, weight = Math.min(hours, 6), s = {};
  for (const [id, d] of Object.entries(prev?.s || {})) s[id] = d * Math.exp(-hours / 24);
  for (const j of jumps) if (j.ship_jumps) s[j.system_id] = (s[j.system_id] || 0) + j.ship_jumps * weight;
  for (const id of Object.keys(s)) { s[id] = Math.round(s[id]); if (s[id] < 1) delete s[id]; }
  return {at:now, since:prev?.since || now, s};
}
// This run's kill and traffic sums. Missing ESI data (null) carries the previous sums forward unchanged.
export function history(previous, kills, jumps, now) {
  return {risk:kills ? decayRisk(previous?.risk, kills, now) : previous?.risk, traffic:jumps ? decayTraffic(previous?.traffic, jumps, now) : previous?.traffic};
}
// Weapon and hull types that mark a gate camp: smartbombs and interdiction ships.
export function combatTypes(types, groups) {
  const ids = re => [...types.values()].filter(t => t.published && re.test(sdeName(groups.get(t.groupID)?.name) || '')).map(t => t._key);
  return {sb:ids(/^smart ?bomb$/i), dictor:ids(/^(interdictor|heavy interdiction cruiser)$/i)};
}
export function highsecRegions(map) {
  return [...new Set(Object.values(map.systems).filter(([, sec, region]) => sec >= 0.45 && region < 11000000).map(s => s[2]))];
}
export function starters(blueprints, types, groups, categories, prices, {maxPrice = 30e6, limit = 400} = {}) {
  const out = [], id = x => x?.typeID ?? x?.typeId;
  for (const bp of blueprints) {
    const job = bp.activities?.manufacturing, product = job?.products?.[0];
    const bpId = bp.blueprintTypeID ?? bp._key, blueprint = types.get(bpId), item = types.get(id(product));
    if (!job?.materials?.length || !blueprint?.published || !item?.published) continue;
    if (!(blueprint.basePrice > 0 && blueprint.basePrice <= maxPrice) || (item.metaGroupID && item.metaGroupID !== 1)) continue;
    const group = groups.get(item.groupID), category = sdeName(categories.get(group?.categoryID)?.name);
    if (!STARTER_CATEGORIES.has(category) || (category === 'Ship' && !STARTER_SHIPS.has(sdeName(group.name)))) continue;
    // Rough screen with CCP's average/adjusted prices; the browser re-prices everything from live orders.
    const value = (prices.get(id(product))?.average || 0) * product.quantity;
    const cost = job.materials.reduce((t, m) => t + (prices.get(id(m))?.adjusted ?? NaN) * m.quantity * 0.9, 0);
    if (!Number.isFinite(cost) || !(value > cost)) continue;
    out.push({type:id(product), bp:bpId, n:sdeName(item.name), cat:category === 'Ship' ? sdeName(group.name) : category, q:product.quantity, t:job.time,
      rank:Math.max(1, Math.round((bp.activities.research_material?.time || 105) / 105)), limit:bp.maxProductionLimit, price:blueprint.basePrice,
      m:job.materials.map(m => [id(m), m.quantity]), sk:(job.skills || []).map(k => [id(k), k.level]), score:(value - cost) / job.time});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({score, ...s}) => s);
}
// Known space only: gate graph with security, plus NPC stations that offer manufacturing (1) or research (2).
// Known space for the Map tab and routing: gates, security, belts, 3D position (light-years), CCP's schematic 2D layout,
// constellation and region names, and every NPC station with its services as bit flags.
export const STATION_SERVICES = {Factory:1, Laboratory:2, Market:4, 'Reprocessing Plant':8, Cloning:16};
const LY = 9.4607e15;
export function universe({mapSolarSystems, mapStargates, npcStations, stationOperations, stationServices, mapAsteroidBelts = [], mapRegions = [], mapConstellations = []}) {
  const bit = new Map(stationServices.map(s => [s._key, STATION_SERVICES[sdeName(s.serviceName)] || 0]));
  const systems = {}, round = (v, f) => Math.round(v * f) / f;
  for (const s of mapSolarSystems) if (s._key < 31000000) {
    const p = s.position || {}, q = s.position2D;
    systems[s._key] = [sdeName(s.name), round(s.securityStatus, 1000), s.regionID, [], 0,
      [round((p.x || 0) / LY, 100), round((p.y || 0) / LY, 100), round((p.z || 0) / LY, 100)], q ? [round(q.x / 1e15, 10), round(q.y / 1e15, 10)] : null, s.constellationID];
  }
  for (const gate of mapStargates) {
    const from = systems[gate.solarSystemID], to = gate.destination?.solarSystemID;
    if (from && systems[to] && !from[3].includes(to)) from[3].push(to);
  }
  // Asteroid belt count per system; zero means nothing to mine outside anomalies.
  for (const belt of mapAsteroidBelts) if (systems[belt.solarSystemID]) systems[belt.solarSystemID][4]++;
  const services = new Map(stationOperations.map(o => [o._key, (o.services || []).reduce((f, id) => f | (bit.get(id) || 0), 0)]));
  const stations = npcStations.filter(st => systems[st.solarSystemID]).map(st => [st._key, st.solarSystemID, services.get(st.operationID) || 0]);
  const used = new Set(Object.values(systems).map(s => s[2])), constellationsUsed = new Set(Object.values(systems).map(s => s[7]));
  const regions = Object.fromEntries(mapRegions.filter(r => used.has(r._key)).map(r => [r._key, sdeName(r.name)]));
  const constellations = Object.fromEntries(mapConstellations.filter(c => constellationsUsed.has(c._key)).map(c => [c._key, [sdeName(c.name), c.regionID]]));
  return {systems, stations, regions, constellations};
}
async function sde(files) {
  const response = await fetch(SDE, {headers:HEADERS, signal:AbortSignal.timeout(300000)});
  if (!response.ok) throw new Error(`SDE download: HTTP ${response.status}`);
  const zip = join(await mkdtemp(join(tmpdir(), 'sde-')), 'sde.zip');
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  const entries = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').map(n => n.trim());
  return Object.fromEntries(files.map(file => {
    const entry = entries.find(n => n === `${file}.jsonl` || n.endsWith(`/${file}.jsonl`));
    if (!entry) throw new Error(`${file}.jsonl is missing from the SDE`);
    return [file, execFileSync('unzip', ['-p', zip, entry], {maxBuffer:1024 * 1024 * 1024}).toString().split('\n').filter(Boolean).map(line => JSON.parse(line))];
  }));
}
const byKey = rows => new Map(rows.map(row => [row._key, row]));
// Belt ores found in high- and low-sec, with their compressed form, grades and reprocessing output per portion.
export const BELT_ORES = ['Veldspar', 'Scordite', 'Pyroxeres', 'Plagioclase', 'Omber', 'Kernite', 'Jaspet', 'Hemorphite', 'Hedbergite'];
const GRADES = {'II-Grade':0.05, 'III-Grade':0.10, 'IV-Grade':0.15};
export function ores(types, typeMaterials) {
  const byName = new Map([...types.values()].filter(t => t.published).map(t => [sdeName(t.name), t]));
  const mats = new Map(typeMaterials.map(t => [t._key, (t.materials || []).map(m => [m.materialTypeID, m.quantity])]));
  return BELT_ORES.map(n => {
    const ore = byName.get(n), comp = byName.get(`Compressed ${n}`);
    if (!ore || !mats.get(ore._key)?.length) return null;
    const grades = {[ore._key]:0};
    for (const [suffix, bonus] of Object.entries(GRADES)) { const t = byName.get(`${n} ${suffix}`); if (t) grades[t._key] = bonus; }
    return {n, ore:ore._key, comp:comp?._key, vol:ore.volume, portion:ore.portionSize || 100, m:mats.get(ore._key), grades};
  }).filter(Boolean);
}

async function main() {
  const secret = process.env.EVE_CLIENT_SECRET?.trim();
  if (!secret) throw new Error('EVE_CLIENT_SECRET is required to sign pipeline uploads.');
  const token = createHmac('sha256', secret).update('market-pipeline').digest('base64url');
  const site = process.env.SITE_URL || 'https://matheusfiorin.github.io/eve-journal/';
  const backend = (await (await fetch(new URL('config.json', site))).json()).backendUrl;
  if (!backend) throw new Error('The published config.json has no backendUrl yet.');
  const api = (path, init = {}) => fetch(`${backend}${path}`, {...init, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...init.headers}, signal:AbortSignal.timeout(60000)});

  const {items} = JSON.parse(await readFile(new URL('../market/watchlist.json', import.meta.url), 'utf8'));
  const ids = (await esi('/universe/ids/?language=en', {method:'POST', body:JSON.stringify(items)})).body.inventory_types || [];
  const wanted = new Set(ids.map(t => t.id));
  console.log(`Watchlist: ${wanted.size} of ${items.length} names resolved.`);

  const meta = {generatedAt:new Date().toISOString(), types:{}, recipes:{}, regions:{}}, report = [];
  meta.starters = [];
  let map = null;
  try {
    const data = await sde(['blueprints', 'types', 'groups', 'categories', 'mapSolarSystems', 'mapStargates', 'npcStations', 'stationOperations', 'stationServices', 'mapAsteroidBelts', 'typeMaterials', 'mapRegions', 'mapConstellations']);
    try {
      map = universe(data);
      const linked = Object.values(map.systems).filter(s => s[3].length).length;
      if (!linked || !map.stations.length || !Object.keys(map.regions).length) throw new Error(`parsed ${linked} linked systems and ${map.stations.length} stations; sample system keys: ${Object.keys(data.mapSolarSystems[0] || {}).join(',')}; sample station keys: ${Object.keys(data.npcStations[0] || {}).join(',')}`);
    } catch (error) { map = null; console.log(`::warning title=Universe map::${error.message}`); }
    meta.recipes = recipes(data.blueprints, wanted);
    const prices = new Map((await esi('/markets/prices/')).body.map(p => [p.type_id, {average:p.average_price || p.adjusted_price || 0, adjusted:p.adjusted_price}]));
    const types = byKey(data.types);
    meta.starters = starters(data.blueprints, types, byKey(data.groups), byKey(data.categories), prices);
    meta.ores = ores(types, data.typeMaterials);
    meta.combat = combatTypes(types, byKey(data.groups));
    meta.skillNames = Object.fromEntries([...new Set(meta.starters.flatMap(s => s.sk.map(([k]) => k)))].map(k => [k, sdeName(types.get(k)?.name) || `Skill ${k}`]));
    console.log(`Recipes: ${Object.keys(meta.recipes).length} watchlist items; ${meta.starters.length} starter blueprints.`);
  } catch (error) { meta.recipesError = `Blueprint data unavailable: ${error.message}`; console.log(`::warning title=Blueprints::${meta.recipesError}`); }
  let pilotSystems = [];
  try { pilotSystems = (await (await api('/api/market/regions')).json()).systems || []; } catch (error) { console.warn(`Pilot regions: ${error.message}`); }
  const pilotRegions = await Promise.all(pilotSystems.map(async system => {
    if (map?.systems[system]) return map.systems[system][2];
    const s = (await esi(`/universe/systems/${system}/`)).body;
    return (await esi(`/universe/constellations/${s.constellation_id}/`)).body.region_id;
  }));
  // Keep only blueprints an NPC actually sells in high-sec. The survey is too big for one run under ESI's
  // market rate limit, so it is incremental: each run refreshes the stalest regions within a time budget.
  // shortcut: a blueprint new to the candidate list is only checked in a region at that region's next refresh.
  if (meta.starters.length) {
    const ids = meta.starters.map(s => s.bp), regions = map ? highsecRegions(map) : HUBS;
    let survey = null;
    try { survey = (await (await api('/api/market/survey')).json()).survey; } catch (error) { console.warn(`Previous survey: ${error.message}`); }
    survey = {done:{}, sellers:{}, names:{}, ...survey};
    const deadline = Date.now() + Number(process.env.SURVEY_MINUTES || 20) * 60000;
    let surveyed = 0;
    for (const region of surveyQueue(survey.done, regions, [...pilotRegions, ...HUBS], Date.now())) {
      if (Date.now() > deadline) break;
      try {
        const present = new Set(await allPages(`/markets/${region}/types/?datasource=tranquility`));
        const here = ids.filter(id => present.has(id)), found = {};
        await pool(here, 16, async id => { found[id] = npcSellers(await allPages(`/markets/${region}/orders/?order_type=sell&type_id=${id}`)); });
        mergeRegion(survey.sellers, region, ids, found);
        survey.done[region] = Date.now(); surveyed++;
      } catch (error) { console.warn(`Survey ${region}: ${error.message}`); }
    }
    for (const r of Object.keys(survey.done)) if (!regions.includes(Number(r))) delete survey.done[r];
    const missing = [...new Set(Object.values(survey.sellers).flat().map(s => s[0]))].filter(loc => !survey.names[loc]);
    for (let i = 0; i < missing.length; i += 1000) (await esi('/universe/names/', {method:'POST', body:JSON.stringify(missing.slice(i, i + 1000))})).body.forEach(r => { survey.names[r.id] = r.name; });
    const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region:2, data:survey})});
    if (!stored.ok) console.log(`::warning title=BPO survey::Upload failed: HTTP ${stored.status} ${await stored.text()}`);
    const screened = meta.starters.length, covered = Object.keys(survey.done).length;
    meta.starters = meta.starters.filter(s => survey.sellers[s.bp]?.length).slice(0, 150).map(s => ({...s, sellers:survey.sellers[s.bp].map(x => x.slice(0, 3))}));
    const locs = new Set(meta.starters.flatMap(s => s.sellers.map(x => x[0])));
    meta.bpoSurvey = {regions:covered, of:regions.length, names:Object.fromEntries(Object.entries(survey.names).filter(([loc]) => locs.has(Number(loc))))};
    report.push(`${meta.starters.length} of ${screened} screened blueprints sold by NPCs; surveyed ${covered} of ${regions.length} high-sec regions (${surveyed} this run)`);
  }
  const scan = [...new Set([...wanted, ...(meta.ores || []).flatMap(o => [o.ore, o.comp].filter(Boolean)), ...(meta.ores || []).flatMap(o => o.m.map(([id]) => id)), ...Object.values(meta.recipes).flatMap(r => r.m.map(([id]) => id)), ...meta.starters.flatMap(s => [s.type, ...s.m.map(([id]) => id)])])];

  // Last hour's kills and jumps per known-space system: danger and crowding for the Mining tab.
  // Read last run's meta first: the kill and traffic sums build on it, so a failed read must not restart them.
  let previous;
  try {
    const r = await fetch(`${backend}/api/market`, {signal:AbortSignal.timeout(60000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    previous = (await r.json()).meta?.data || null;
  } catch (error) { console.log(`::warning title=Previous meta::${error.message}; metadata upload skipped to keep the kill history.`); }
  let kills = null, jumps = null;
  try {
    [kills, jumps] = (await Promise.all([esi('/universe/system_kills/'), esi('/universe/system_jumps/')])).map(r => r.body);
    const activity = {};
    for (const k of kills) if (!map || map.systems[k.system_id]?.[1] > 0) activity[k.system_id] = [k.ship_kills + k.pod_kills, k.npc_kills, 0];
    for (const j of jumps) if (!map || map.systems[j.system_id]?.[1] > 0) (activity[j.system_id] ||= [0, 0, 0])[2] = j.ship_jumps;
    meta.activity = activity;
  } catch (error) { kills = jumps = null; console.log(`::warning title=Activity::${error.message}; kill and traffic history carried forward.`); }
  Object.assign(meta, history(previous, kills, jumps, Date.now()));

  const SKILLS = {accounting:'Accounting', brokerRelations:'Broker Relations', industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production',
    advancedMassProduction:'Advanced Mass Production', science:'Science', labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research',
    astrometrics:'Astrometrics', rangefinding:'Astrometric Rangefinding', pinpointing:'Astrometric Pinpointing', acquisition:'Astrometric Acquisition', hacking:'Hacking', archaeology:'Archaeology',
    survey:'Survey', cpuManagement:'CPU Management', covertOps:'Covert Ops', cloaking:'Cloaking', amarrFrigate:'Amarr Frigate', caldariFrigate:'Caldari Frigate', gallenteFrigate:'Gallente Frigate', minmatarFrigate:'Minmatar Frigate'};
  const skillIds = (await esi('/universe/ids/?language=en', {method:'POST', body:JSON.stringify(Object.values(SKILLS))})).body.inventory_types || [];
  meta.skills = Object.fromEntries(Object.entries(SKILLS).map(([key, label]) => [key, skillIds.find(s => s.name === label)?.id]));

  await pool(scan, 24, async id => {
    try { const t = (await esi(`/universe/types/${id}/`)).body; meta.types[id] = {n:t.name, v:t.packaged_volume || t.volume || 0}; }
    catch (error) { console.warn(`type ${id}: ${error.message}`); }
  });

  const regions = [...new Set([...HUBS, ...pilotRegions])];

  for (const region of regions) {
    const name = (await esi(`/universe/regions/${region}/`)).body.name;
    if (HUBS.includes(region)) meta.regions[region] = name; // meta is public; pilot regions would say where pilots fly
    const types = {}, stations = new Map();
    await pool(scan, 24, async id => {
      try {
        const [orders, history] = await Promise.all([
          allPages(`/markets/${region}/orders/?order_type=all&type_id=${id}`),
          esi(`/markets/${region}/history/?type_id=${id}`).then(r => r.body).catch(() => [])
        ]);
        const result = aggregate(orders, history);
        for (const [loc, system] of result.systems) stations.set(loc, system);
        if (result.s.length || result.b.length) types[id] = {d:result.d, p:result.p, s:result.s, b:result.b};
      } catch (error) { console.warn(`${name} ${id}: ${error.message}`); }
    });
    const names = new Map();
    const locs = [...stations.keys()];
    for (let i = 0; i < locs.length; i += 1000) (await esi('/universe/names/', {method:'POST', body:JSON.stringify(locs.slice(i, i + 1000))})).body.forEach(r => names.set(r.id, r.name));
    const data = {name, generatedAt:new Date().toISOString(), types, stations:Object.fromEntries(locs.map(loc => [loc, [stations.get(loc), names.get(loc) || `Station ${loc}`]]))};
    const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region, data})});
    if (!stored.ok) throw new Error(`Upload for ${name} failed: HTTP ${stored.status} ${await stored.text()}`);
    report.push(`${name} ${Object.keys(types).length} items/${locs.length} stations`);
    console.log(`${name}: ${Object.keys(types).length} items across ${locs.length} stations.`);
  }
  if (map) {
    const names = new Map();
    const ids = map.stations.map(s => s[0]);
    for (let i = 0; i < ids.length; i += 1000) (await esi('/universe/names/', {method:'POST', body:JSON.stringify(ids.slice(i, i + 1000))})).body.forEach(r => names.set(r.id, r.name));
    map.stations = map.stations.map(s => [...s, names.get(s[0]) || `Station ${s[0]}`]);
    const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region:1, data:map})});
    if (!stored.ok) throw new Error(`Universe upload failed: HTTP ${stored.status} ${await stored.text()}`);
    report.push(`map ${Object.keys(map.systems).length} systems/${Object.keys(map.regions).length} regions/${map.stations.length} stations (${map.stations.filter(s => s[2] & 1).length} factories, ${map.stations.filter(s => s[2] & 2).length} labs), ${(JSON.stringify(map).length / 1e6).toFixed(2)} MB`);
  }
  // shortcut: a read that keeps failing freezes meta at the last good run; shrink /api/market if that happens.
  if (previous === undefined) throw new Error('Metadata not uploaded: the previous snapshot could not be read.');
  const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region:0, data:meta})});
  if (!stored.ok) throw new Error(`Metadata upload failed: HTTP ${stored.status} ${await stored.text()}`);
  // Annotations show up in the run summary, so a failed scan is visible without opening the log.
  console.log(`::notice title=Market snapshot::${wanted.size} watchlist items, ${Object.keys(meta.recipes).length} recipes, ${meta.starters.length} starter blueprints, ${(meta.ores || []).length} ores, ${Object.keys(meta.activity || {}).length} active systems, kill history for ${Object.keys(meta.risk?.s || {}).length} systems, traffic history for ${Object.keys(meta.traffic?.s || {}).length}, ${meta.combat?.sb.length ?? 0} smartbombs/${meta.combat?.dictor.length ?? 0} interdictors, ${scan.length} items scanned, ${pilotSystems.length} pilot locations${stats.limited ? `, ${stats.limited} rate-limit waits` : ''}. ${report.join('; ')}`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
