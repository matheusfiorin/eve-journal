import json, glob, zipfile, sys, io
z = zipfile.ZipFile('sde.zip')
names = z.namelist()
out = open('dump/sde.txt', 'w')
print('FILES', names, file=out)
def rows(name):
    n = next((x for x in names if x.endswith('/' + name + '.jsonl') or x == name + '.jsonl'), None)
    if not n: print('MISSING', name, file=out); return
    for line in io.TextIOWrapper(z.open(n), encoding='utf-8'):
        if line.strip(): yield json.loads(line)
nm = lambda d: d.get('en') if isinstance(d, dict) else d
groups = {g['_key']: g for g in rows('groups')}
print('GROUP SAMPLE', next(iter(groups.values())), file=out)
ore_groups = {k: nm(g['name']) for k, g in groups.items() if g.get('categoryID') == 25}
print('ORE GROUPS', ore_groups, file=out)
types = {}
for t in rows('types'): types[t['_key']] = t
WANT = {'Venture','Procurer','Retriever','Covetor','Skiff','Mackinaw','Hulk','Prospect','Endurance','Pioneer','Miner I','Miner II','Strip Miner I','Mining Laser Upgrade I','Mining','Astrogeology','Mining Barge','Mining Frigate','Exhumers','Reprocessing','Reprocessing Efficiency','Simple Ore Processing','Coherent Ore Processing','Variegated Ore Processing','Compressed Veldspar','Expedition Frigates','Mining Upgrades','Ice Harvester I','Ore Compression','Veldspar','Scordite'}
ids = {}
for k, t in types.items():
    n = nm(t.get('name'))
    if n in WANT: ids[n] = k; print('TYPE', k, n, 'group', t.get('groupID'), 'vol', t.get('volume'), 'cap', t.get('capacity'), 'portion', t.get('portionSize'), file=out)
print('ORES', file=out)
for k, t in types.items():
    if t.get('groupID') in ore_groups and t.get('published'):
        print(k, ore_groups[t['groupID']], nm(t['name']), t.get('volume'), t.get('portionSize'), t.get('metaGroupID'), file=out)
for t in rows('typeMaterials'):
    if t['_key'] in (ids.get('Veldspar'), ids.get('Scordite'), ids.get('Compressed Veldspar')): print('MATS', t, file=out)
attrs = {a['_key']: a.get('name') for a in rows('dogmaAttributes')}
want = {ids[n] for n in ('Venture','Procurer','Retriever','Covetor','Prospect','Miner I','Miner II','Strip Miner I','Mining Laser Upgrade I','Mining','Astrogeology','Mining Frigate','Mining Barge','Expedition Frigates','Reprocessing','Reprocessing Efficiency','Simple Ore Processing') if n in ids}
for t in rows('typeDogma'):
    if t['_key'] in want:
        print('DOGMA', nm(types[t['_key']]['name']), [(a['attributeID'], attrs.get(a['attributeID']), a['value']) for a in t.get('dogmaAttributes', [])], file=out)
        print('EFFECTS', [e.get('effectID') for e in t.get('dogmaEffects', [])], file=out)
n = 0
for b in rows('mapAsteroidBelts'):
    if n < 3: print('BELT', b, file=out)
    n += 1
print('BELTS', n, file=out)
s = next(rows('mapSolarSystems'))
print('SYSTEM KEYS', list(s.keys()), file=out)
