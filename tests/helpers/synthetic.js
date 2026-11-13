// A deterministic, realistically sized market payload for the planner tests: ~5,400 systems on a gate graph (the
// size of New Eden), thousands of NPC stations and seven scanned regions. Same shape the Worker's /api/market serves.
export function syntheticMarket({systems:N = 5432, items = 600} = {}) {
  let seed = 42; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const BLOCK = 80, blocks = Math.ceil(N / BLOCK), SPECIAL = {1:10000002, 27:10000043, 33:10000032, 31:10000030, 25:10000042};
  const regionOf = b => SPECIAL[b] || 10001000 + b;
  const syll = ['ji', 'ta', 'per', 'im', 'ama', 'rr', 'do', 'dix', 'ie', 'ren', 's', 'hek', 'ni', 'ar', 'ja', 'uedo', 'si', 'va', 'la', 'ko', 'ri', 'tu', 've'];
  const word = () => Array.from({length:2 + Math.floor(R() * 2)}, () => syll[Math.floor(R() * syll.length)]).join('');
  const systems = {}, ids = [];
  for (let i = 0; i < N; i++) {
    const id = 30000001 + i, b = Math.floor(i / BLOCK), hi = b < 40;
    const sec = hi ? (b < 30 ? 0.5 + R() * 0.5 : R() < 0.85 ? 0.5 + R() * 0.5 : 0.1 + R() * 0.35) : (R() < 0.5 ? 0.1 + R() * 0.35 : -R());
    const gx = b % 9, gy = Math.floor(b / 9), local = i % BLOCK;
    systems[id] = [word().replace(/^./, c => c.toUpperCase()) + (R() < 0.3 ? ` ${Math.floor(R() * 9)}` : ''), +sec.toFixed(3), regionOf(b), [], Math.floor(R() * 8),
      [+(gx * 120 + R() * 60).toFixed(2), +(R() * 40 - 20).toFixed(2), +(gy * 120 + R() * 60).toFixed(2)], [+((local % 10) * 3 * 2.05 + gx * 80).toFixed(1), +(Math.floor(local / 10) * 3 * 2.05 + gy * 80).toFixed(1)], 20000000 + Math.floor(i / 5)];
    ids.push(id);
  }
  const HUBS = [[30000142, 'Jita'], [30002187, 'Amarr'], [30002659, 'Dodixie'], [30002510, 'Rens'], [30002053, 'Hek'], [30000144, 'Perimeter'], [30003504, 'Niarja'], [30002813, 'Tama']];
  for (const [id, n] of HUBS) if (systems[id]) { systems[id][0] = n; systems[id][1] = id === 30002813 ? 0.3 : 0.9; }
  const link = (a, b) => { if (a === b) return; if (!systems[a][3].includes(b)) systems[a][3].push(b); if (!systems[b][3].includes(a)) systems[b][3].push(a); };
  for (let b = 0; b < blocks; b++) {
    const inside = ids.slice(b * BLOCK, (b + 1) * BLOCK);
    for (let k = 1; k < inside.length; k++) link(inside[k], inside[Math.floor(R() * k)]);
    for (let k = 0; k < inside.length * 0.35; k++) link(inside[Math.floor(R() * inside.length)], inside[Math.floor(R() * inside.length)]);
    for (const nb of [b + 1, b + 9].filter(x => x < blocks && (x % 9 !== 0 || x === b + 9))) for (let k = 0; k < 2; k++) {
      const a = inside[Math.floor(R() * inside.length)], o = ids.slice(nb * BLOCK, (nb + 1) * BLOCK), c = o[Math.floor(R() * o.length)];
      if (b < 40 && nb < 40) { systems[a][1] = Math.max(systems[a][1], 0.6); systems[c][1] = Math.max(systems[c][1], 0.6); }
      link(a, c);
    }
  }
  const stations = Array.from({length:5150}, (_, k) => { const sys = ids[Math.floor(R() * N)]; return [60000000 + k, sys, [1, 2, 4, 8, 16].filter(() => R() < 0.4).reduce((a, x) => a | x, 0), `${systems[sys][0]} ${k % 20}`]; });
  const regions = {}, constellations = {};
  for (let b = 0; b < blocks; b++) regions[regionOf(b)] = word().replace(/^./, c => c.toUpperCase());
  for (const id of ids) constellations[systems[id][7]] = [word(), systems[id][2]];
  const scan = Array.from({length:items}, (_, i) => 1000 + i * 7);
  const types = Object.fromEntries(scan.map(id => [id, {n:`Item ${id}`, v:+(R() * 100).toFixed(2)}]));
  const marketRegions = [10000002, 10000043, 10000032, 10000030, 10000042, 10001010, 10001050].map(r => {
    const here = stations.filter(st => systems[st[1]][2] === r).slice(0, 60), pick = () => here[Math.floor(R() * here.length)];
    const t = {};
    for (const id of scan) if (R() < 0.85) {
      const base = 10 + R() * 1e6, side = (n, k) => Array.from({length:n}, () => [pick()[0], +(base * (1 + k * R() * 0.2)).toFixed(2), Math.floor(R() * 1e5)]);
      t[id] = {d:Math.floor(R() * 1e5), p:Math.floor(R() * 1e5), s:side(6, 1), b:side(6, -1)};
    }
    return {region:r, updatedAt:0, data:{name:regions[r], types:t, stations:Object.fromEntries(here.map(s => [s[0], [s[1], s[3]]]))}};
  });
  return {universe:{systems, stations, regions, constellations}, regions:marketRegions, types, hubs:HUBS.map(h => h[0]), ids,
    risk:Object.fromEntries(ids.filter(() => R() < 0.6).map(id => [id, [Math.floor(R() * 40), Math.floor(R() * 200)]]))};
}
