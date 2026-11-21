// Discord alerts. The cron reads both pilots' stored snapshots (no ESI calls), works out which events are new and posts
// one message each to DISCORD_WEBHOOK_URL. Only pilots who ticked the alerts box on the consent page (pilots.share_alerts) are included. The channel may be shared, so a message never names a place: no systems,
// stations or regions, only the pilot, what happened and the item. Without the secret none of this runs.
import {queueState} from '../model.js';
import {checkOrder, contractDue} from '../orders.js';
import {corpCandidates} from './corp.js';

const HOURS = ms => { const h = Math.max(1, Math.round(ms / 3600000)); return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`; };
// Posts per run: the sync that precedes them may have used up to SYNC_LIMIT of the free plan's 50 subrequests (worker/index.js).
export const MAX_ALERTS = 5;
export const WEBHOOK = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/;
const ACTIVITY = {1: 'manufacturing', 3: 'time research', 4: 'material research', 5: 'copy', 8: 'invention', 9: 'reaction', 11: 'reaction'};
// "Venture Blueprint" + copy -> "Venture blueprint copy"; manufacturing names the product.
function jobLabel(job, name) {
  const base = id => (name(id) || 'an item').replace(/ Blueprint$/, '');
  return job.activity_id === 1 ? `${name(job.product_type_id) || 'an item'} manufacturing` : `${base(job.blueprint_type_id)} blueprint ${ACTIVITY[job.activity_id] || 'job'}`;
}
const CONTRACT = {item_exchange: 'item exchange', courier: 'courier', auction: 'auction', loan: 'loan'};
const contract = type => CONTRACT[type] ? `${CONTRACT[type]} contract` : 'contract';
/** Every alert worth sending for these pilots right now: [{key, text}]. outbid(orders) gives each live order's market check, or null. */
export function candidates(pilots, {now = Date.now(), outbid = () => null} = {}) {
  const out = [];
  for (const {id, name: who, snapshot: snap} of pilots) {
    const ops = snap.operations || {}, names = snap.names || {}, nameOf = tid => names[tid] || null;
    const q = queueState(snap.queue);
    if (q?.kind === 'empty') out.push({key: `queue-empty:${id}:${new Date(now).toISOString().slice(0, 10)}`, text: `${who}'s skill queue is empty`});
    else if (q?.kind === 'ending') out.push({key: `queue-ending:${id}:${new Date(q.end).toISOString()}`, text: `${who}'s skill queue ends in ${HOURS(q.end - now)}`});
    for (const j of ops.jobs?.value || []) {
      if (j.status === 'ready' || (j.status === 'active' && Date.parse(j.end_date) <= now)) out.push({key: `job:${id}:${j.job_id}`, text: `${who}'s job (${jobLabel(j, nameOf)}) is ready`});
    }
    const orders = ops.orders?.value || [];
    const checks = outbid(orders) || [];
    orders.forEach((o, i) => { if (checks[i]?.state === 'outbid') out.push({key: `outbid:${id}:${o.order_id}:${o.price}`, text: `${who}'s ${o.is_buy_order ? 'buy' : 'sell'} order for ${nameOf(o.type_id) || 'an item'} was outbid`}); });
    for (const c of ops.contracts?.value || []) {
      const end = contractDue(c);
      if (end !== null && end > now && end - now < 86400000) out.push({key: `contract-expiring:${id}:${c.contract_id}`, text: `${who}'s ${contract(c.type)} expires in ${HOURS(end - now)}`});
    }
    // An extractor that ran out in the last three days; one message per planet and expiry, and no place name.
    for (const pl of ops.planets?.value?.planets || []) {
      const gone = (pl.pins?.ext || []).map(x => Date.parse(x[1])).filter(t => t <= now && now - t < 3 * 86400000);
      if (gone.length) out.push({key: `extractor:${id}:${pl.id}:${Math.max(...gone)}`, text: `${who}'s extractor on a ${String(pl.type || 'planetary').replace(/_/g, ' ')} planet expired`});
    }
    for (const e of snap.events || []) {
      const item = nameOf(e.type) || 'an item';
      if (e.kind === 'order-filled' || e.kind === 'order-expired') out.push({key: `${e.k}:${id}`, text: `${who}'s ${e.buy ? 'buy' : 'sell'} order for ${item} ${e.kind === 'order-filled' ? 'filled' : 'expired'}`});
      else if (e.kind === 'contract-accepted' || e.kind === 'contract-completed') out.push({key: `${e.k}:${id}`, text: `${who}'s ${contract(e.contract)} was ${e.kind === 'contract-accepted' ? 'accepted' : 'completed'}`});
      else if (e.kind === 'loss') out.push({key: `${e.k}:${id}`, text: `${who} lost a ${nameOf(e.type) || 'ship'}`});
    }
  }
  return out;
}
// The market rows an order check needs, read with SQLite's JSON functions so a region's megabytes stay in D1.
async function marketSlice(env, orders, now) {
  const regions = [...new Set(orders.map(o => o.region_id).filter(Number.isSafeInteger))], types = [...new Set(orders.map(o => o.type_id).filter(Number.isSafeInteger))].slice(0, 100);
  if (!regions.length || !types.length) return [];
  const cols = types.map((t, i) => `json_extract(data, '$.types."${t}"') AS c${i}`).join(', ');
  const rows = (await env.DB.prepare(`SELECT region_id, ${cols} FROM market_snapshots WHERE region_id IN (${regions.map(() => '?').join(',')}) AND updated_at > ?`).bind(...regions, now - 6 * 3600000).all()).results;
  return rows.map(r => ({region: r.region_id, data: {types: Object.fromEntries(types.map((t, i) => [t, (() => { try { return r[`c${i}`] ? JSON.parse(r[`c${i}`]) : undefined; } catch { return undefined; } })()]).filter(([, v]) => v))}}));
}
async function post(url, text, fetchImpl) {
  const r = await fetchImpl(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'User-Agent': 'Echelon wing console (Cloudflare Worker)'}, body: JSON.stringify({content: text, allowed_mentions: {parse: []}}), signal: AbortSignal.timeout(10000)});
  if (!r.ok) throw new Error(`webhook ${r.status}`);
}
// Corporation alerts (towers and structures from corp_snapshots), only for a corporation whose source pilot ticked the alerts box.
// A structure's own name is posted only if it holds no place, so the system names of the structures that alert are looked up in
// the stored gate map (SQLite reads the one entry; the Worker does not load the map).
async function corpAlerts(env, now) {
  const rows = (await env.DB.prepare('SELECT c.corporation_id, c.snapshot FROM corp_snapshots c JOIN pilots p ON p.character_id = c.source_pilot WHERE p.share_alerts = 1').all()).results;
  const out = [];
  for (const r of rows) {
    let snap; try { snap = JSON.parse(r.snapshot); } catch { continue; }
    const systems = [...new Set((snap.structures?.value || []).filter(s => s.name).map(s => s.system).filter(Number.isSafeInteger))].slice(0, 20), systemNames = {};
    for (const sys of systems) { const n = (await env.DB.prepare('SELECT json_extract(data, ?) AS name FROM market_snapshots WHERE region_id = 1').bind(`$.systems."${sys}"[0]`).first().catch(() => null))?.name; if (n) systemNames[sys] = n; }
    out.push(...corpCandidates(r.corporation_id, snap, {now, systemNames}));
  }
  return out;
}
/** Send what is new, at most MAX_ALERTS per run. A key is claimed before the post and released if it fails, so a retry is possible and a double run cannot double-post. */
export async function sendAlerts(env, fetchImpl = fetch, now = Date.now()) {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url) return {sent: 0, skipped: true};
  if (!WEBHOOK.test(url)) return {sent: 0, invalid: true};
  const rows = (await env.DB.prepare('SELECT character_id, name, snapshot FROM pilots WHERE share_alerts = 1').all()).results;
  const pilots = rows.map(r => { try { return {id: r.character_id, name: r.name, snapshot: JSON.parse(r.snapshot || '{}')}; } catch { return null; } }).filter(Boolean);
  const slices = new Map();
  for (const p of pilots) { const orders = p.snapshot.operations?.orders?.value; if (orders?.length) slices.set(p.id, await marketSlice(env, orders, now).catch(() => [])); }
  const all = [];
  for (const p of pilots) all.push(...candidates([p], {now, outbid: orders => orders.map(o => checkOrder(o, slices.get(p.id) || []))}));
  all.push(...await corpAlerts(env, now).catch(() => []));
  // D1's free plan allows 50 queries per invocation, so the known keys are read in a few chunked lookups (not one write per
  // old candidate) and only the first MAX_ALERTS new ones are claimed, in one batch.
  const known = new Set();
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90).map(a => a.key);
    for (const r of (await env.DB.prepare(`SELECT key FROM alerts WHERE key IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all()).results) known.add(r.key);
  }
  const fresh = [], seen = new Set();
  for (const a of all) if (!known.has(a.key) && !seen.has(a.key)) { seen.add(a.key); fresh.push(a); if (fresh.length >= MAX_ALERTS) break; }
  if (!fresh.length) return {sent: 0, failed: 0};
  const claims = await env.DB.batch(fresh.map(a => env.DB.prepare('INSERT OR IGNORE INTO alerts (key, sent_at) VALUES (?, ?)').bind(a.key, now)));
  const mine = fresh.filter((_, i) => claims[i]?.meta?.changes !== 0);
  let sent = 0, failed = 0;
  for (const {key, text} of mine) {
    try { await post(url, text, fetchImpl); sent++; }
    catch {
      failed++;
      const rest = mine.slice(mine.findIndex(a => a.key === key));
      await env.DB.batch(rest.map(a => env.DB.prepare('DELETE FROM alerts WHERE key = ?').bind(a.key)));
      break;
    }
  }
  return {sent, failed};
}
