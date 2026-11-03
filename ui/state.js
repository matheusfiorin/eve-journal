// Shared mutable state (ES modules can't reassign imported bindings, so everything that changes lives on S),
// the storage keys, and the pilot selectors every screen uses.
import {emptyData, pilotTitle, assetHoldings} from '../model.js';

export const KEY = 'eve-flight-journal:v1';
export const DRAFT = 'eve-flight-draft:v1';
export const SKILL_GROUPS = 'eve-skill-groups:v1';
export const ME = 'eve-me:v1';
export const CATS = 'eve-asset-categories:v1';
export const HUB_SYSTEMS = [[30000142,'Jita'],[30002187,'Amarr'],[30002659,'Dodixie'],[30002510,'Rens'],[30002053,'Hek']];
export const ROMAN = ['0','I','II','III','IV','V'];
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const home = new URL('./', location.href).href;

export const S = {
  config:{pilots:[]}, data:emptyData(), store:null, backend:null, universeStatus:null, generation:0,
  pilots:[], me:null, wing:new Map(),
  prices:null, adjusted:new Map(), marketData:null, marketBook:null, costIndices:null,
  marketTask:null, pricesTask:null, costTask:null, // in-flight loads, shared by concurrent callers
  // Navigate's Star map state (see ui/mapstate.js). layers: [{id, label, color, kind:'route'|'pins'|'trail'|'ring', ids}],
  // added by "Open in Star map"; linked: the address names this state (#navigate/map?r=…&s=…).
  map:{region:null, view:'region', overlay:'security', jump:'', selected:null, layers:[], viewBox:null, linked:false}
};
export const names = new Map(), corporations = new Map(), typeGroup = new Map(), assetCats = new Map(), counters = new Map();
try { JSON.parse(localStorage.getItem(CATS) || '[]').forEach(([id, cat]) => assetCats.set(id, cat)); } catch { /* Categories are refetched. */ }

export const mine = () => S.pilots.find(p => p.name === S.me) || null;
export const wingmate = () => S.pilots.find(p => p.name !== S.me) || null;
export const ordered = () => [...S.pilots].sort((a,b) => (b.name === S.me) - (a.name === S.me));
export const assetsOf = p => p.private ? p.ops?.assets?.value : S.wing.get(p.id)?.assets;
export function summary(p) {
  if (!p) return {};
  const w = S.wing.get(p.id);
  const skills = p.private ? p.skills : w?.skills || p.skills;
  const walletRaw = p.private ? p.ops?.wallet?.value : w?.wallet;
  const wallet = Number.isFinite(walletRaw) ? walletRaw : undefined;
  const holdings = assetsOf(p) && S.prices ? assetHoldings(assetsOf(p), S.prices) : null;
  const known = wallet !== undefined || holdings;
  return {skills, sp:skills?.total_sp, maxed:skills?.skills?.filter(s => s.trained_skill_level === 5).length, wallet, holdings,
    assets:holdings?.total, worth:known ? (wallet || 0) + (holdings?.total || 0) : undefined,
    title:skills?.skills ? pilotTitle(skills, id => typeGroup.get(id)) : null};
}
