import test from 'node:test';
import assert from 'node:assert/strict';
import {eft, fitGroups, fitCounts, groupOf} from '../fit.js';

const NAMES = {32880: 'Venture', 1: 'Overdrive Injector System II', 2: '5MN Quad LiF Restrained Microwarpdrive', 3: 'Medium Shield Extender I', 4: 'Compact EM Shield Amplifier',
  5: 'Gas Cloud Scoop I', 6: 'Core Probe Launcher I', 7: 'Small Polycarbon Engine Housing II', 8: 'Small Low Friction Nozzle Joints II', 9: 'Hobgoblin I', 10: 'Nanite Repair Paste',
  11: 'Core Probe Launcher I Blueprint', 12: 'Scourge Rage Rocket', 13: 'Tengu Defensive - Covert Reconfiguration', 14: 'Medium Cargo Expander'};
const nameOf = id => NAMES[id];
// A Venture, as the asset list shows it: one row per module, rigs and drones by flag.
const venture = [[5, 'HiSlot1', 1], [6, 'HiSlot2', 1], [5, 'HiSlot0', 1], [3, 'MedSlot1', 1], [2, 'MedSlot0', 1], [4, 'MedSlot2', 1], [1, 'LoSlot0', 1],
  [8, 'RigSlot2', 1], [7, 'RigSlot0', 1], [7, 'RigSlot1', 1], [9, 'DroneBay', 2]];

test('a Venture comes out as standard EFT: lows, mids, highs, rigs, drones, in slot order', () => {
  assert.equal(eft({ship: 32880, title: 'Gas huffer', items: venture, nameOf}), `[Venture, Gas huffer]
Overdrive Injector System II

5MN Quad LiF Restrained Microwarpdrive
Medium Shield Extender I
Compact EM Shield Amplifier

Gas Cloud Scoop I
Gas Cloud Scoop I
Core Probe Launcher I

Small Polycarbon Engine Housing II
Small Polycarbon Engine Housing II
Small Low Friction Nozzle Joints II

Hobgoblin I x2`);
});
test('the fit name defaults to the ship, subsystems follow the rigs, and cargo comes last as Name xN', () => {
  const text = eft({ship: 32880, items: [[13, 'SubSystemSlot0', 1], [7, 'RigSlot0', 1], [10, 'Cargo', 100], [10, 'Cargo', 50], [9, 'DroneBay', 5], [12, 'FighterBay', 3]], nameOf});
  assert.equal(text, `[Venture, Venture]
Small Polycarbon Engine Housing II

Tengu Defensive - Covert Reconfiguration

Hobgoblin I x5

Scourge Rage Rocket x3

Nanite Repair Paste x150`);
});
test('a ship with nothing fitted is just its header; empty sections leave no blank lines', () => {
  assert.equal(eft({ship: 32880, title: 'Bare', items: [], nameOf}), '[Venture, Bare]');
  assert.equal(eft({ship: 32880, title: 'Bare', items: [[1, 'LoSlot0', 1]], nameOf}), '[Venture, Bare]\nOverdrive Injector System II');
});
test('a charge loaded in a module rides on that module in EFT when its category is known', () => {
  const items = [[6, 'HiSlot0', 1], [10, 'HiSlot0', 40]], cat = id => id === 10 ? 'Charge' : 'Module';
  assert.equal(eft({ship: 32880, title: 'x', items, nameOf, catOf: cat}), '[Venture, x]\nCore Probe Launcher I, Nanite Repair Paste');
  assert.equal(fitGroups(items, cat).high.length, 1);
  assert.equal(fitGroups(items).high.length, 2, 'without categories both read as modules');
});
test('only fit flags count: implants, skills and hangar items are ignored', () => {
  const g = fitGroups([[1, 'Implant', 1], [1, 'Skill', 1], [1, 'Hangar', 1], [1, 'LoSlot0', 1], [14, 'SpecializedOreHold', 4], [14, 'SpecializedOreHold', 6], [1, 'FighterTube0', 1]]);
  assert.equal(g.low.length, 1);assert.deepEqual(g.special.map(m => [m.type, m.qty]), [[14, 10]]);assert.equal(g.fighters.length, 1);
  for (const flag of ['Implant', 'Skill', 'Hangar', 'AutoFit', 'Unlocked']) assert.equal(groupOf(flag), null, flag);
});
test('counts per group say how many modules and how many stacked items', () => {
  assert.deepEqual(fitCounts(venture), {high: 3, mid: 3, low: 1, rig: 3, sub: 0, drones: 2, fighters: 0, special: 0, cargo: 0});
  assert.deepEqual(fitCounts(undefined), {high: 0, mid: 0, low: 0, rig: 0, sub: 0, drones: 0, fighters: 0, special: 0, cargo: 0});
});
test('rows that are malformed are skipped rather than thrown on', () => {
  assert.deepEqual(fitCounts([null, [1], [1, 7, 1], 'x', [1, 'LoSlot0', 1]]).low, 1);
});
