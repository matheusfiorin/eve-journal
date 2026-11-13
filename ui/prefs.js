// A pilot's small settings that outlive a visit: systems marked scanned (Explore) and the Haul plan. This browser's
// copy is the working copy; with journal sync on, journalsync.js merges it with the pilot's copy on the wing backend.
// Every change, here, from another tab or from sync, fires 'pref-change' {name, remote} so screens re-read.
import {ageMarks} from './syncplan.js';

export const PREFS = {explored:'eve-explored:v1', haul:'eve-haul:v1'};
export function readPref(name) { try { return JSON.parse(localStorage.getItem(PREFS[name])) || {}; } catch { return {}; } }
export function writePref(name, value, remote = false) {
  try { localStorage.setItem(PREFS[name], JSON.stringify(value)); } catch { /* Not remembered in this browser. */ }
  document.dispatchEvent(new CustomEvent('pref-change', {detail:{name, remote}}));
}
window.addEventListener('storage', event => {
  const name = Object.keys(PREFS).find(n => PREFS[n] === event.key);
  if (name) document.dispatchEvent(new CustomEvent('pref-change', {detail:{name, remote:true}}));
});

// Scanned systems {systemId: ms}, without marks older than 90 days (see ageMarks).
export const explored = () => ageMarks(readPref('explored'));
export function markExplored(id) { writePref('explored', {...explored(), [id]:Date.now()}); }

// The Haul plan {stops, value, volume, avoid, updatedAt}. Planning saves the form every time; updatedAt only moves
// when a person changed it (touched), so a device showing its defaults or an unchanged plan never wins over a newer
// plan from another device.
export const haulSaved = () => readPref('haul');
export function haulSave(plan, touched) {
  const saved = haulSaved(), {updatedAt = 0, ...was} = saved;
  if (JSON.stringify(was) === JSON.stringify(plan)) return;
  writePref('haul', {...plan, updatedAt:touched ? Date.now() : updatedAt});
}
