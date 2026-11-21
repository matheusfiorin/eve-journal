// The Android app runs the root planners from a committed bundle (scripts/bundle-android.mjs): it must match the modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {bundle, OUT} from '../scripts/bundle-android.mjs';

test('the Android planner bundle is built from the current planner modules', async () => {
  assert.equal(await readFile(OUT, 'utf8'), await bundle(), 'run npm run bundle:android and commit the result');
});

test('the bundle answers JSON calls like route.js does', async () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(await readFile(OUT, 'utf8'), ctx);
  const {graph, paths} = await import('../route.js');
  const universe = {systems:{1:['A', 0.9, 9, [2]], 2:['B', 0.3, 9, [1, 3]], 3:['C', 0.9, 9, [2]]}};
  const p = ctx.EchelonPlanners;
  assert.equal(JSON.parse(p.call('universe.load', {universe})).systems, 3);
  assert.deepEqual(JSON.parse(p.call('route.path', {from:1, to:3})), paths(graph(universe), 1).path(3));
  assert.throws(() => p.call('nope', {}), /Unknown planner call/);
});
