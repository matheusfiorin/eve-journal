// Drawing for the Star map, the map modal and route hover previews: SVG region maps and a canvas 3D star map.
import {secColor, secText, regionLayout, projector, frame, sketch, easeStep} from './map.js';
import {secShown} from './route.js';
import {escapeHTML as esc} from './model.js';
import {attach} from './ui/gestures.js';
import {routeInRegion} from './ui/mapstate.js';

export {secLight} from './map.js';

const f1 = v => v.toFixed(1);
const line = ([a, b], cls, style = '') => `<line class="${cls}" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"${style ? ` style="${style}"` : ''}/>`;
// A Dotlan-style region map: one box per system with a security light, gates between them, stubs to other regions,
// an overlay halo, jump-range rings and every layer (routes, pins, trails, rings) drawn on top.
// Only the selected system (or the first) is in the tab order; arrow keys move between systems (see navigate).
export function regionSvg(g, region, {strength = () => 0, value = () => '', colorOf = () => '#f2877a', overlayColor, route = [], layers = [], selected = null, range = new Set(), label = null} = {}) {
  const layout = regionLayout(g, region);
  if (!layout.nodes.length) return '<p class="hint">No map layout for this region.</p>';
  if (overlayColor) colorOf = () => overlayColor;
  if (route.length) layers = [...layers, {kind:'route', ids:route, color:'#A99BFF', label:'Route'}];
  const at = new Map(layout.nodes.map(n => [n.system.id, n.xy]));
  const exitAt = new Map(layout.exits.map(e => [`${e.from.system.id}>${e.to.id}`, e.xy]));
  const regionOf = id => g.regions[id] || '';
  const onRoute = new Set(layers.filter(l => l.kind === 'route').flatMap(l => l.ids));
  const focusId = at.has(selected) ? selected : layout.nodes[0].system.id;
  // Layers: lines inside the region, a stub out to each exit with what's left of the trip, A/B badges and hop numbers.
  let lines = '', marks = '';
  for (const l of layers) {
    const style = `--c:${l.color}`;
    if (l.kind === 'route' || l.kind === 'trail') {
      const cls = l.kind === 'trail' ? 'route-line trail-line' : 'route-line';
      for (const run of routeInRegion(l.ids, id => at.has(id))) {
        for (let i = 1; i < run.ids.length; i++) lines += line([at.get(run.ids[i - 1]), at.get(run.ids[i])], cls, style);
        const out = run.to && exitAt.get(`${run.ids.at(-1)}>${run.to}`), inn = run.from && exitAt.get(`${run.ids[0]}>${run.from}`);
        if (inn) lines += line([inn, at.get(run.ids[0])], 'route-exit', style);
        if (out) {
          const other = g.systems.get(run.to);
          lines += line([at.get(run.ids.at(-1)), out], 'route-exit', style);
          // The note goes past the exit label, along the stub, so it clears the systems it leaves from.
          const from = at.get(run.ids.at(-1)), len = Math.hypot(out[0] - from[0], out[1] - from[1]) || 1, ux = (out[0] - from[0]) / len, uy = (out[1] - from[1]) / len;
          const nx = out[0] + ux * 26, ny = out[1] + uy * 26 + (uy > 0.3 ? 18 : uy < -0.3 ? -8 : 4), anchor = ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle';
          marks += `<text class="exit-note" x="${f1(nx)}" y="${f1(ny)}" text-anchor="${anchor}" style="fill:${l.color}">→ ${esc(regionOf(other?.region) || other?.name || '')} (+${run.remaining} ${run.remaining === 1 ? 'jump' : 'jumps'})</text>`;
        }
      }
      if (l.kind === 'route' && l.ids.length > 1) l.ids.forEach((id, i) => {
        const xy = at.get(id);
        if (!xy) return;
        const end = i === 0 ? 'A' : i === l.ids.length - 1 ? 'B' : '';
        marks += end ? `<g class="badge" transform="translate(${f1(xy[0] - 38)},${f1(xy[1] - 12)})" style="${style}"><circle r="8"/><text y="3.5">${end}</text></g>`
          : `<text class="hop-n" x="${f1(xy[0] + 38)}" y="${f1(xy[1] + 20)}" style="fill:${l.color}">${i}</text>`;
      });
    }
    if (l.kind === 'pins' || l.kind === 'ring') for (const id of l.ids) {
      const xy = at.get(id);
      if (xy) marks += `<circle class="${l.kind === 'ring' ? 'ring-mark' : 'pin-mark'}" cx="${f1(xy[0])}" cy="${f1(xy[1] - (l.kind === 'pins' ? 18 : 0))}" r="${l.kind === 'ring' ? 30 : 5}" style="${style}"/>`;
    }
  }
  const sysLabel = label || (s => `${s.name}, ${secShown(s.sec).toFixed(1)}`);
  return `<svg class="region-map" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-roledescription="region map" aria-label="${esc(regionOf(region))}: ${layout.nodes.length} systems. Arrow keys move between systems, Enter selects." data-region="${region}">
    <g class="edges">${layout.edges.map(([a, b]) => line([a.xy, b.xy], a.system.region === b.system.region && g.systems.get(a.system.id).constellation !== g.systems.get(b.system.id).constellation ? 'edge cross' : 'edge')).join('')}</g>
    <g class="exits">${layout.exits.map(e => `${line([e.from.xy, e.xy], 'edge exit')}${e.label ? `<g class="exit" data-system="${e.to.id}" data-from="${e.from.system.id}" transform="translate(${f1(e.xy[0])},${f1(e.xy[1])})" tabindex="-1" role="button" aria-label="${esc(e.to.name)}, ${esc(regionOf(e.to.region))} (next region)"><rect class="hit" x="-44" y="-16" width="88" height="44"/><text>${esc(e.to.name)}</text><text class="exit-region" y="11">${esc(regionOf(e.to.region))}</text></g>` : ''}`).join('')}</g>
    <g class="route">${lines}</g>
    <g class="systems">${layout.nodes.map(({system:s, xy}) => {
      const k = strength(s.id);
      return `<g class="sys${s.id === selected ? ' selected' : ''}${onRoute.has(s.id) ? ' on-route' : ''}${range.has(s.id) ? ' in-range' : ''}" data-system="${s.id}" data-value="${esc(String(value(s.id) ?? ''))}" transform="translate(${f1(xy[0])},${f1(xy[1])})" tabindex="${s.id === focusId ? 0 : -1}" role="button" aria-label="${esc(sysLabel(s))}">
        <rect class="hit" x="-44" y="-22" width="88" height="44"/>
        ${k ? `<circle class="halo" r="${(14 + 26 * k).toFixed(1)}" style="fill:${colorOf(s.id)};opacity:${(0.15 + 0.5 * k).toFixed(2)}"/>` : ''}
        <circle class="range" r="24"/>
        <rect class="box" x="-38" y="-12" width="76" height="24" rx="6"/><circle class="light" cx="-28" cy="0" r="4.5" style="fill:${secColor(s.sec)};--c:${secColor(s.sec)}"/>
        <text class="nm" x="-20" y="4">${esc(s.name.length > 11 ? `${s.name.slice(0, 10)}…` : s.name)}</text><text class="sv" x="40" y="-14" style="fill:${secText(s.sec)}">${secShown(s.sec).toFixed(1)}</text>
      </g>`;
    }).join('')}</g>
    <g class="marks" aria-hidden="true">${marks}</g></svg>`;
}

// A small top-down sketch of a route for hover previews and the route modal.
export function routeSketch(g, ids, {width = 240, height = 130} = {}) {
  const pts = sketch(ids.map(id => g.systems.get(id)), {width, height});
  if (!pts.length) return '';
  const path = pts.map(p => p.xy.map(v => v.toFixed(1)).join(',')).join(' ');
  return `<svg class="route-sketch" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${path}"/>
    ${pts.map((p, i) => `<circle class="${i === 0 ? 'first' : i === pts.length - 1 ? 'last' : ''}" cx="${p.xy[0].toFixed(1)}" cy="${p.xy[1].toFixed(1)}" r="${i === 0 || i === pts.length - 1 ? 5 : 3.2}" style="fill:${secColor(p.system.sec)}"/>`).join('')}
    <text x="${pts[0].xy[0].toFixed(1)}" y="${(pts[0].xy[1] - 9).toFixed(1)}">${esc(pts[0].system.name)}</text><text x="${pts.at(-1).xy[0].toFixed(1)}" y="${(pts.at(-1).xy[1] - 9).toFixed(1)}">${esc(pts.at(-1).system.name)}</text></svg>`;
}

export const ZOOM_3D = {min:8, max:2000};
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// The 3D star map: drag (one finger) to orbit, wheel or pinch to zoom, two fingers to pan, tap to select,
// arrow keys orbit, +/− zoom, Enter selects the system nearest the centre. It only draws while something changes:
// the camera easing, a slow turn (one for ten seconds, then it stops; off with reduced motion), the route and selection
// pulse (a few seconds after anything changes), new data, a resize or the pointer. A hidden tab doesn't draw at all.
// Projections live in typed arrays that are reused every frame, and colours are worked out once per set().
const SPIN_MS = 10000, PULSE_MS = 8000;
export class StarMap {
  constructor(canvas, {onHover = () => {}, onSelect = () => {}, reduced = false} = {}) {
    Object.assign(this, {canvas, onHover, onSelect, reduced, yaw:0.6, pitch:0.55, distance:300, target:{center:[0, 0, 0], distance:300}, center:[0, 0, 0], frames:0, idleUntil:0, pulse:0, last:0, layers:[], labels:[], widths:new Map(),
      spinLeft:SPIN_MS, pulseUntil:0, systems:null, index:new Map(), pos3:new Float32Array(0), sx:new Float32Array(0), sy:new Float32Array(0), ss:new Float32Array(0), hits:new Int32Array(0), hitCount:0, edges:new Int32Array(0), groups:[]});
    this.ctx = canvas.getContext('2d');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    // A fixed field of faint background stars, in screen fractions so it survives resizes.
    let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.stars = Array.from({length:160}, () => [rand(), rand(), rand() * 0.5 + 0.1]);
    // After a touch the map stays still for 4 s; if its turn isn't used up it wakes then.
    const touch = () => {
      const now = performance.now();
      this.idleUntil = now + 4000; this.pulseUntil = now + PULSE_MS;
      clearTimeout(this.wake); if (this.spinLeft > 0) this.wake = setTimeout(() => this.invalidate(), 4050);
      this.invalidate();
    };
    this.detach = attach(canvas, {
      pan:(dx, dy, n) => {
        if (n === 1) { this.yaw += dx * 0.006; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.006)); }
        else this.panBy(dx, dy);
        touch();
      },
      zoom:f => { this.zoomBy(f); touch(); },
      tap:(x, y) => { const hit = this.pick(x, y); if (hit) this.onSelect(hit); }
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || canvas.dataset.gesture) return;
      const hit = this.pick(e.offsetX, e.offsetY);
      if (hit?.id !== this.hover?.id) { this.hover = hit; this.onHover(hit, e.offsetX, e.offsetY); this.invalidate(); }
    });
    canvas.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.onHover(null); this.invalidate(); } });
    canvas.addEventListener('keydown', e => {
      const step = 0.12, k = e.key;
      if (k === 'ArrowLeft') this.yaw -= step; else if (k === 'ArrowRight') this.yaw += step;
      else if (k === 'ArrowUp') this.pitch = Math.max(-1.45, this.pitch - step); else if (k === 'ArrowDown') this.pitch = Math.min(1.45, this.pitch + step);
      else if (k === '+' || k === '=') this.zoomBy(0.8); else if (k === '-' || k === '_') this.zoomBy(1.25);
      else if (k === 'Enter' || k === ' ') { const hit = this.nearestCentre(); if (hit) this.onSelect(hit); }
      else return;
      e.preventDefault(); touch();
    });
    if (typeof ResizeObserver === 'function') { this.resize = new ResizeObserver(() => this.invalidate()); this.resize.observe(canvas); }
    this.visible = () => { if (!document.hidden) this.invalidate(); };
    document.addEventListener('visibilitychange', this.visible);
  }
  // systems: [{id, pos, sec, name}], color(id) → css colour, focus: Set of ids drawn bright (others dimmed),
  // layers: [{kind, ids, color, label}] (a plain `route` is drawn as one route layer), labels: [{text, pos}].
  set({g, systems, color, focus = null, route = [], layers = [], selected = null, labels = [], summary = ''}) {
    if (route.length) layers = [...layers, {kind:'route', ids:route, color:'#A99BFF', label:'Route'}];
    Object.assign(this, {g, systems, color, focus, layers, selected, labels});
    const n = systems.length;
    if (this.graph !== g || this.systemsRef !== systems) {
      this.graph = g; this.systemsRef = systems;
      this.index = new Map(systems.map((s, i) => [s.id, i]));
      this.pos3 = new Float32Array(n * 3).fill(NaN);
      systems.forEach((s, i) => { if (s.pos) this.pos3.set(s.pos, i * 3); });
      this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.ss = new Float32Array(n); this.hits = new Int32Array(n);
      const edges = [];
      for (let i = 0; i < n; i++) for (const to of systems[i].links) { const j = this.index.get(to); if (j !== undefined && systems[i].id < to) edges.push(i, j); }
      this.edges = Int32Array.from(edges);
    }
    // One colour lookup per system per set(), batched into one path per colour (bright and dimmed separately).
    const batches = new Map();
    for (let i = 0; i < n; i++) {
      const dim = Boolean(focus && !focus.has(systems[i].id)), css = color(systems[i].id), key = `${dim ? 1 : 0}${css}`;
      let b = batches.get(key); if (!b) batches.set(key, b = {dim, css, list:[]});
      b.list.push(i);
    }
    this.groups = [...batches.values()].map(b => ({dim:b.dim, css:b.css, idx:Int32Array.from(b.list)}));
    this.layerSystems = layers.map(l => ({...l, systems:l.ids.map(id => g.systems.get(id)).filter(s => s?.pos)}));
    this.canvas.setAttribute('aria-label', summary || `3D star map of ${systems.length} systems${selected && g.systems.get(selected) ? `, ${g.systems.get(selected).name} selected` : ''}. Arrow keys turn, plus and minus zoom, Enter selects the system in the middle.`);
    this.pulseUntil = performance.now() + PULSE_MS;
    this.invalidate();
  }
  fly(systems, {snap = false} = {}) {
    const f = frame(systems);
    this.target = {center:f.center, distance:Math.max(12, f.radius * 2.6)};
    if (snap) { this.center = [...f.center]; this.distance = this.target.distance; }
    this.invalidate();
  }
  zoomBy(f) { this.target.distance = Math.max(ZOOM_3D.min, Math.min(ZOOM_3D.max, this.target.distance * f)); this.invalidate(); }
  // Two-finger pan: move the point the camera orbits, in the camera's own plane.
  panBy(dx, dy) {
    const k = this.distance / (this.fov || 700), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const right = [cy, 0, -sy], up = [-sy * sp, cp, -cy * sp];
    const move = [0, 1, 2].map(i => -dx * k * right[i] + dy * k * up[i]);
    this.target.center = this.target.center.map((v, i) => v + move[i]); this.center = this.center.map((v, i) => v + move[i]);
  }
  // The visible, bright system closest to a point (in the last drawn frame), within reach of a mouse or a finger.
  closest(x, y, reach) {
    let best = -1, bestD = reach;
    for (let k = 0; k < this.hitCount; k++) { const i = this.hits[k], d = Math.hypot(this.sx[i] - x, this.sy[i] - y); if (d < bestD) { bestD = d; best = i; } }
    return best < 0 ? null : this.systems[best];
  }
  pick(x, y) { return this.closest(x, y, coarse() ? 22 : 12); }
  nearestCentre() { return this.closest(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, Infinity); }
  invalidate() { this.dirty = true; this.start(); }
  start() { if (!this.running && this.systems) { this.running = true; requestAnimationFrame(t => this.draw(t)); } }
  stop() { this.running = false; }
  destroy() { this.stop(); clearTimeout(this.wake); this.detach?.(); this.resize?.disconnect(); document.removeEventListener('visibilitychange', this.visible); }
  // True while something on screen is still moving.
  animating(time) {
    const settle = Math.abs(this.target.distance - this.distance) > 0.01 * this.distance || this.center.some((v, i) => Math.abs(this.target.center[i] - v) > 0.01);
    if (settle) return true;
    if (this.reduced) return false;
    return (time > this.idleUntil && this.spinLeft > 0) || (time < this.pulseUntil && Boolean(this.selected || this.layerSystems?.some(l => l.kind === 'route' && l.systems.length > 1)));
  }
  draw(time) {
    if (!this.running) return;
    if (document.hidden) { this.running = false; this.last = 0; return; }
    if (!this.canvas.isConnected || !this.canvas.offsetParent) { this.running = false; return; }
    const moving = this.animating(time);
    if (!this.dirty && !moving) { this.running = false; this.last = 0; return; }
    this.dirty = false;
    const dt = this.last ? Math.min(100, time - this.last) : 16.7; this.last = time;
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(200,215,235,0.35)';
    for (const [x, y, a] of this.stars) { ctx.globalAlpha = a; ctx.fillRect(x * w, y * h, 1, 1); }
    ctx.globalAlpha = 1;
    // Ease the camera toward its target by elapsed time; an idle map turns slowly, for ten seconds in all.
    const ease = this.reduced ? 1 : easeStep(dt);
    for (let i = 0; i < 3; i++) this.center[i] += (this.target.center[i] - this.center[i]) * ease;
    this.distance += (this.target.distance - this.distance) * ease;
    if (!this.reduced && time > this.idleUntil && this.spinLeft > 0) { this.yaw += 0.0012 * dt / 16.7; this.spinLeft -= dt; }
    this.fov = Math.min(w, h) * 1.1;
    // The same perspective maths as map.js projector(), for every system at once into reused arrays (NaN = behind the camera).
    const {pos3, sx, sy, ss, edges, hits} = this, n = this.systems.length;
    const cyaw = Math.cos(this.yaw), syaw = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), [cx, cy, cz] = this.center, fov = this.fov, hw = w / 2, hh = h / 2, away = this.distance;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const dx = pos3[j] - cx, dy = pos3[j + 1] - cy, dz = pos3[j + 2] - cz;
      const rx = dx * cyaw - dz * syaw, rz = dx * syaw + dz * cyaw, depth = dy * sp + rz * cp + away;
      if (!(depth > 1)) { sx[i] = NaN; continue; }
      const scale = fov / depth;
      sx[i] = hw + rx * scale; sy[i] = hh - (dy * cp - rz * sp) * scale; ss[i] = scale;
    }
    let project; // for anything not among `systems`: route ends, region labels
    const free = pos => (project ||= projector({center:this.center, yaw:this.yaw, pitch:this.pitch, distance:this.distance, width:w, height:h, fov:this.fov}))(pos);
    const P = s => { const i = this.index.get(s.id); if (i === undefined) return s.pos ? free(s.pos) : null; return sx[i] === sx[i] ? [sx[i], sy[i], 0, ss[i]] : null; };
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(139,155,176,0.16)';
    ctx.beginPath();
    for (let k = 0; k < edges.length; k += 2) { const a = edges[k], b = edges[k + 1]; if (sx[a] === sx[a] && sx[b] === sx[b]) { ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); } }
    ctx.stroke();
    let hc = 0;
    for (const grp of this.groups) {
      ctx.globalAlpha = grp.dim ? 0.18 : 1; ctx.fillStyle = grp.css; ctx.beginPath();
      for (const i of grp.idx) {
        const x = sx[i], y = sy[i];
        if (!(x >= -20 && y >= -20 && x <= w + 20 && y <= h + 20)) continue;
        const r = Math.max(0.9, Math.min(3.2, ss[i] * 0.45));
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (!grp.dim) hits[hc++] = i;
      }
      ctx.fill();
    }
    this.hitCount = hc;
    ctx.globalAlpha = 1;
    // Layers: routes glow with a pulse running from start to end; pins and rings mark systems.
    const pulsing = !this.reduced && time < this.pulseUntil;
    let pulsed = false;
    const named = new Set();
    for (const l of this.layerSystems || []) {
      const rp = l.systems.map(P);
      if ((l.kind === 'route' || l.kind === 'trail') && rp.length > 1 && rp.every(Boolean)) {
        ctx.save(); ctx.strokeStyle = l.color; ctx.lineWidth = 2.4; ctx.shadowColor = l.color; ctx.shadowBlur = 10;
        if (l.kind === 'trail') ctx.setLineDash([5, 4]);
        ctx.beginPath(); rp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore();
        if (l.kind === 'route' && !pulsed) {
          pulsed = true;
          if (pulsing) this.pulse = (this.pulse + 0.012 * dt / 16.7) % 1;
          const at = this.pulse * (rp.length - 1), i = Math.floor(at), f = at - i, a = rp[i], b = rp[Math.min(i + 1, rp.length - 1)];
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 3.5, 0, Math.PI * 2); ctx.fill();
        }
        if (l.kind === 'route') for (const [k, s, tag] of [[0, l.systems[0], 'A'], [rp.length - 1, l.systems.at(-1), 'B']]) { this.label(`${tag} ${s.name}`, rp[k], l.color); named.add(s.id); }
      }
      if (l.kind === 'pins' || l.kind === 'ring') for (const p of rp) if (p) { ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], l.kind === 'ring' ? 12 : 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    // Region names, biggest first, skipping any that would overlap one already drawn.
    const taken = [];
    ctx.font = '600 11px system-ui, sans-serif';
    for (const l of this.labels) {
      const p = free(l.pos); if (!p) continue;
      const tw = this.measure(l.text, 11), box = [p[0] + 8, p[1] - 20, tw, 14];
      if (taken.some(t => box[0] < t[0] + t[2] + 6 && t[0] < box[0] + box[2] + 6 && box[1] < t[1] + t[3] + 2 && t[1] < box[1] + box[3] + 2)) continue;
      taken.push(box); this.label(l.text, p, 'rgba(232,238,244,0.6)', 11);
    }
    const sel = this.selected && this.g.systems.get(this.selected), sp2 = sel && P(sel);
    if (sp2) {
      ctx.strokeStyle = secColor(sel.sec); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp2[0], sp2[1], 9 + Math.sin(time / 300) * (pulsing ? 2 : 0), 0, Math.PI * 2); ctx.stroke();
      if (!named.has(sel.id)) this.label(sel.name, sp2, '#e8eef4');
      named.add(sel.id);
      c.dataset.focusXy = `${Math.round(sp2[0])},${Math.round(sp2[1])}`;
    } else delete c.dataset.focusXy;
    if (this.hover && !named.has(this.hover.id)) { const hp = P(this.hover); if (hp) this.label(this.hover.name, hp, '#e8eef4'); }
    c.dataset.frames = ++this.frames;
    requestAnimationFrame(t => this.draw(t));
  }
  measure(text, size) {
    const key = `${size}|${text}`;
    if (!this.widths.has(key)) { this.ctx.font = `600 ${size}px system-ui, sans-serif`; this.widths.set(key, this.ctx.measureText(text).width); }
    return this.widths.get(key);
  }
  label(text, p, color, size = 12) {
    const ctx = this.ctx; ctx.font = `600 ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(text, p[0] + 8, p[1] - 8); ctx.shadowBlur = 0;
  }
}
