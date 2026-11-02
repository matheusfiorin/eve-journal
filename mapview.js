// Drawing for the Map tab, the map modal and route hover previews: SVG region maps and a canvas 3D star map.
import {secColor, regionLayout, projector, frame, sketch} from './map.js';
import {secShown} from './route.js';
import {escapeHTML as esc} from './model.js';

export const secLight = sec => `<i class="light" style="--c:${secColor(sec)}" aria-hidden="true"></i><span class="sec-val" style="color:${secColor(sec)}">${secShown(sec).toFixed(1)}</span>`;

// A Dotlan-style region map: one box per system with a security light, gates between them, stubs to other regions,
// an overlay halo, jump-range rings and the current route drawn on top.
export function regionSvg(g, region, {strength = () => 0, value = () => '', route = [], selected = null, range = new Set(), overlayColor = '#f2877a'} = {}) {
  const layout = regionLayout(g, region);
  if (!layout.nodes.length) return '<p class="hint">No map layout for this region.</p>';
  const at = new Map(layout.nodes.map(n => [n.system.id, n.xy]));
  const onRoute = new Set(route);
  const segments = [];
  for (let i = 1; i < route.length; i++) if (at.has(route[i - 1]) && at.has(route[i])) segments.push([at.get(route[i - 1]), at.get(route[i])]);
  const line = ([a, b], cls) => `<line class="${cls}" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  const regionOf = id => g.regions[id] || '';
  return `<svg class="region-map" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${esc(regionOf(region))} region map" data-region="${region}">
    <g class="edges">${layout.edges.map(([a, b]) => line([a.xy, b.xy], a.system.region === b.system.region && g.systems.get(a.system.id).constellation !== g.systems.get(b.system.id).constellation ? 'edge cross' : 'edge')).join('')}</g>
    <g class="exits">${layout.exits.map(e => `${line([e.from.xy, e.xy], 'edge exit')}${e.label ? `<g class="exit" data-system="${e.to.id}" transform="translate(${e.xy[0].toFixed(1)},${e.xy[1].toFixed(1)})"><text>${esc(e.to.name)}</text><text class="exit-region" y="11">${esc(regionOf(e.to.region))}</text></g>` : ''}`).join('')}</g>
    <g class="route">${segments.map(s => line(s, 'route-line')).join('')}</g>
    <g class="systems">${layout.nodes.map(({system:s, xy}) => {
      const k = strength(s.id);
      return `<g class="sys${s.id === selected ? ' selected' : ''}${onRoute.has(s.id) ? ' on-route' : ''}${range.has(s.id) ? ' in-range' : ''}" data-system="${s.id}" data-value="${esc(String(value(s.id) ?? ''))}" transform="translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)})" tabindex="0" role="button" aria-label="${esc(s.name)} ${secShown(s.sec).toFixed(1)}">
        ${k ? `<circle class="halo" r="${(14 + 26 * k).toFixed(1)}" style="fill:${overlayColor};opacity:${(0.15 + 0.5 * k).toFixed(2)}"/>` : ''}
        ${range.has(s.id) ? '<circle class="range" r="24"/>' : ''}
        <rect x="-38" y="-12" width="76" height="24" rx="6"/><circle class="light" cx="-28" cy="0" r="4.5" style="fill:${secColor(s.sec)};--c:${secColor(s.sec)}"/>
        <text x="-20" y="4">${esc(s.name.length > 11 ? `${s.name.slice(0, 10)}…` : s.name)}</text><text class="sv" x="40" y="-14" style="fill:${secColor(s.sec)}">${secShown(s.sec).toFixed(1)}</text>
      </g>`;
    }).join('')}</g></svg>`;
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

// The 3D star map: drag to orbit, wheel to zoom, gentle auto-rotation, a pulse running along the route.
export class StarMap {
  constructor(canvas, {onHover = () => {}, onSelect = () => {}, reduced = false} = {}) {
    Object.assign(this, {canvas, onHover, onSelect, reduced, yaw:0.6, pitch:0.55, distance:300, target:{center:[0, 0, 0], distance:300}, center:[0, 0, 0], frames:0, idleUntil:0, pulse:0});
    this.ctx = canvas.getContext('2d');
    // A fixed field of faint background stars, in screen fractions so it survives resizes.
    let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.stars = Array.from({length:160}, () => [rand(), rand(), rand() * 0.5 + 0.1]);
    let drag = null;
    canvas.addEventListener('pointerdown', e => { drag = {x:e.clientX, y:e.clientY, moved:0}; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
        this.yaw += dx * 0.006; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.006)); drag.x = e.clientX; drag.y = e.clientY; this.idleUntil = performance.now() + 4000;
      }
      const hit = this.pick(e.offsetX, e.offsetY);
      if (hit?.id !== this.hover?.id) { this.hover = hit; this.onHover(hit, e.offsetX, e.offsetY); }
    });
    canvas.addEventListener('pointerup', e => { if (drag && drag.moved < 6) { const hit = this.pick(e.offsetX, e.offsetY); if (hit) this.onSelect(hit); } drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.onHover(null); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.target.distance = Math.max(8, Math.min(2000, this.target.distance * (e.deltaY > 0 ? 1.15 : 0.87))); this.idleUntil = performance.now() + 4000; }, {passive:false});
  }
  // systems: [{id, pos, sec, name}], color(id) → css colour, focus: Set of ids drawn bright (others dimmed), route: [ids].
  set({g, systems, color, focus = null, route = [], selected = null, labels = []}) {
    Object.assign(this, {g, systems, color, focus, route, selected, labels});
    const ids = new Set(systems.map(s => s.id));
    this.edges = [];
    for (const s of systems) for (const to of s.links) if (s.id < to && ids.has(to)) this.edges.push([s, g.systems.get(to)]);
    this.routeSystems = route.map(id => g.systems.get(id)).filter(s => s?.pos);
    this.start();
  }
  fly(systems, {snap = false} = {}) {
    const f = frame(systems);
    this.target = {center:f.center, distance:Math.max(12, f.radius * 2.6)};
    if (snap) { this.center = [...f.center]; this.distance = this.target.distance; }
  }
  pick(x, y) {
    let best = null, bestD = 12;
    for (const p of this.projected || []) { const d = Math.hypot(p.xy[0] - x, p.xy[1] - y); if (d < bestD) { bestD = d; best = p.system; } }
    return best;
  }
  start() { if (!this.running) { this.running = true; requestAnimationFrame(t => this.draw(t)); } }
  stop() { this.running = false; }
  draw(time) {
    if (!this.running) return;
    if (!this.canvas.isConnected || !this.canvas.offsetParent) { this.running = false; return; }
    const c = this.canvas, dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    for (const [x, y, a] of this.stars) { ctx.fillStyle = `rgba(200,215,235,${a})`; ctx.fillRect(x * w, y * h, 1, 1); }
    // Ease the camera toward its target; idle maps turn slowly unless motion is reduced.
    const ease = this.reduced ? 1 : 0.12;
    this.center = this.center.map((v, i) => v + (this.target.center[i] - v) * ease);
    this.distance += (this.target.distance - this.distance) * ease;
    if (!this.reduced && time > this.idleUntil) this.yaw += 0.0012;
    const project = projector({center:this.center, yaw:this.yaw, pitch:this.pitch, distance:this.distance, width:w, height:h, fov:Math.min(w, h) * 1.1});
    const pos = new Map();
    const P = s => { if (!pos.has(s.id)) pos.set(s.id, s.pos ? project(s.pos) : null); return pos.get(s.id); };
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(139,155,176,0.16)';
    ctx.beginPath();
    for (const [a, b] of this.edges) { const p = P(a), q = P(b); if (p && q) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); } }
    ctx.stroke();
    this.projected = [];
    for (const s of this.systems) {
      const p = P(s); if (!p || p[0] < -20 || p[1] < -20 || p[0] > w + 20 || p[1] > h + 20) continue;
      const dim = this.focus && !this.focus.has(s.id), r = Math.max(0.9, Math.min(3.2, p[3] * 0.45));
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = this.color(s.id);
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      if (!dim) this.projected.push({system:s, xy:p});
    }
    ctx.globalAlpha = 1;
    // The route: a glowing line with a pulse running from start to end.
    const rp = this.routeSystems.map(P);
    if (rp.length > 1 && rp.every(Boolean)) {
      ctx.save(); ctx.strokeStyle = '#A99BFF'; ctx.lineWidth = 2.4; ctx.shadowColor = '#A99BFF'; ctx.shadowBlur = 10;
      ctx.beginPath(); rp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore();
      this.pulse = this.reduced ? 0 : (this.pulse + 0.012) % 1;
      const at = this.pulse * (rp.length - 1), i = Math.floor(at), f = at - i, a = rp[i], b = rp[Math.min(i + 1, rp.length - 1)];
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 3.5, 0, Math.PI * 2); ctx.fill();
      for (const [k, s] of [[0, this.routeSystems[0]], [rp.length - 1, this.routeSystems.at(-1)]]) this.label(s.name, rp[k], '#C3B9FF');
    }
    // Region names, biggest first, skipping any that would overlap one already drawn.
    const taken = [];
    ctx.font = '600 11px system-ui, sans-serif';
    for (const l of this.labels) {
      const p = project(l.pos); if (!p) continue;
      const w = ctx.measureText(l.text).width, box = [p[0] + 8, p[1] - 20, w, 14];
      if (taken.some(t => box[0] < t[0] + t[2] + 6 && t[0] < box[0] + box[2] + 6 && box[1] < t[1] + t[3] + 2 && t[1] < box[1] + box[3] + 2)) continue;
      taken.push(box); this.label(l.text, p, 'rgba(232,238,244,0.6)', 11);
    }
    const sel = this.selected && this.g.systems.get(this.selected), sp = sel && P(sel);
    if (sp) {
      ctx.strokeStyle = secColor(sel.sec); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp[0], sp[1], 9 + Math.sin(time / 300) * (this.reduced ? 0 : 2), 0, Math.PI * 2); ctx.stroke();
      this.label(sel.name, sp, '#e8eef4');
      c.dataset.focusXy = `${Math.round(sp[0])},${Math.round(sp[1])}`;
    } else delete c.dataset.focusXy;
    if (this.hover) { const hp = P(this.hover); if (hp) this.label(this.hover.name, hp, '#e8eef4'); }
    c.dataset.frames = ++this.frames;
    requestAnimationFrame(t => this.draw(t));
  }
  label(text, p, color, size = 12) {
    const ctx = this.ctx; ctx.font = `600 ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(text, p[0] + 8, p[1] - 8); ctx.shadowBlur = 0;
  }
}
