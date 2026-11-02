// Loading both pilots: public profile, private backend record or shared snapshot, wingmate summary and holdings.
import {S, mine, summary, assetsOf} from './state.js';
import {esi, corporation, resolveNames, loadSkillGroups, loadPrices, loadAssetCategories} from './esi.js';
import {$, notice} from './shared.js';

function referencedIds(p) {
  const o = p.ops || {}, v = key => o[key]?.value;
  return [
    ...(p.queue || []).map(q => q.skill_id), ...(p.skills?.skills || []).map(s => s.skill_id),
    v('ship')?.ship_type_id, v('location')?.solar_system_id, v('location')?.station_id,
    ...(v('jobs') || []).flatMap(j => [j.product_type_id, j.blueprint_type_id]),
    ...(v('transactions') || []).flatMap(t => [t.type_id, t.location_id]),
    ...(v('implants') || []), v('clones')?.home_location?.location_id,
    ...(v('clones')?.jump_clones || []).flatMap(c => [c.location_id, ...(c.implants || [])])
  ];
}
async function loadProfile(p) {
  try {
    p.profile = await esi(`characters/${p.id}/`);
    p.corp = await corporation(p.profile.corporation_id);
    try {
      const history = await esi(`characters/${p.id}/corporationhistory/`);
      p.career = await Promise.all(history.filter(item => !item.is_deleted).sort((a,b) => b.start_date.localeCompare(a.start_date)).slice(0,6).map(async item => ({...item, name:(await corporation(item.corporation_id)).name})));
      delete p.careerError;
    } catch (error) { p.careerError = error.message; }
  } catch (error) { p.error = `Public profile: ${error.message}`; }
}
async function loadPrivate(p, force, shared) {
  p.shared = shared.find(row => row.characterId === p.id) || null;
  if (S.backend?.has(p.id)) {
    try {
      const record = await S.backend.privatePilot(p.id, force);
      // A disconnect during the request must not restore private data.
      if (!S.backend.has(p.id)) return;
      Object.assign(p, {skills:record.skills, queue:record.queue, ops:record.operations || {}, synced:record.fetchedAt, private:true});
      if (record.lastError) p.error = record.lastError;
      return;
    } catch (error) { p.error = error.message; }
  }
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, ops:undefined, synced:p.shared?.fetchedAt, private:false});
  if (p.shared?.stale && !p.error) p.error = 'The shared training snapshot could not be refreshed. This pilot may need to reconnect.';
}
// render() redraws the page; it runs at the start (to show "refreshing") and once everything has settled.
export async function loadPilots(force, render) {
  const request = ++S.generation;
  const statusTask = esi('status/').then(value => { S.universeStatus = {...value, fetched:Date.now()}; }).catch(() => { if (S.universeStatus) S.universeStatus.stale = true; });
  const sharedTask = S.backend ? S.backend.publicPilots().catch(error => { notice(`Shared training snapshots: ${error.message}`); return []; }) : Promise.resolve([]);
  const next = S.config.pilots.map(n => ({...S.pilots.find(p => p.name.toLowerCase() === n.toLowerCase()), name:n, error:null, refreshing:true}));
  S.pilots = next;
  $('#refresh').disabled = true; $('#refresh').setAttribute('aria-busy', 'true');
  $('#sync-status').textContent = 'Syncing…';
  render();
  let ok = false;
  try {
    const result = next.length ? await esi('universe/ids/?language=en', {method:'POST', body:JSON.stringify(next.map(p => p.name))}) : {};
    const shared = await sharedTask;
    await Promise.all(next.map(async p => {
      const match = (result.characters || []).find(c => c.name.toLowerCase() === p.name.toLowerCase());
      if (!match) { p.error = 'Character not found. Check the exact name in config.json.'; return; }
      p.id = match.id; p.name = match.name;
      await Promise.all([loadProfile(p), loadPrivate(p, force, shared)]);
      p.queue?.sort((a,b) => a.queue_position - b.queue_position);
    }));
    if (request !== S.generation) return false;
    try { await resolveNames(next.flatMap(referencedIds)); } catch { notice('Some EVE names could not be loaded. IDs are shown instead.'); }
    await loadWing();
    if (next.some(p => p.skills?.skills) || [...S.wing.values()].some(w => w.skills?.skills)) await loadSkillGroups();
    await loadHoldings();
    $('#sync-status').textContent = `Synced ${new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`;
    ok = true;
  } catch (error) {
    if (request !== S.generation) return false;
    next.forEach(p => p.error = error.message);
    $('#sync-status').textContent = 'Refresh failed. Previously loaded data is kept; press Refresh to retry.';
  } finally {
    await statusTask;
    if (request === S.generation) { next.forEach(p => p.refreshing = false); $('#refresh').disabled = false; $('#refresh').removeAttribute('aria-busy'); render(); }
  }
  return ok;
}
async function loadWing() {
  const holder = [mine(), ...S.pilots].find(p => p?.id && S.backend?.has(p.id));
  if (!holder) { S.wing = new Map(); return; }
  try { S.wing = new Map((await S.backend.wing(holder.id)).map(row => [row.characterId, row])); }
  catch (error) { notice(`Wingmate summary: ${error.message}`); }
}
// Value assets, then name and categorize the top holdings that the Wing screen shows.
async function loadHoldings() {
  if (!S.pilots.some(p => assetsOf(p))) return;
  await loadPrices();
  const top = S.pilots.flatMap(p => summary(p).holdings?.rows.slice(0, 60).map(r => r.type) || []);
  try { await Promise.all([resolveNames(top), loadAssetCategories(top)]); } catch { /* Names fall back to IDs. */ }
}
// The wing summary also carries the pilot's own figures, so drop it with their session.
function forgetWing(id) {
  S.wing.delete(id);
  if (!S.pilots.some(p => p.id && S.backend?.has(p.id))) S.wing = new Map();
}
export function clearPrivate(p) {
  forgetWing(p.id);
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, synced:p.shared?.fetchedAt, ops:undefined, private:false});
}
