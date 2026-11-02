import json, zipfile, io
z = zipfile.ZipFile('sde.zip'); names = z.namelist()
out = open('dump/map.txt', 'w')
def rows(name):
    n = next(x for x in names if x.endswith('/' + name + '.jsonl') or x == name + '.jsonl')
    for line in io.TextIOWrapper(z.open(n), encoding='utf-8'):
        if line.strip(): yield json.loads(line)
for f in ['mapRegions', 'mapConstellations', 'stationServices']:
    r = list(rows(f)); print(f, len(r), json.dumps(r[0])[:700], file=out)
    if f == 'stationServices': print([x.get('serviceName') for x in r], file=out)
ss = [s for s in rows('mapSolarSystems')]
print('SYSTEM', json.dumps({k: ss[0][k] for k in ss[0] if k not in ('planetIDs', 'stargateIDs')})[:900], file=out)
forge = [s for s in ss if s['regionID'] == 10000002][:8]
for s in forge: print('FORGE', s['name'], s.get('position2D'), s['position'], s.get('securityClass'), file=out)
import statistics
xs = [s['position2D']['x'] for s in ss if s.get('position2D')]; print('P2 range', min(xs), max(xs), len(xs), file=out)
st = list(rows('npcStations')); print('STATIONS', len(st), json.dumps(st[0])[:600], file=out)
