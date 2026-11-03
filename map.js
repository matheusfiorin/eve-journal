// Map math for the Map tab and route previews: security colours, CCP's schematic region layout, 3D projection,
// jump ranges and overlay scales. Pure functions; app.js draws.
import {secShown} from './route.js';

// EVE's own security palette, from 1.0 (blue) to 0.0 and below (purple).
const SEC = ['#8d3264', '#722020', '#bb1116', '#ce440f', '#dc6d07', '#f3fd82', '#71e554', '#60dba3', '#4ecef8', '#399aeb', '#2c75e1'];
export const secColor = sec => SEC[Math.max(0, Math.min(10, Math.round(secShown(sec) * 10)))];
// WCAG contrast between two #rrggbb colours, and a colour lifted toward white until it reads on a dark background.
const lum = hex => { const c = hex.match(/\w\w/g).map(h => parseInt(h, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export function readable(hex, bg = '#121C2E', min = 4.5) {
  const rgb = hex.match(/\w\w/g).map(h => parseInt(h, 16));
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const out = `#${rgb.map(v => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
    if (contrast(out, bg) >= min) return out;
  }
  return '#ffffff';
}
// Security text colour: the in-game hue, lifted where it would be too dark to read (0.0–0.3 reds and purples).
const SEC_TEXT = SEC.map(c => readable(c));
export const secText = sec => SEC_TEXT[Math.max(0, Math.min(10, Math.round(secShown(sec) * 10)))];
// The three bands pilots talk about, for the legend and screen-reader labels.
export const secBand = sec => secShown(sec) >= 0.5 ? 'high-sec' : secShown(sec) > 0 ? 'low-sec' : 'null-sec';
// A stable, distinct colour per sovereignty owner (alliance or faction id), spread around the hue wheel.
export function ownerColor(id) {
  const h = Math.round(((Number(id) * 0.618033988749895) % 1) * 360);
  return hsl(h, 70, 62);
}
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// A region drawn the way CCP lays it out in 2D. Their schematic sits on a 2.05-unit grid, and systems on one row are
// at least 3 cells apart, so a 28 px cell fits 76 px boxes with no overlaps. Big regions get a big canvas to pan.
export const GRID = 2.05;
export function regionLayout(g, region, {cell = 28, pad = 70} = {}) {
  const inside = [...g.systems.values()].filter(s => s.region === region && s.p2);
  if (!inside.length) return {nodes:[], edges:[], exits:[], width:0, height:0};
  const xs = inside.map(s => s.p2[0]), ys = inside.map(s => s.p2[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = cell / GRID;
  // North is up: schematic y grows upward, screen y downward.
  const at = s => [pad + Math.round((s.p2[0] - x0) / GRID) * cell, pad + Math.round((y1 - s.p2[1]) / GRID) * cell];
  const width = 2 * pad + Math.round((x1 - x0) / GRID) * cell, height = 2 * pad + Math.round((y1 - y0) / GRID) * cell;
  const nodes = inside.map(s => ({system:s, xy:at(s)})), index = new Map(nodes.map(n => [n.system.id, n]));
  const edges = [], exits = [];
  for (const n of nodes) for (const to of n.system.links) {
    const m = index.get(to);
    if (m) { if (n.system.id < to) edges.push([n, m]); continue; }
    const other = g.systems.get(to);
    if (!other?.p2) continue;
    // Point the stub toward the neighbour's schematic position, a fixed length away.
    const dx = (other.p2[0] - n.system.p2[0]) * k, dy = -(other.p2[1] - n.system.p2[1]) * k, len = Math.hypot(dx, dy) || 1;
    exits.push({from:n, to:other, xy:[n.xy[0] + dx / len * 52, n.xy[1] + dy / len * 52]});
  }
  // One label per outside system: several gates to it share a point at the average of their stubs.
  const byTarget = new Map();
  for (const e of exits) byTarget.set(e.to.id, [...(byTarget.get(e.to.id) || []), e]);
  for (const list of byTarget.values()) if (list.length > 1) {
    const xy = [0, 1].map(i => list.reduce((t, e) => t + e.xy[i], 0) / list.length);
    list.forEach((e, i) => { e.xy = xy; e.label = i === 0; });
  }
  for (const e of exits) e.label ??= true;
  return {nodes, edges, exits, width, height};
}

// Perspective projection of light-year positions around a centre, for the 3D views.
export function projector({center = [0, 0, 0], yaw = 0, pitch = 0.5, distance = 120, width = 800, height = 600, fov = 700} = {}) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return ([x, y, z]) => {
    const dx = x - center[0], dy = y - center[1], dz = z - center[2];
    const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy;
    const ry = dy * cp - rz * sp, depth = dy * sp + rz * cp + distance;
    if (depth <= 1) return null;
    const scale = fov / depth;
    return [width / 2 + rx * scale, height / 2 - ry * scale, depth, scale];
  };
}
// Camera easing that doesn't depend on the frame rate: the share of the remaining distance covered in dt ms
// (12% per 60 Hz frame).
export const easeStep = (dt, perFrame = 0.12) => 1 - Math.pow(1 - perFrame, Math.max(0, dt) / (1000 / 60));
// Bounding sphere of some systems: where to point the camera and how far back to sit.
export function frame(systems) {
  const pts = systems.map(s => s.pos).filter(Boolean);
  if (!pts.length) return {center:[0, 0, 0], radius:1};
  const center = [0, 1, 2].map(i => pts.reduce((t, p) => t + p[i], 0) / pts.length);
  return {center, radius:Math.max(1, ...pts.map(p => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])))};
}

export const lightYears = (a, b) => a?.pos && b?.pos ? Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) : Infinity;
// Capital jump ranges with Jump Drive Calibration V (light-years). Jump drives can't land in high-sec (0.45+).
export const JUMP_SHIPS = {blops:{name:'Black Ops', ly:8}, jf:{name:'Jump freighter', ly:10}, capital:{name:'Carrier / Dreadnought / FAX', ly:7}, super:{name:'Supercarrier / Titan', ly:6}};
export function inRange(g, from, ly) {
  const origin = g.systems.get(from), out = [];
  for (const s of g.systems.values()) {
    if (s.id === from || s.sec >= 0.45) continue;
    const d = lightYears(origin, s);
    if (d <= ly) out.push({system:s, ly:d});
  }
  return out.sort((a, b) => a.ly - b.ly);
}

// Overlay values to a 0–1 strength: square root so one busy system doesn't wash out the rest.
export function strengths(values) {
  const max = Math.max(0, ...Object.values(values).filter(Number.isFinite));
  return id => max > 0 && values[id] > 0 ? Math.sqrt(values[id] / max) : 0;
}

// A tiny top-down sketch of a route (x/z plane) for hover previews: points scaled into a box.
export function sketch(systems, {width = 220, height = 120, pad = 14} = {}) {
  const pts = systems.filter(s => s?.pos);
  if (!pts.length) return [];
  const xs = pts.map(s => s.pos[0]), zs = pts.map(s => s.pos[2]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const k = Math.min((width - 2 * pad) / Math.max(x1 - x0, 1e-9), (height - 2 * pad) / Math.max(z1 - z0, 1e-9));
  const ox = (width - (x1 - x0) * k) / 2, oy = (height - (z1 - z0) * k) / 2;
  return pts.map(s => ({system:s, xy:[ox + (s.pos[0] - x0) * k, height - (oy + (s.pos[2] - z0) * k)]}));
}
