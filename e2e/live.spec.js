import {test,expect} from '@playwright/test';
test('LIVE: published dashboard resolves Fiofka and Decxus through real ESI',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.LIVE_SITE||'https://matheusfiorin.github.io/eve-journal/');
 await expect(page.locator('#sync-status')).toContainText('Last refresh',{timeout:45000});
 await expect(page.locator('.pilot-card').first()).toContainText('Fiofka');await expect(page.locator('.pilot-card').nth(1)).toContainText('Decxus');
 await expect(page.locator('.pilot-card .portrait img')).toHaveCount(2);
 await expect(page.locator('.pilot-card').first()).not.toContainText('Corporation unavailable');
 await expect(page.locator('.pilot-card .error')).toHaveCount(0);expect(errors).toEqual([]);
 await page.screenshot({path:testInfo.outputPath('live-dashboard.png'),fullPage:true});
});
test('LIVE: ESI IDs and EVE browser token exchange CORS are available',async({request})=>{
 const response=await request.post('https://esi.evetech.net/latest/universe/ids/',{data:['Fiofka','Decxus']});expect(response.ok()).toBeTruthy();const payload=await response.json();expect(payload.characters.map(c=>c.id).sort()).toEqual([2124810474,2124815118]);
 const cors=await request.fetch('https://login.eveonline.com/v2/oauth/token',{method:'OPTIONS',headers:{Origin:'https://matheusfiorin.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});expect(cors.ok()).toBeTruthy();expect(cors.headers()['access-control-allow-origin']).toBe('*');
});
