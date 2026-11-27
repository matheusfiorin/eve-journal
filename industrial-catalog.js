// Internal, normalized SDE contract. HTTP/ZIP adapters must validate their own source schema before calling this.
// No prices, I/O or automatic research: a recipe being complete does not make production profitable or executable.
export const CATALOG_VERSION = 1;
const TABLES = ['types', 'groups', 'categories', 'blueprints'];
const positive = n => Number.isSafeInteger(n) && n > 0;
const text = s => typeof s === 'string' && s.trim().length > 0;
const compare = (a, b) => a.productTypeId - b.productTypeId || a.blueprintTypeId - b.blueprintTypeId;

export class CatalogError extends Error {
  constructor(code, detail) { super(`Industrial catalog: ${detail}`); this.name = 'CatalogError'; this.code = code; }
}
const fail = (code, detail) => { throw new CatalogError(code, detail); };
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
function validRelease(release) {
  if (typeof release !== 'string' || !/^\d{8}T\d{6}Z$/.test(release)) return false;
  const iso = `${release.slice(0,4)}-${release.slice(4,6)}-${release.slice(6,8)}T${release.slice(9,11)}:${release.slice(11,13)}:${release.slice(13,15)}Z`;
  const at = Date.parse(iso);
  return Number.isFinite(at) && new Date(at).toISOString().replace(/[-:]/g, '').replace('.000', '') === release;
}

function records(table, name, release) {
  if (!plain(table) || table.release !== release) fail('mixed_release', `${name} must belong to the selected release.`);
  if (!text(table.version) || !Array.isArray(table.rows)) fail('invalid_table', `${name} needs a version and rows.`);
  const index = new Map();
  for (const row of table.rows) {
    if (!plain(row) || !positive(row.id)) fail('invalid_id', `${name} has an invalid record id.`);
    if (index.has(row.id)) fail('duplicate_id', `${name} has duplicate id ${row.id}.`);
    index.set(row.id, row);
  }
  return index;
}

// Each table carries its release, including tables reused from cache: mixed generations never produce a catalog.
export function buildIndustrialCatalog(snapshot = {}) {
  if (!plain(snapshot)) fail('invalid_source', 'a normalized snapshot is required.');
  const {source, tables} = snapshot;
  if (!plain(source) || source.provider !== 'ccp-sde' || source.tenant !== 'tranquility'
      || !validRelease(source.release) || !text(source.retrievedAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(source.retrievedAt)
      || !Number.isFinite(Date.parse(source.retrievedAt))) fail('invalid_source', 'source needs a provider, tenant, release and retrieval time.');
  if (!plain(tables) || TABLES.some(name => !Object.prototype.hasOwnProperty.call(tables, name))) fail('missing_table', 'types, groups, categories and blueprints are required.');
  const indexes = Object.fromEntries(TABLES.map(name => [name, records(tables[name], name, source.release)]));
  const {types, groups, categories, blueprints} = indexes;
  const entries = [], issues = [], excluded = {noManufacturing:0, nonShip:0, unpublished:0, nonT1:0, nonStandard:0};
  const issue = (blueprintTypeId, code, productTypeId = null) => issues.push({blueprintTypeId, productTypeId, code});
  for (const bp of [...blueprints.values()].sort((a, b) => a.id - b.id)) {
    const job = bp.manufacturing;
    if (job === null) { excluded.noManufacturing++; continue; }
    if (!plain(job)) { issue(bp.id, 'missing_manufacturing'); continue; }
    if (!Array.isArray(job.products) || job.products.length !== 1) { issue(bp.id, 'unsupported_products'); continue; }
    const output = job.products[0], type = types.get(output?.typeId), blueprint = types.get(bp.id);
    if (!type) { issue(bp.id, 'missing_product_type', output?.typeId ?? null); continue; }
    const group = groups.get(type.groupId), category = categories.get(group?.categoryId);
    if (!group || !category || !text(category.kind)) { issue(bp.id, 'missing_classification', type.id); continue; }
    // Classification is semantic, never a ship-name list or a translated group/category name.
    if (category.kind !== 'ship') { excluded.nonShip++; continue; }
    if (type.published === false || blueprint?.published === false) { excluded.unpublished++; continue; }
    if (Number.isInteger(type.techLevel) && type.techLevel > 1) { excluded.nonT1++; continue; }
    if (['faction', 'special'].includes(type.variant)) { excluded.nonStandard++; continue; }

    const faults = new Set(), unsupported = new Set();
    if (!blueprint) faults.add('missing_blueprint_type');
    else if (categories.get(groups.get(blueprint.groupId)?.categoryId)?.kind !== 'blueprint') faults.add('invalid_blueprint_classification');
    if (type.published !== true || blueprint?.published !== true) faults.add('unknown_publication');
    if (type.techLevel !== 1) faults.add('unknown_tech_level');
    if (type.variant !== 'standard') faults.add('unknown_variant');
    if (!text(type.name) || !text(group.name)) faults.add('missing_name');
    if (!positive(output?.quantity)) faults.add('invalid_output_quantity');
    if (!positive(job.timeSeconds)) faults.add('invalid_manufacturing_time');
    if (group.shipClass === 'capital') unsupported.add('capital_not_enabled');
    else if (group.shipClass !== 'subcapital') faults.add('unknown_ship_class');

    const inputs = [], materialIds = new Set();
    if (!Array.isArray(job.materials) || !job.materials.length) faults.add('missing_materials');
    for (const material of Array.isArray(job.materials) ? job.materials : []) {
      if (!positive(material?.typeId)) { faults.add('invalid_material_type'); continue; }
      if (materialIds.has(material.typeId)) faults.add('duplicate_material');
      materialIds.add(material.typeId);
      const item = types.get(material.typeId);
      if (!item || !text(item.name)) faults.add('missing_material_type');
      if (!positive(material.quantity)) faults.add('invalid_material_quantity');
      inputs.push({typeId:material.typeId, name:text(item?.name) ? item.name : null, quantity:positive(material.quantity) ? material.quantity : null});
    }
    const skills = [], skillIds = new Set();
    // An empty list is valid; an omitted list is unknown, not proof that a blueprint needs no skills.
    if (!Array.isArray(job.skills)) faults.add('missing_skills');
    for (const skill of Array.isArray(job.skills) ? job.skills : []) {
      if (!positive(skill?.typeId) || !Number.isInteger(skill.level) || skill.level < 1 || skill.level > 5) { faults.add('invalid_skill'); continue; }
      if (skillIds.has(skill.typeId)) faults.add('duplicate_skill');
      skillIds.add(skill.typeId);
      if (!types.has(skill.typeId)) faults.add('missing_skill_type');
      skills.push({typeId:skill.typeId, level:skill.level});
    }
    const problems = [...faults, ...unsupported].sort();
    entries.push({blueprintTypeId:bp.id, productTypeId:type.id, name:text(type.name) ? type.name : null,
      groupId:group.id, groupName:text(group.name) ? group.name : null, categoryId:category.id,
      shipClass:group.shipClass ?? null, unitsPerRun:positive(output.quantity) ? output.quantity : null,
      baseSeconds:positive(job.timeSeconds) ? job.timeSeconds : null,
      materials:inputs.sort((a, b) => a.typeId - b.typeId), skills:skills.sort((a, b) => a.typeId - b.typeId),
      status:faults.size ? 'incomplete' : unsupported.size ? 'unsupported' : 'recipe-ready', issues:problems});
  }
  entries.sort(compare);
  return {version:CATALOG_VERSION, source:{provider:source.provider, tenant:source.tenant, release:source.release,
    retrievedAt:new Date(source.retrievedAt).toISOString(), tableVersions:Object.fromEntries(TABLES.map(name => [name, tables[name].version]))},
    entries, issues, excluded, counts:{total:entries.length, ready:entries.filter(e => e.status === 'recipe-ready').length,
      incomplete:entries.filter(e => e.status === 'incomplete').length, unsupported:entries.filter(e => e.status === 'unsupported').length}};
}
