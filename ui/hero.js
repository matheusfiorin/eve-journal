// The pilot picker: a starfield, two portrait plates joined by a tether, and the warp out into the console.
import {S, ME, reduced, counters, mine, summary} from './state.js';
import {$, esc, portrait} from './shared.js';

let starsFrame = 0, warp = false, onChoose = () => {};
export function renderMe() {
  const p = mine(), b = $('#switch-pilot');
  b.dataset.pilot = p ? p.name.toLowerCase() : '';
  b.setAttribute('aria-label', p ? `Switch pilot (${p.name} flying)` : 'Choose pilot');
  b.innerHTML = p ? `${portrait(p, 24, 'portrait--xs')}<span>${esc(p.name)}</span><svg class="ico" aria-hidden="true"><use href="#i-swap"/></svg>` : '<span>Choose pilot</span>';
  document.body.dataset.pilot = p ? p.name.toLowerCase() : '';
}
export function renderHero() {
  const plate = (p, i) => {
    const x = summary(p);
    return `<button class="hero-pilot plate" data-me="${esc(p.name)}" data-pilot="${esc(p.name.toLowerCase())}" style="--i:${i}">${portrait(p, 160, 'hero-portrait')}<b>${esc(p.name)}</b><small>${esc([x.title || 'Capsuleer', p.corp?.name].filter(Boolean).join(' · '))}</small></button>`;
  };
  const tether = '<svg class="tether" viewBox="0 0 120 20" aria-hidden="true"><line x1="0" y1="10" x2="120" y2="10"/><circle cx="60" cy="10" r="3"/></svg>';
  $('#hero-pilots').innerHTML = S.pilots.map(plate).join(tether);
}
function startStars() {
  cancelAnimationFrame(starsFrame);
  const canvas = $('#stars'), ctx = canvas.getContext('2d');
  const stars = Array.from({length:300}, (_, i) => ({x:Math.random() * 2 - 1, y:Math.random() * 2 - 1, z:Math.random(), violet:i % 12 === 0}));
  let speed = 0.002;
  const draw = () => {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; }
    const w = canvas.width, h = canvas.height;
    speed += ((warp ? 0.05 : 0.002) - speed) * 0.06;
    ctx.fillStyle = warp ? 'rgba(12,20,36,0.3)' : '#0C1424'; ctx.fillRect(0, 0, w, h);
    for (const star of stars) {
      star.z -= speed;
      if (star.z <= 0.02) Object.assign(star, {x:Math.random() * 2 - 1, y:Math.random() * 2 - 1, z:1});
      const k = 0.5 / star.z, x = w / 2 + star.x * w / 2 * k, y = h / 2 + star.y * h / 2 * k;
      if (x < 0 || x > w || y < 0 || y > h) { star.z = 0; continue; }
      ctx.fillStyle = star.violet ? `rgba(169,155,255,${1 - star.z})` : `rgba(201,214,242,${1 - star.z})`;
      ctx.beginPath(); ctx.arc(x, y, (1 - star.z) * 2.2, 0, 7); ctx.fill();
    }
    if (!reduced && !$('#hero').hidden) starsFrame = requestAnimationFrame(draw);
  };
  draw();
}
// While the picker is up, everything behind it is inert: no focus, clicks or screen-reader browsing escape the dialog.
const behind = () => document.querySelectorAll('#rail, .shell__main, #tabbar');
export function openHero() {
  warp = false; $('#hero').classList.remove('warp'); $('#hero').hidden = false;
  behind().forEach(el => { el.inert = true; });
  document.body.classList.add('picking'); renderHero(); startStars();
  $('#hero-pilots button')?.focus();
}
function choosePilot(pilot) {
  S.me = pilot;
  try { localStorage.setItem(ME, pilot); } catch { /* Choice lasts for this visit. */ }
  warp = true; $('#hero').classList.add('warp');
  behind().forEach(el => { el.inert = false; });
  setTimeout(() => { $('#hero').hidden = true; document.body.classList.remove('picking'); cancelAnimationFrame(starsFrame); }, reduced ? 0 : 900);
  counters.clear(); onChoose();
}
// choose() runs after a pick: app.js sends the pilot to the Bridge and redraws.
export function wire(choose) {
  onChoose = choose;
  document.addEventListener('click', event => { const b = event.target.closest('[data-me]'); if (b) choosePilot(b.dataset.me); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#hero').hidden && S.me) choosePilot(S.me); });
}
