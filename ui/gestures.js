// One pointer-gesture handler for the 2D region map and the 3D star map: one finger (or the mouse) drags, two fingers
// pinch around their midpoint and pan together, a short still press is a tap, the wheel zooms at the cursor.
// The math helpers are pure so they can be unit-tested; attach() is the only part that touches the DOM.

export const TAP_PX = 8, TAP_MS = 300;
export const isTap = (moved, ms) => moved < TAP_PX && ms < TAP_MS;

// Wheel deltas to a zoom factor (>1 zooms out). Lines and pages are turned into pixels first; a trackpad pinch
// (ctrl+wheel) is more sensitive, and one step is capped so a fast flick can't jump across the map.
export function wheelFactor({deltaY = 0, deltaMode = 0, ctrlKey = false} = {}) {
  const px = deltaY * (deltaMode === 1 ? 33 : deltaMode === 2 ? 400 : 1);
  return Math.exp(Math.max(-0.5, Math.min(0.5, px * (ctrlKey ? 0.01 : 0.0015))));
}
export const midpoint = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const spread = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Two fingers from `prev` to `next`: how much they spread (scale >1 means fingers moved apart, i.e. zoom in),
// where their midpoint is now, and how far the midpoint moved.
export function pinch(prev, next) {
  const m0 = midpoint(prev), m1 = midpoint(next), d0 = spread(prev), d1 = spread(next);
  return {scale:d0 > 0 ? d1 / d0 : 1, mid:m1, pan:[m1[0] - m0[0], m1[1] - m0[1]]};
}

// viewBox helpers: boxes are [x, y, width, height] in map units; points are in map units too.
export const clampWidth = (w, {min = 120, max = 4000} = {}) => Math.max(min, Math.min(max, w));
// Zoom a box by factor f (>1 shows more) keeping point `at` fixed on screen, within the width limits.
export function zoomBox([x, y, w, h], f, at = [x + w / 2, y + h / 2], limits) {
  const nw = clampWidth(w * f, limits), k = nw / w, nh = h * k;
  return [at[0] - (at[0] - x) * k, at[1] - (at[1] - y) * k, nw, nh];
}
// Pan a box by a screen-pixel drag, given how many screen pixels one map unit covers.
export const panBox = ([x, y, w, h], dx, dy, pxPerUnit) => [x - dx / pxPerUnit, y - dy / pxPerUnit, w, h];
// A box that shows `[x0, y0, x1, y1]` with padding, never zoomed in past `minWidth`.
export function fitBox([x0, y0, x1, y1], {pad = 40, minWidth = 0, aspect = 0} = {}) {
  let w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  if (aspect > 0) { if (w / h < aspect) w = h * aspect; else h = w / aspect; }
  if (w < minWidth) { h *= minWidth / w; w = minWidth; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}
// Screen pixels per map unit for an SVG with preserveAspectRatio "xMidYMid meet".
export const svgScale = (box, rect) => Math.min(rect.width / box[2], rect.height / box[3]);
// A screen point (relative to the element) to map units, for the same "meet" fit.
export function toMap(box, rect, sx, sy) {
  const s = svgScale(box, rect), ox = (rect.width - box[2] * s) / 2, oy = (rect.height - box[3] * s) / 2;
  return [box[0] + (sx - ox) / s, box[1] + (sy - oy) / s];
}

// Wire pointer and wheel gestures on `el`. Callbacks get element-relative pixels:
//   pan(dx, dy, count)   one finger or mouse drag (count = 1), or two fingers moving together (count = 2)
//   zoom(f, x, y)        f > 1 zooms out, around (x, y)
//   tap(x, y, event)     a press that moved < 8 px and lasted < 300 ms
//   start() / end()      a drag or pinch began / every pointer lifted
// Pointer capture only starts once a press turns into a drag, so a click on a child still reaches it;
// the click that ends a drag is swallowed. Returns a function that removes the listeners.
export function attach(el, {pan = () => {}, zoom = () => {}, tap = null, start = () => {}, end = () => {}} = {}) {
  const pointers = new Map();
  let downAt = 0, moved = 0, dragging = false, swallow = false, pinchPrev = null;
  const local = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pts = () => [...pointers.values()].map(p => p.xy);
  const begin = () => { if (!dragging) { dragging = true; el.dataset.gesture = 'on'; start(); } };
  const capture = id => { try { el.setPointerCapture(id); } catch { /* The pointer is already gone. */ } };
  const down = e => {
    if (e.button > 0) return;
    pointers.set(e.pointerId, {xy:local(e)});
    if (pointers.size === 1) { downAt = performance.now(); moved = 0; swallow = false; }
    if (pointers.size === 2) { for (const id of pointers.keys()) capture(id); pinchPrev = pts(); moved = TAP_PX; begin(); }
  };
  const move = e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const xy = local(e), dx = xy[0] - p.xy[0], dy = xy[1] - p.xy[1];
    p.xy = xy;
    if (pointers.size >= 2) {
      const now = pts().slice(0, 2), g = pinch(pinchPrev, now);
      pinchPrev = now;
      if (g.scale !== 1) zoom(1 / g.scale, g.mid[0], g.mid[1]);
      if (g.pan[0] || g.pan[1]) pan(g.pan[0], g.pan[1], 2);
      return;
    }
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved >= TAP_PX) { if (!dragging) { capture(e.pointerId); begin(); } pan(dx, dy, 1); }
  };
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    const wasTap = pointers.size === 1 && !dragging && isTap(moved, performance.now() - downAt) && e.type === 'pointerup';
    pointers.delete(e.pointerId);
    if (pointers.size === 1) { pinchPrev = null; moved = TAP_PX; }
    if (wasTap && tap) { const [x, y] = local(e); tap(x, y, e); }
    if (!pointers.size) { if (dragging) { swallow = true; dragging = false; delete el.dataset.gesture; end(); } pinchPrev = null; }
  };
  const click = e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } };
  const wheel = e => { e.preventDefault(); const [x, y] = local(e); zoom(wheelFactor(e), x, y); };
  const on = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['click', click, true], ['wheel', wheel, {passive:false}]];
  for (const [type, fn, opt] of on) el.addEventListener(type, fn, opt);
  return () => { for (const [type, fn, opt] of on) el.removeEventListener(type, fn, opt); };
}
