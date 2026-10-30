import {test,expect} from '@playwright/test';
test.describe.configure({timeout:60000});
test('LIVE: a new visitor picks a pilot and sees Fiofka through real ESI',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.LIVE_SITE||'https://matheusfiorin.github.io/eve-journal/');
 const hero=page.locator('#hero');await expect(hero).toBeVisible();await expect(hero.locator('.hero-pilot')).toHaveCount(2);
 await expect(page.locator('#sync-status')).toContainText('Last refresh',{timeout:45000});
 await expect.poll(()=>hero.locator('img.portrait').evaluateAll(images=>images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0)),{timeout:20000}).toBe(true);
 await hero.getByRole('button',{name:/Fiofka/}).click();await expect(hero).toBeHidden();
 const banner=page.locator('.me-banner');await expect(banner.locator('h1')).toHaveText('Fiofka');await expect(banner).not.toContainText('Corporation unavailable');await expect(banner.locator('.error')).toHaveCount(0);
 await expect(page.locator('#server-status')).toContainText('pilots online');await expect(page.locator('#overview details')).toContainText('Joined');
 await page.locator('nav [data-tab="market"]').click();await expect(page.locator('#market-status')).not.toContainText('Loading market data',{timeout:20000});
 expect(errors).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('live-dashboard.png'),fullPage:true});
});
test('LIVE: ESI resolves both pilot IDs',async({request})=>{
 const response=await request.post('https://esi.evetech.net/latest/universe/ids/',{data:['Fiofka','Decxus']});expect(response.ok()).toBeTruthy();const payload=await response.json();expect(payload.characters.map(c=>c.id).sort()).toEqual([2124810474,2124815118]);
});
test('LIVE: deployed backend is ready, public API is redacted and private API requires authorization',async({request})=>{
 const url=process.env.EVE_BACKEND_URL;
 test.skip(!url,'No deployed backend URL supplied.');
 const health=await request.get(`${url}/health`);expect(health.ok()).toBeTruthy();expect((await health.json()).ready).toBe(true);
 const publicResponse=await request.get(`${url}/api/public/pilots`,{headers:{Origin:'https://matheusfiorin.github.io'}});expect(publicResponse.ok()).toBeTruthy();expect(publicResponse.headers()['access-control-allow-origin']).toBe('https://matheusfiorin.github.io');
 const body=await publicResponse.json();expect(Array.isArray(body.pilots)).toBe(true);for(const row of body.pilots)for(const key of ['operations','credentials','accessToken','refreshToken'])expect(row[key]).toBeUndefined();
 const privateResponse=await request.get(`${url}/api/session`);expect(privateResponse.status()).toBe(401);
 const refused=await request.get(`${url}/api/public/pilots`,{headers:{Origin:'https://unrelated.example'}});expect(refused.status()).toBe(403);
});
test('LIVE: backend consent accepts its CSRF cookie and produces the official EVE OAuth redirect',async({request})=>{
 const url=process.env.EVE_BACKEND_URL;test.skip(!url,'No deployed backend URL supplied.');
 const page=await request.get(`${url}/auth/start?pilot=2124810474`);expect(page.ok()).toBeTruthy();expect(page.headers()['content-security-policy']).toContain("form-action 'self' https://login.eveonline.com");
 const html=await page.text();const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
 const start=await request.post(`${url}/auth/start`,{headers:{Origin:url},form:{pilot:'2124810474',csrf,share:'yes'},maxRedirects:0});expect(start.status()).toBe(303);
 const login=new URL(start.headers().location);expect(login.origin).toBe('https://login.eveonline.com');expect(login.searchParams.get('client_id')).toBe('a94f7ccbcc8b4b0d8f7fd90fec110d2b');expect(login.searchParams.get('redirect_uri')).toBe(`${url}/auth/callback`);expect(login.searchParams.get('code_challenge_method')).toBe('S256');expect(login.searchParams.get('state')).toBeTruthy();
});
