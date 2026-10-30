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
const HUBS = [10000002, 10000043, 10000032, 10000030, 10000042]; // The Forge, Domain, Sinq Laison, Heimatar, Metropolis
const SDE = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const HEADERS = {Accept:'application/json', 'User-Agent':'eve-journal market pipeline (github.com/matheusfiorin/eve-journal)'};
const TOP = 6;
const isStation = id => id >= 60000000 && id < 64000000;

// Keep the cheapest sells and richest buys per NPC station; player structures may refuse docking.
export function aggregate(orders, history = []) {
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
  const recent = history.slice(-7);
  return {
    d: recent.length ? Math.round(recent.reduce((t, h) => t + h.volume, 0) / recent.length) : 0,
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
      m:job.materials.map(m => [id(m), m.quantity]), score:(value - cost) / job.time});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({score, ...s}) => s);
}
// Known space only: gate graph with security, plus NPC stations that offer manufacturing (1) or research (2).
export function universe({mapSolarSystems, mapStargates, npcStations, stationOperations, stationServices}) {
  const service = name => stationServices.find(s => sdeName(s.serviceName) === name)?._key;
  const factory = service('Factory'), lab = service('Laboratory');
  const systems = {};
  for (const s of mapSolarSystems) if (s._key < 31000000) systems[s._key] = [sdeName(s.name), Math.round(s.securityStatus * 1000) / 1000, s.regionID, []];
  for (const gate of mapStargates) {
    const from = systems[gate.solarSystemID], to = gate.destination?.solarSystemID;
    if (from && systems[to] && !from[3].includes(to)) from[3].push(to);
  }
  const services = new Map(stationOperations.map(o => [o._key, new Set(o.services || [])]));
  const stations = [];
  for (const st of npcStations) {
    const has = services.get(st.operationID) || new Set();
    const flags = (has.has(factory) ? 1 : 0) | (has.has(lab) ? 2 : 0);
    if (flags && systems[st.solarSystemID]) stations.push([st._key, st.solarSystemID, flags]);
  }
  return {systems, stations};
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
    const data = await sde(['blueprints', 'types', 'groups', 'categories', 'mapSolarSystems', 'mapStargates', 'npcStations', 'stationOperations', 'stationServices']);
    try {
      map = universe(data);
      const linked = Object.values(map.systems).filter(s => s[3].length).length;
      if (!linked || !map.stations.length) throw new Error(`parsed ${linked} linked systems and ${map.stations.length} stations; sample system keys: ${Object.keys(data.mapSolarSystems[0] || {}).join(',')}; sample station keys: ${Object.keys(data.npcStations[0] || {}).join(',')}`);
    } catch (error) { map = null; console.log(`::warning title=Universe map::${error.message}`); }
    meta.recipes = recipes(data.blueprints, wanted);
    const prices = new Map((await esi('/markets/prices/')).body.map(p => [p.type_id, {average:p.average_price || p.adjusted_price || 0, adjusted:p.adjusted_price}]));
    meta.starters = starters(data.blueprints, byKey(data.types), byKey(data.groups), byKey(data.categories), prices);
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
  const scan = [...new Set([...wanted, ...Object.values(meta.recipes).flatMap(r => r.m.map(([id]) => id)), ...meta.starters.flatMap(s => [s.type, ...s.m.map(([id]) => id)])])];

  const SKILLS = {accounting:'Accounting', brokerRelations:'Broker Relations', industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production',
    advancedMassProduction:'Advanced Mass Production', science:'Science', labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research'};
  const skillIds = (await esi('/universe/ids/?language=en', {method:'POST', body:JSON.stringify(Object.values(SKILLS))})).body.inventory_types || [];
  meta.skills = Object.fromEntries(Object.entries(SKILLS).map(([key, label]) => [key, skillIds.find(s => s.name === label)?.id]));

  await pool(scan, 24, async id => {
    try { const t = (await esi(`/universe/types/${id}/`)).body; meta.types[id] = {n:t.name, v:t.packaged_volume || t.volume || 0}; }
    catch (error) { console.warn(`type ${id}: ${error.message}`); }
  });

  const regions = [...new Set([...HUBS, ...pilotRegions])];

  for (const region of regions) {
    const name = (await esi(`/universe/regions/${region}/`)).body.name;
    meta.regions[region] = name;
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
    report.push(`map ${Object.keys(map.systems).length} systems/${map.stations.filter(s => s[2] & 1).length} factories/${map.stations.filter(s => s[2] & 2).length} labs`);
  }
  const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region:0, data:meta})});
  if (!stored.ok) throw new Error(`Metadata upload failed: HTTP ${stored.status} ${await stored.text()}`);
  // Annotations show up in the run summary, so a failed scan is visible without opening the log.
  console.log(`::notice title=Market snapshot::${wanted.size} watchlist items, ${Object.keys(meta.recipes).length} recipes, ${meta.starters.length} starter blueprints, ${scan.length} items scanned, ${pilotSystems.length} pilot locations${stats.limited ? `, ${stats.limited} rate-limit waits` : ''}. ${report.join('; ')}`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
