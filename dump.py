import json, urllib.request, time
H = {'User-Agent': 'eve-journal gatecamp probe (github.com/matheusfiorin/eve-journal; matheus)', 'Accept-Encoding': 'identity', 'Accept': 'application/json'}
out = open('dump/zkill.txt', 'w')
def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30)
        return r.status, dict(r.headers), r.read().decode()
    except Exception as e:
        return getattr(e, 'code', None), dict(getattr(e, 'headers', {}) or {}), str(e) + ' ' + (e.read().decode()[:300] if hasattr(e, 'read') else '')
for url in ['https://zkillboard.com/api/regionID/10000002/pastSeconds/3600/', 'https://zkillboard.com/api/kills/regionID/10000032/pastSeconds/3600/', 'https://zkillboard.com/api/systemID/30002813/pastSeconds/86400/']:
    st, h, body = get(url)
    print('URL', url, st, {k: v for k, v in h.items() if k.lower() in ('content-type', 'access-control-allow-origin', 'retry-after', 'x-bin-attempts', 'cache-control')}, file=out)
    print(body[:1500], file=out)
    try:
        data = json.loads(body)
        print('COUNT', len(data), file=out)
        gates = [k for k in data if 50000000 <= k['zkb'].get('locationID', 0) < 60000000]
        print('GATE KILLS', len(gates), 'labels sample', [k['zkb'].get('labels') for k in data[:5]], file=out)
        if data:
            k = (gates or data)[0]
            st2, _, km = get(f"https://esi.evetech.net/latest/killmails/{k['killmail_id']}/{k['zkb']['hash']}/")
            print('KILLMAIL', st2, km[:1500], file=out)
    except Exception as e:
        print('PARSE', e, file=out)
    time.sleep(2)
