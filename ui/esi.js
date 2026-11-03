// Public HTTP: ESI, name lookups, skill groups, prices and asset categories (all cached in state.js maps).
import {S, SKILL_GROUPS, CATS, names, corporations, typeGroup, assetCats} from './state.js';

export async function json(url, options = {}) {
  let response;
  try { response = await fetch(url, {...options, signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Connection unavailable or timed out. Check your connection and try again.'); }
  if (!response.ok) {
    const error = new Error(response.status === 429 || response.status === 420 ? 'EVE API rate limit reached. Wait before refreshing again.' : `The service returned ${response.status}. Please try again later.`);
    error.status = response.status; throw error;
  }
  return response.json();
}
export const esi = (path, options = {}) => json(`https://esi.evetech.net/latest/${path}`, {...options, headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})}});

export const name = id => names.get(id) || `#${id}`;
export const isStation = id => id >= 60000000 && id < 64000000;
export const place = (id, type) => isStation(id) || type === 'station' ? name(id) : 'Player structure';

async function nameChunk(ids) {
  try { (await esi('universe/names/', {method:'POST', body:JSON.stringify(ids)})).forEach(row => names.set(row.id, row.name)); }
  catch (error) {
    // One unknown ID makes ESI reject the whole batch (404), so split to isolate it; other errors are real outages.
    if (error.status !== 404 || ids.length === 1) throw error;
    const mid = ids.length >> 1;
    await Promise.all([nameChunk(ids.slice(0, mid)), nameChunk(ids.slice(mid))].map(task => task.catch(() => {})));
  }
}
export async function resolveNames(ids) {
  const missing = [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0 && id < 2147483647 && !names.has(id));
  for (let i = 0; i < missing.length; i += 500) await nameChunk(missing.slice(i, i + 500));
}
function setGroups(groups) {
  for (const group of groups) for (const type of group.types || []) typeGroup.set(type, group.name);
}
export async function loadSkillGroups() {
  if (typeGroup.size) return;
  try {
    const cached = JSON.parse(localStorage.getItem(SKILL_GROUPS) || 'null');
    if (cached?.at > Date.now() - 7 * 86400000 && Array.isArray(cached.groups)) return setGroups(cached.groups);
  } catch { /* A broken cache is refetched. */ }
  try {
    const category = await esi('universe/categories/16/');
    const groups = (await Promise.all(category.groups.map(id => esi(`universe/groups/${id}/`)))).filter(g => g.published !== false).map(g => ({name:g.name, types:g.types}));
    setGroups(groups);
    try { localStorage.setItem(SKILL_GROUPS, JSON.stringify({at:Date.now(), groups})); } catch { /* Cache is optional. */ }
  } catch { /* Skills still render, ungrouped. */ }
}
export function corporation(id) {
  if (!corporations.has(id)) corporations.set(id, esi(`corporations/${id}/`).catch(error => { corporations.delete(id); throw error; }));
  return corporations.get(id);
}
// Concurrent callers share one in-flight request (S.pricesTask); Refresh clears it with S.prices.
export async function loadPrices() {
  if (S.prices) return;
  const task = S.pricesTask ||= esi('markets/prices/').then(rows => {
    if (S.pricesTask !== task) return;
    S.prices = new Map(rows.map(r => [r.type_id, r.average_price || r.adjusted_price || 0]));
    S.adjusted = new Map(rows.map(r => [r.type_id, r.adjusted_price || 0]));
  }).catch(() => { if (S.pricesTask === task) S.pricesTask = null; /* Asset values stay unknown; the next call retries. */ });
  await task;
}
export async function loadAssetCategories(ids) {
  const missing = [...new Set(ids.filter(id => !assetCats.has(id)))], groups = new Map(), categories = new Map();
  // Four lookups at a time: up to 120 types otherwise all hit ESI at once.
  const queue = missing.values();
  await Promise.all(Array.from({length:Math.min(4, missing.length)}, async () => { for (const id of queue) {
    try {
      const type = await esi(`universe/types/${id}/`);
      if (!groups.has(type.group_id)) groups.set(type.group_id, esi(`universe/groups/${type.group_id}/`));
      const group = await groups.get(type.group_id);
      if (!categories.has(group.category_id)) categories.set(group.category_id, esi(`universe/categories/${group.category_id}/`));
      assetCats.set(id, (await categories.get(group.category_id)).name);
    } catch { /* Shown as uncategorized. */ }
  } }));
  try { localStorage.setItem(CATS, JSON.stringify([...assetCats])); } catch { /* Cache is optional. */ }
}
