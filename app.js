// Echelon entry: boot, one render map, routing and the cross-screen listeners. Screens live in ui/screens/.
import {BackendClient} from './backend.js';
import {JournalStore} from './storage.js';
import {S, KEY, ME, home, counters} from './ui/state.js';
import {json} from './ui/esi.js';
import {$, countUps, notice, toast, pilotOptions, landOn} from './ui/shared.js';
import {loadPilots, clearPrivate, dataTime, STALE_MS, syncStatus} from './ui/pilots.js';
import * as routes from './ui/routes.js';
import * as mapmodal from './ui/mapmodal.js';
import * as hero from './ui/hero.js';
import * as installhint from './ui/installhint.js';
import * as shell from './ui/shell.js';
import * as journalsync from './ui/journalsync.js';
import * as bridge from './ui/screens/bridge.js';
import * as wing from './ui/screens/wing.js';
import * as pilot from './ui/screens/pilot.js';
import {markup as earnMarkup} from './ui/screens/earn-markup.js';
import * as jobs from './ui/screens/jobs.js';
import {markup as mapMarkup} from './ui/screens/starmap-markup.js';
import {markup as haulMarkup} from './ui/screens/navigate-markup.js';
import * as ledger from './ui/screens/ledger.js';
import * as logbook from './ui/screens/logbook.js';

// The small screens load with the page. Earn and Navigate (the planners, the Star map and its drawing, gesture and state
// code) load on the first visit to one of their views, or when the page is idle, so the first paint doesn't wait for them.
// Every screen's markup is in the page from the start either way.
// A page that only runs in its own window: framed by another site it could be made to look like something else, so it
// refuses to render (the Worker's own pages send frame-ancestors 'none'; a meta CSP cannot).
if (window.top !== window.self) { document.body.replaceChildren(Object.assign(document.createElement('p'), {textContent: 'Echelon will not run inside another page. Open it in its own tab.'})); throw new Error('Framed'); }

const SCREENS = [bridge, wing, pilot, jobs, ledger, logbook];
const MARKUP = [bridge.markup, wing.markup, pilot.markup, earnMarkup, jobs.markup, mapMarkup, haulMarkup, ledger.markup, logbook.markup];
const LOADERS = {earn:() => import('./ui/screens/earn.js'), navigate:() => import('./ui/screens/navigate.js')};
const LOADED = {}, LOADING = {};
// Load a lazy screen's code once, then run its wire(), as the eager screens' wire() runs at boot.
const load = key => LOADING[key] ||= LOADERS[key]().then(module => { LOADED[key] = module; module.wire?.(); return module; }, error => { delete LOADING[key]; throw error; });
const lazy = (key, name) => (...args) => LOADED[key]?.[name](...args);
const VIEW_CODE = {industry:'earn', mining:'earn', exploration:'earn', market:'earn', planets:'earn', sell:'earn', map:'navigate', hauling:'navigate'};
const RENDER = {
  bridge:bridge.render, strengths:wing.renderCrew, goals:wing.renderGoals,
  training:pilot.renderTraining, skills:pilot.renderSkills, clones:pilot.renderClones,
  industry:lazy('earn', 'renderIndustry'), mining:lazy('earn', 'renderMining'), exploration:lazy('earn', 'renderExploration'), market:lazy('earn', 'renderMarket'), planets:lazy('earn', 'renderPlanets'), sell:lazy('earn', 'renderSell'), jobs:jobs.render,
  map:lazy('navigate', 'renderMap'), hauling:lazy('navigate', 'renderHauling'), ledger:ledger.render, logbook:logbook.render
};
// Views that load market data or rank the whole map draw only while they're on screen (Bridge and the crew map
// score mining, industry and exploration, which is too heavy to redo for every hidden view).
const LAZY = new Set(['bridge', 'strengths', 'industry', 'mining', 'exploration', 'market', 'planets', 'sell', 'map', 'hauling']);

function renderAll() {
  shell.renderStrip(); hero.renderMe(); pilotOptions();
  const shown = shell.currentView();
  for (const [id, render] of Object.entries(RENDER)) if (!LAZY.has(id) || id === shown) render();
  if (!$('#hero').hidden) hero.renderHero();
  countUps();
}
// focus: a person asked for this view (not the boot), so move focus there and announce it.
let wanted = 0;
function selectTab(key, focus = false) {
  const id = shell.resolve(key);
  if (!id) return;
  // First visit to a lazy screen: fetch its code, then come back. The newest request wins if someone moves on meanwhile.
  const code = VIEW_CODE[id];
  if (code && !LOADED[code]) {
    const mine = ++wanted;
    load(code).then(() => { if (mine === wanted) selectTab(key, focus); }, error => notice(`Couldn’t load this screen: ${error.message}`));
    return;
  }
  wanted++;
  const viaTabs = Boolean(document.activeElement?.closest('#viewbar [role=tab]'));
  shell.mark(id);
  const next = document.getElementById(id);
  document.querySelectorAll('.view').forEach(s => { if (s !== next) s.hidden = true; });
  if (next.hidden) { next.hidden = false; next.classList.remove('view--enter'); void next.offsetWidth; next.classList.add('view--enter'); }
  history.replaceState(null, '', `${location.pathname}${location.search}#${shell.hashOf(id)}${shell.hashQuery(id)}`);
  RENDER[id]();
  next.querySelectorAll('[data-count]').forEach(el => counters.delete(el.dataset.key));
  countUps();
  if (focus) landOn(id, viaTabs);
}
function expireSessions() {
  if (!S.backend) return;
  const expired = S.backend.expire();
  if (!expired.length) return;
  for (const id of expired) { const p = S.pilots.find(p => p.id === id); if (p) { clearPrivate(p); p.problem = {kind:'expired', message:'Sign-in expired.'}; } }
  renderAll(); syncStatus(dataTime());
}

document.addEventListener('go', event => selectTab(event.detail, true));
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.go) selectTab(b.dataset.go, true);
    if (b.id === 'switch-pilot') hero.openHero();
    if (b.dataset.retry !== undefined) $('#refresh').click();
    if (b.dataset.connect !== undefined) {
      const p = S.pilots[Number(b.dataset.connect)];
      if (!S.backend || !p?.id) throw new Error('Wait for the pilot lookup before connecting.');
      location.assign(S.backend.connect(p.id));
    }
    if (b.dataset.disconnect) {
      const id = Number(b.dataset.disconnect);
      if (!confirm('Disconnect this pilot, remove the stored EVE authorization, and stop sharing their training?')) return;
      await S.backend.disconnect(id);
      const p = S.pilots.find(p => p.id === id); if (p) { p.shared = null; clearPrivate(p); }
      renderAll();
    }
    // Delete my data: removes everything the backend stores about this pilot (journal, settings, EVE authorization, sessions).
    if (b.dataset.forget) {
      const id = Number(b.dataset.forget);
      if (!confirm('Delete all of this pilot’s data from the backend?\n\nThis removes their journal entries, settings, stored EVE authorization and every signed-in device. It cannot be undone. Wing goals shared with your wingmate stay. Entries saved in this browser stay too.')) return;
      if (prompt('Type DELETE to confirm.') !== 'DELETE') return;
      await S.backend.forget(id);
      const p = S.pilots.find(p => p.id === id); if (p) { p.shared = null; clearPrivate(p); }
      renderAll(); notice('Your data was deleted from the backend.');
    }
  } catch (error) { notice(error.message); }
});
$('#refresh').onclick = async () => {
  S.marketData = null; S.costIndices = null; S.prices = null; S.marketTask = S.pricesTask = S.costTask = null;
  if (await loadPilots(true, renderAll)) toast(`Refreshed. EVE data from ${new Date(dataTime() || Date.now()).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`, 'ok');
};
// Opening the page, or coming back to it, shows the last snapshot at once; if that is more than 10 minutes old, sync
// this browser's pilots in the background (the Worker skips a pilot synced in the last minute).
let autoSynced = 0;
async function syncIfStale() {
  if (!S.backend || !S.pilots.some(p => p.id && S.backend.has(p.id)) || Date.now() - autoSynced < STALE_MS) return;
  const at = dataTime();
  if (at && Date.now() - at < STALE_MS) return;
  autoSynced = Date.now();
  await loadPilots(true, renderAll);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { expireSessions(); syncIfStale(); } });
setInterval(expireSessions, 30000);
// Another tab connected, reconnected or disconnected a pilot: adopt its sessions and show what they unlock.
window.addEventListener('storage', event => {
  if (!S.backend || (event.key !== S.backend.key && event.key !== null)) return;
  const before = JSON.stringify([...S.backend.sessions]);
  if (JSON.stringify([...S.backend.reload()]) === before) return;
  for (const p of S.pilots) if (p.id && p.private && !S.backend.has(p.id)) clearPrivate(p);
  loadPilots(false, renderAll).then(() => journalsync.sync());
});

async function init() {
  shell.build();
  for (const markup of MARKUP) for (const [id, html] of Object.entries(markup)) document.getElementById(id).innerHTML = html;
  try { S.store = new JournalStore(localStorage, KEY); S.data = S.store.load(); }
  catch (error) {
    S.store ||= {locked:true, save() { throw new Error('Browser storage is unavailable.'); }};
    notice(error.message);
  }
  try {
    S.config = await json('./config.json');
    if (!Array.isArray(S.config.pilots) || S.config.pilots.length > 2 || S.config.pilots.some(p => typeof p !== 'string' || !p.trim())) throw new Error('config.json has an invalid pilot list.');
  } catch (error) { S.config = {pilots:['Fiofka','Decxus']}; notice(`Using default pilots. ${error.message}`); }
  if (S.config.backendUrl) {
    try {
      S.backend = new BackendClient(S.config.backendUrl);
      if (S.backend.acceptRedirect(location.hash)) { history.replaceState(null, '', home); notice('Pilot connected. Training is shared and private data is now available.'); }
    } catch (error) { if (location.hash.includes('backend_session')) history.replaceState(null, '', home); notice(error.message); }
  }
  for (const module of [routes, mapmodal, shell, journalsync, installhint, ...SCREENS]) module.wire?.();
  hero.wire(() => { selectTab('bridge'); renderAll(); shell.boot(); landOn('bridge'); }, () => { renderAll(); shell.boot(); });
  // Populate selects before restoring an existing author in a draft.
  S.pilots = S.config.pilots.map(n => ({name:n})); pilotOptions(); logbook.resetEntry(true);
  try { S.me = localStorage.getItem(ME); } catch { /* Ask again. */ }
  if (!S.config.pilots.includes(S.me)) { S.me = null; hero.openHero(); } else shell.boot();
  hero.renderMe();
  // A link straight to a lazy screen (#navigate/map?r=…) waits for its code, so the address is read before it's rewritten.
  const first = shell.resolve(location.hash.slice(1)) || 'bridge';
  if (VIEW_CODE[first]) await load(VIEW_CODE[first]).catch(error => notice(`Couldn’t load this screen: ${error.message}`));
  selectTab(first);
  // Everything else the user is likely to open next loads when the browser has nothing better to do.
  for (const key of Object.keys(LOADERS)) {
    const fetchIt = () => load(key).catch(() => {});
    if (window.requestIdleCallback) requestIdleCallback(fetchIt, {timeout:4000}); else setTimeout(fetchIt, 1500);
  }
  logbook.restoreDraft();
  wing.restoreGoalDraft();
  if (await loadPilots(false, renderAll)) { journalsync.sync(); await syncIfStale(); } else journalsync.render();
}
await init();
