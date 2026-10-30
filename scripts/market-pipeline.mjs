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

async function esi(path, options = {}, attempt = 0) {
  const response = await fetch(`${ESI}${path}`, {...options, headers:{...HEADERS, ...options.headers}, signal:AbortSignal.timeout(30000)});
  if (Number(response.headers.get('X-ESI-Error-Limit-Remain')) < 20) await new Promise(r => setTimeout(r, (Number(response.headers.get('X-ESI-Error-Limit-Reset')) || 10) * 1000));
  if ((response.status >= 500 || response.status === 420 || response.status === 429) && attempt < 3) {
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
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
async function sdeBlueprints() {
  const response = await fetch(SDE, {headers:HEADERS, signal:AbortSignal.timeout(300000)});
  if (!response.ok) throw new Error(`SDE download: HTTP ${response.status}`);
  const zip = join(await mkdtemp(join(tmpdir(), 'sde-')), 'sde.zip');
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  const entry = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').find(n => /(^|\/)blueprints\.jsonl$/.test(n.trim()));
  if (!entry) throw new Error('blueprints.jsonl is missing from the SDE');
  return execFileSync('unzip', ['-p', zip, entry.trim()], {maxBuffer:1024 * 1024 * 1024}).toString().split('\n').filter(Boolean).map(line => JSON.parse(line));
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

  const meta = {generatedAt:new Date().toISOString(), types:{}, recipes:{}, regions:{}};
  try {
    meta.recipes = recipes(await sdeBlueprints(), wanted);
    console.log(`Recipes: ${Object.keys(meta.recipes).length} manufacturable watchlist items.`);
  } catch (error) { meta.recipesError = `Blueprint data unavailable: ${error.message}`; console.log(`::warning title=Blueprints::${meta.recipesError}`); }
  const scan = [...new Set([...wanted, ...Object.values(meta.recipes).flatMap(r => r.m.map(([id]) => id))])];

  const skillIds = (await esi('/universe/ids/?language=en', {method:'POST', body:JSON.stringify(['Accounting','Broker Relations'])})).body.inventory_types || [];
  meta.skills = {accounting:skillIds.find(s => s.name === 'Accounting')?.id, brokerRelations:skillIds.find(s => s.name === 'Broker Relations')?.id};

  await pool(scan, 16, async id => {
    try { const t = (await esi(`/universe/types/${id}/`)).body; meta.types[id] = {n:t.name, v:t.packaged_volume || t.volume || 0}; }
    catch (error) { console.warn(`type ${id}: ${error.message}`); }
  });

  let pilotSystems = [];
  try { pilotSystems = (await (await api('/api/market/regions')).json()).systems || []; } catch (error) { console.warn(`Pilot regions: ${error.message}`); }
  const pilotRegions = await Promise.all(pilotSystems.map(async system => {
    const s = (await esi(`/universe/systems/${system}/`)).body;
    return (await esi(`/universe/constellations/${s.constellation_id}/`)).body.region_id;
  }));
  const regions = [...new Set([...HUBS, ...pilotRegions])];
  const report = [];

  for (const region of regions) {
    const name = (await esi(`/universe/regions/${region}/`)).body.name;
    meta.regions[region] = name;
    const types = {}, stations = new Map();
    await pool(scan, 16, async id => {
      try {
        const [orders, history] = await Promise.all([
          allPages(`/markets/${region}/orders/?order_type=all&type_id=${id}`),
          esi(`/markets/${region}/history/?type_id=${id}`).then(r => r.body).catch(() => [])
        ]);
        const result = aggregate(orders, history);
        for (const [loc, system] of result.systems) stations.set(loc, system);
        if (result.s.length || result.b.length) types[id] = {d:result.d, s:result.s, b:result.b};
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
  const stored = await api('/api/market/ingest', {method:'POST', body:JSON.stringify({region:0, data:meta})});
  if (!stored.ok) throw new Error(`Metadata upload failed: HTTP ${stored.status} ${await stored.text()}`);
  // Annotations show up in the run summary, so a failed scan is visible without opening the log.
  console.log(`::notice title=Market snapshot::${wanted.size} watchlist items, ${Object.keys(meta.recipes).length} recipes, ${pilotSystems.length} pilot locations. ${report.join('; ')}`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
