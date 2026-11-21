import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePaste, cargoOf, hangarOf} from '../ui/sellitems.js';

test('EVE copy formats: tab-separated inventory rows, "5 x Name", "Name x5"; repeats add up', () => {
  const {rows, bad} = parsePaste('Tritanium\t5,000\tMineral\t\t50 m3\n 12 x Pyerite \nRifter x3\nTritanium\t1\n\nnonsense here\nPyerite\tmany\n3 x');
  assert.deepEqual(rows, [{name:'Tritanium', qty:5001}, {name:'Pyerite', qty:12}, {name:'Rifter', qty:3}]);
  assert.deepEqual(bad, ['nonsense here', 'Pyerite\tmany', '3 x']);
  assert.deepEqual(parsePaste('').rows, []);
});
test('cargo comes from the fit only while it is this ship', () => {
  const fit = {ship:1001, items:[[34, 'Cargo', 100], [34, 'Cargo', 20], [5004, 'HiSlot0', 1], [35, 'Cargo', 0]]};
  assert.deepEqual(cargoOf(fit, 1001), [[34, 120]]);
  assert.deepEqual(cargoOf(fit, 2002), []);
  assert.deepEqual(cargoOf(null, 1001), []);
  assert.deepEqual(cargoOf(fit, undefined), []);
});
test('hangar stacks for the stations asked for', () => {
  const stacks = {1:[[34, 5], [35, 0]], 2:[[587, 3]]};
  assert.deepEqual(hangarOf(stacks, [1]), [{station:1, type:34, qty:5}]);
  assert.deepEqual(hangarOf(stacks, [3]), []);
  assert.deepEqual(hangarOf(undefined, [1]), []);
});
