// Echelon entry: boot, one render map, routing and the cross-screen listeners. Screens live in ui/screens/.
import {BackendClient} from './backend.js';
import {JournalStore} from './storage.js';
import {S, KEY, ME, home, counters} from './ui/state.js';
import {json} from './ui/esi.js';
import {$, countUps, notice, toast, pilotOptions} from './ui/shared.js';
import {loadPilots, clearPrivate} from './ui/pilots.js';
import * as routes from './ui/routes.js';
import * as mapmodal from './ui/mapmodal.js';
import * as hero from './ui/hero.js';
import * as shell from './ui/shell.js';
import * as bridge from './ui/screens/bridge.js';
import * as wing from './ui/screens/wing.js';
import * as pilot from './ui/screens/pilot.js';
import * as earn from './ui/screens/earn.js';
import * as jobs from './ui/screens/jobs.js';
import * as navigate from './ui/screens/navigate.js';
import * as ledger from './ui/screens/ledger.js';
import * as logbook from './ui/screens/logbook.js';

const SCREENS = [bridge, wing, pilot, earn, jobs, navigate, ledger, logbook];
const RENDER = {
  bridge:bridge.render, strengths:wing.renderCrew, goals:wing.renderGoals,
  training:pilot.renderTraining, skills:pilot.renderSkills, clones:pilot.renderClones,
  industry:earn.renderIndustry, mining:earn.renderMining, exploration:earn.renderExploration, market:earn.renderMarket, jobs:jobs.render,
  map:navigate.renderMap, hauling:navigate.renderHauling, ledger:ledger.render, logbook:logbook.render
};
// Views that load market data draw only while they're on screen.
const LAZY = new Set(['industry', 'mining', 'exploration', 'market', 'map', 'hauling']);

function renderAll() {
  shell.renderStrip(); hero.renderMe(); pilotOptions();
  const shown = shell.currentView();
  for (const [id, render] of Object.entries(RENDER)) if (!LAZY.has(id) || id === shown) render();
  if (!$('#hero').hidden) hero.renderHero();
  countUps();
}
function selectTab(key) {
  const id = shell.resolve(key);
  if (!id) return;
  shell.mark(id);
  const next = document.getElementById(id);
  document.querySelectorAll('.view').forEach(s => { if (s !== next) s.hidden = true; });
  if (next.hidden) { next.hidden = false; next.classList.remove('view--enter'); void next.offsetWidth; next.classList.add('view--enter'); }
  history.replaceState(null, '', `${location.pathname}${location.search}#${shell.hashOf(id)}`);
  RENDER[id]();
  next.querySelectorAll('[data-count]').forEach(el => counters.delete(el.dataset.key));
  countUps();
}
function expireSessions() {
  if (!S.backend) return;
  const expired = S.backend.expire();
  if (!expired.length) return;
  for (const id of expired) { const p = S.pilots.find(p => p.id === id); if (p) clearPrivate(p); }
  renderAll(); notice('A pilot session expired. Connect again to see private data.');
}

document.addEventListener('go', event => selectTab(event.detail));
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.go) selectTab(b.dataset.go);
    if (b.id === 'switch-pilot') hero.openHero();
    if (b.dataset.connect !== undefined) {
      const p = S.pilots[Number(b.dataset.connect)];
      if (!S.backend || !p?.id) throw new Error('Wait for the pilot lookup before connecting.');
      location.assign(S.backend.authURL(p.id));
    }
    if (b.dataset.disconnect) {
      const id = Number(b.dataset.disconnect);
      if (!confirm('Disconnect this pilot, remove the stored EVE authorization, and stop sharing their training?')) return;
      await S.backend.disconnect(id);
      const p = S.pilots.find(p => p.id === id); if (p) { p.shared = null; clearPrivate(p); }
      renderAll();
    }
  } catch (error) { notice(error.message); }
});
$('#refresh').onclick = async () => {
  S.marketData = null; S.costIndices = null; S.prices = null; S.marketTask = S.pricesTask = S.costTask = null;
  if (await loadPilots(true, renderAll)) toast(`Refreshed. EVE data from ${new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`, 'ok');
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) expireSessions(); });
setInterval(expireSessions, 30000);

async function init() {
  shell.build();
  for (const screen of SCREENS) for (const [id, html] of Object.entries(screen.markup)) document.getElementById(id).innerHTML = html;
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
    } catch (error) { notice(error.message); }
  }
  for (const module of [routes, mapmodal, shell, ...SCREENS]) module.wire?.();
  hero.wire(() => { selectTab('bridge'); renderAll(); shell.boot(); });
  // Populate selects before restoring an existing author in a draft.
  S.pilots = S.config.pilots.map(n => ({name:n})); pilotOptions(); logbook.resetEntry(true);
  try { S.me = localStorage.getItem(ME); } catch { /* Ask again. */ }
  if (!S.config.pilots.includes(S.me)) { S.me = null; hero.openHero(); } else shell.boot();
  hero.renderMe();
  selectTab(shell.resolve(location.hash.slice(1)) || 'bridge');
  logbook.restoreDraft();
  await loadPilots(false, renderAll);
}
await init();
