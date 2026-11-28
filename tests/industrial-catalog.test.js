import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIndustrialCatalog, CatalogError} from '../industrial-catalog.js';

// Synthetic internal-contract data. These records are NOT captures of the new HTTP SDE schema.
const release = '20261126T120000Z';
function snapshot() {
  const wrap = rows => ({release, version:'synthetic-v1', rows});
  return {source:{provider:'ccp-sde', tenant:'tranquility', release, retrievedAt:'2026-11-26T12:05:00Z'}, tables:{
    categories:wrap([{id:6, kind:'ship', name:'Vaisseaux'}, {id:9, kind:'blueprint', name:'Blueprint'}, {id:4, kind:'material', name:'Material'}]),
    groups:wrap([{id:25, categoryId:6, name:'Group A', shipClass:'subcapital'}, {id:99, categoryId:9, name:'Blueprint'}, {id:18, categoryId:4, name:'Mineral'}]),
    types:wrap([{id:1, groupId:25, name:'Synthetic hull', published:true, techLevel:1, variant:'standard'},
      {id:101, groupId:99, name:'Synthetic blueprint', published:true}, {id:34, groupId:18, name:'Synthetic mineral', published:true}]),
    blueprints:wrap([{id:101, manufacturing:{products:[{typeId:1, quantity:1}], timeSeconds:600,
      materials:[{typeId:34, quantity:31}], skills:[]}}])}};
}
const build = edit => { const s = snapshot(); edit?.(s); return buildIndustrialCatalog(s); };
const first = edit => build(edit).entries[0];
function extraHull(s, id, name, shipClass = 'subcapital') {
  s.tables.groups.rows.push({id:1000 + id, categoryId:6, name, shipClass});
  s.tables.types.rows.push({id, groupId:1000 + id, name, published:true, techLevel:1, variant:'standard'},
    {id:id + 100, groupId:99, name:`${name} blueprint`, published:true});
  s.tables.blueprints.rows.push({id:id + 100, manufacturing:{products:[{typeId:id, quantity:1}], timeSeconds:1000,
    materials:[{typeId:34, quantity:100}], skills:[]}});
}
const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };

test('catalog retains source release, table versions and exact base recipe without prices or automatic ME', () => {
  const result = build();
  assert.deepEqual(result.entries, [{blueprintTypeId:101, productTypeId:1, name:'Synthetic hull', groupId:25, groupName:'Group A', categoryId:6,
    shipClass:'subcapital', unitsPerRun:1, baseSeconds:600, materials:[{typeId:34, name:'Synthetic mineral', quantity:31}],
    skills:[], status:'recipe-ready', issues:[]}]);
  assert.equal(result.source.release, release); assert.equal(result.source.retrievedAt, '2026-11-26T12:05:00.000Z');
  assert.deepEqual(Object.keys(result.source.tableVersions), ['types', 'groups', 'categories', 'blueprints']);
  assert.deepEqual(result.counts, {total:1, ready:1, incomplete:0, unsupported:0});
  assert.equal(result.version, 1);
});

test('haulers, cruisers, battlecruisers, battleships and barges use metadata, not a small ship/name/BPO-price allowlist', () => {
  const result = build(s => ['Hauler', 'Cruiser', 'Battlecruiser', 'Battleship', 'Barge'].forEach((name, i) => extraHull(s, 10 + i, name)));
  assert.equal(result.counts.ready, 6);
  assert.deepEqual(result.entries.map(e => e.productTypeId), [1, 10, 11, 12, 13, 14]);
});

test('capital recipes remain visible but explicitly unsupported for the first implementation', () => {
  const result = build(s => extraHull(s, 10, 'Synthetic capital', 'capital'));
  assert.equal(result.entries[1].status, 'unsupported');
  assert.deepEqual(result.entries[1].issues, ['capital_not_enabled']);
  assert.equal(result.counts.unsupported, 1); assert.equal(result.counts.ready, 1);
});

test('T2, faction, special, unpublished and non-ship products are excluded explicitly', () => {
  for (const [change, reason] of [
    [s => s.tables.types.rows[0].techLevel = 2, 'nonT1'],
    [s => s.tables.types.rows[0].variant = 'faction', 'nonStandard'],
    [s => s.tables.types.rows[0].variant = 'special', 'nonStandard'],
    [s => s.tables.types.rows[0].published = false, 'unpublished'],
    [s => s.tables.types.rows[1].published = false, 'unpublished'],
    [s => s.tables.groups.rows[0].categoryId = 4, 'nonShip'],
    [s => s.tables.blueprints.rows[0].manufacturing = null, 'noManufacturing']
  ]) { const result = build(change); assert.equal(result.entries.length, 0); assert.equal(result.excluded[reason], 1); }
});

test('a different release in any required table aborts the generation rather than mixing recipes', () => {
  for (const name of ['types', 'groups', 'categories', 'blueprints']) assert.throws(() => build(s => s.tables[name].release = '20261125T120000Z'),
    error => error instanceof CatalogError && error.code === 'mixed_release');
});

test('same build-like table version never replaces the unique release identifier', () => {
  const a = build(), b = snapshot(); b.source.release = '20261126T130000Z';
  for (const table of Object.values(b.tables)) table.release = b.source.release;
  assert.notEqual(a.source.release, buildIndustrialCatalog(b).source.release);
  assert.deepEqual(a.source.tableVersions, buildIndustrialCatalog(b).source.tableVersions);
});

test('missing source, tables or versions cannot create a valid snapshot', () => {
  assert.throws(() => buildIndustrialCatalog(), {code:'invalid_source'});
  assert.throws(() => buildIndustrialCatalog(null), {code:'invalid_source'});
  assert.throws(() => build(s => s.source.tenant = 'singularity'), {code:'invalid_source'});
  assert.throws(() => build(s => s.source.release = '20260230T120000Z'), {code:'invalid_source'});
  assert.throws(() => build(s => s.source.retrievedAt = '2026-11-26T12:05:00'), {code:'invalid_source'});
  assert.throws(() => build(s => delete s.tables.types), {code:'missing_table'});
  assert.throws(() => build(s => s.tables.types.version = ''), {code:'invalid_table'});
});

test('duplicate and unsafe identifiers abort ambiguous generations', () => {
  assert.throws(() => build(s => s.tables.types.rows.push({...s.tables.types.rows[0]})), {code:'duplicate_id'});
  assert.throws(() => build(s => s.tables.types.rows[0].id = Number.MAX_SAFE_INTEGER + 1), {code:'invalid_id'});
});

test('missing material quantities or names stay unknown instead of becoming zero', () => {
  const missing = first(s => s.tables.blueprints.rows[0].manufacturing.materials[0].quantity = undefined);
  assert.equal(missing.status, 'incomplete'); assert.equal(missing.materials[0].quantity, null);
  assert.ok(missing.issues.includes('invalid_material_quantity'));
  const unknown = first(s => s.tables.types.rows.pop());
  assert.equal(unknown.materials[0].name, null); assert.ok(unknown.issues.includes('missing_material_type'));
  for (const qty of [0, -1, 1.5, Infinity, '31']) assert.equal(first(s => s.tables.blueprints.rows[0].manufacturing.materials[0].quantity = qty).status, 'incomplete');
});

test('missing output, time, blueprint or publication metadata blocks recipe readiness', () => {
  for (const change of [
    s => s.tables.blueprints.rows[0].manufacturing.products[0].quantity = 0,
    s => s.tables.blueprints.rows[0].manufacturing.timeSeconds = null,
    s => s.tables.types.rows.splice(1, 1),
    s => s.tables.types.rows[1].groupId = 18,
    s => delete s.tables.types.rows[0].published,
    s => delete s.tables.types.rows[0].techLevel,
    s => s.tables.types.rows[0].techLevel = -1,
    s => delete s.tables.types.rows[0].variant,
    s => delete s.tables.groups.rows[0].shipClass
  ]) assert.equal(first(change).status, 'incomplete');
});

test('ambiguous multi-product recipes and missing classification are diagnosed, never reduced to the first product', () => {
  const many = build(s => s.tables.blueprints.rows[0].manufacturing.products.push({typeId:34, quantity:1}));
  assert.equal(many.entries.length, 0); assert.equal(many.issues[0].code, 'unsupported_products');
  const absent = build(s => s.tables.groups.rows.shift());
  assert.equal(absent.issues[0].code, 'missing_classification');
});

test('duplicate materials, omitted skill lists and invalid skill requirements cannot be marked complete', () => {
  assert.ok(first(s => s.tables.blueprints.rows[0].manufacturing.materials.push({typeId:34, quantity:2})).issues.includes('duplicate_material'));
  assert.ok(first(s => delete s.tables.blueprints.rows[0].manufacturing.skills).issues.includes('missing_skills'));
  assert.ok(first(s => s.tables.blueprints.rows[0].manufacturing.skills = [{typeId:34, level:6}]).issues.includes('invalid_skill'));
  assert.ok(first(s => s.tables.blueprints.rows[0].manufacturing.skills = [{typeId:999, level:1}]).issues.includes('missing_skill_type'));
});

test('input order does not affect the catalog and frozen source records are never mutated', () => {
  const a = snapshot(); extraHull(a, 10, 'Another hull');
  const job = a.tables.blueprints.rows[0].manufacturing;
  job.materials.push({typeId:34, quantity:2}, {typeId:34}, {typeId:0, quantity:9}, null, {quantity:3});
  job.skills = [{typeId:34, level:5}, {typeId:34, level:2}, {typeId:34, level:6}, {typeId:0, level:1}, null];
  const b = structuredClone(a); for (const table of Object.values(b.tables)) table.rows.reverse();
  for (const bp of b.tables.blueprints.rows) { bp.manufacturing.materials.reverse(); bp.manufacturing.skills.reverse(); }
  assert.deepEqual(buildIndustrialCatalog(freeze(a)), buildIndustrialCatalog(b));
});

test('invalid recipe references stay visible as null placeholders and cannot make a recipe ready', () => {
  const entry = first(s => {
    s.tables.blueprints.rows[0].manufacturing.materials = [{typeId:0, quantity:17}, null];
    s.tables.blueprints.rows[0].manufacturing.skills = [{typeId:0, level:2}, {typeId:34, level:6}, null];
  });
  assert.equal(entry.status, 'incomplete');
  assert.deepEqual(entry.materials, [{typeId:null, name:null, quantity:17}, {typeId:null, name:null, quantity:null}]);
  assert.deepEqual(entry.skills, [{typeId:34, level:null}, {typeId:null, level:2}, {typeId:null, level:null}]);
  assert.ok(entry.issues.includes('invalid_material_type')); assert.ok(entry.issues.includes('invalid_material_quantity'));
  assert.ok(entry.issues.includes('invalid_skill'));
});

test('retrieval time requires a real ISO calendar timestamp with an explicit timezone', () => {
  for (const value of ['Nov 26 2026 12:05 Z', '2026-11-26 12:05:00Z', '2026-02-30T12:05:00Z',
    '2026-11-26T24:00:00Z', '2026-11-26T12:05:00', '2026-11-26T12:05:00+24:00']) {
    assert.throws(() => build(s => s.source.retrievedAt = value), {code:'invalid_source'}, value);
  }
  assert.equal(build(s => s.source.retrievedAt = '2026-11-26T09:05:00.125-03:00').source.retrievedAt, '2026-11-26T12:05:00.125Z');
});

test('absent table objects report invalid_table while actual release mismatches report mixed_release', () => {
  for (const value of [null, undefined, [], 'table']) assert.throws(() => build(s => s.tables.types = value), {code:'invalid_table'});
  assert.throws(() => build(s => s.tables.types.release = '20261125T120000Z'), {code:'mixed_release'});
});

test('raw ZIP or HTTP keys are rejected until an explicit adapter normalizes them', () => {
  for (const key of ['_key', 'typeID']) assert.throws(() => build(s => {
    const type = s.tables.types.rows[0]; type[key] = type.id; delete type.id;
  }), {code:'invalid_id'});
});

test('multiple units per run and intermediate components remain exact, without recursive production or price screening', () => {
  const entry = first(s => {
    s.tables.blueprints.rows[0].manufacturing.products[0].quantity = 10;
    s.tables.types.rows.push({id:35, groupId:18, name:'Intermediate component', published:true});
    s.tables.blueprints.rows[0].manufacturing.materials.push({typeId:35, quantity:2});
  });
  assert.equal(entry.unitsPerRun, 10); assert.equal(entry.status, 'recipe-ready');
  assert.deepEqual(entry.materials.map(m => [m.typeId, m.quantity]), [[34, 31], [35, 2]]);
});
