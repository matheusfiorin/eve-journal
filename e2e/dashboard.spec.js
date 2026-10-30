import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,IDS,API,opaque} from './fixtures.js';
test('public visitors see their pilot and shared training without any private request',async({page})=>{
 const {calls,errors,privateEsi}=await mockApp(page);await openApp(page);
 await expect(page.locator('#server-status')).toContainText('25,432');
 const banner=page.locator('.me-banner');await expect(banner).toContainText('Fiofka');await expect(banner).toContainText('Test Flight Academy [TFA]');await expect(banner).toContainText('333,000');await expect(banner).toContainText('Training Gunnery V');
 await expect(page.locator('#overview details')).toContainText('Joined');
 await tab(page,'skills');await expect(page.locator('#skills-content')).toContainText('Connect Fiofka to see the full skill sheet');
 await tab(page,'wallet');await expect(page.locator('#wallet-content')).toContainText('Connect this pilot');
 expect(calls.some(c=>c.path==='/api/session'||c.path==='/api/wing')).toBe(false);expect(privateEsi).toEqual([]);expect(errors).toEqual([]);
});
test('connected pilots show wallet, journal, transactions, industry and location',async({page},testInfo)=>{
 const {errors,privateEsi}=await mockApp(page,{connected:true});await openApp(page);
 const overview=page.locator('#overview');await expect(page.locator('.me-banner')).toContainText('125,000');await expect(overview).toContainText('12,500,000.25 ISK');await expect(overview).toContainText('Jita IV');await expect(overview).toContainText('Heron');
 await tab(page,'wallet');const wallet=page.locator('#wallet-content .card').first();
 await expect(wallet).toContainText('Fiofka');await expect(wallet).toContainText('bounty prizes');await expect(wallet).toContainText('1,500,000.00 ISK');await expect(wallet).toContainText('Tritanium ×1,000');await expect(wallet).toContainText('-5,500.00 ISK');await expect(wallet).toContainText('2 runs');
 await page.screenshot({path:testInfo.outputPath('wallet.png'),fullPage:true});
 expect(privateEsi).toEqual([]);expect(errors).toEqual([]);
});
test('clones tab shows attributes, implants, home station and jump clones',async({page})=>{
 await mockApp(page,{connected:true});await openApp(page);await tab(page,'clones');const clones=page.locator('#clones-content .card').first();
 await expect(clones).toContainText('Intelligence');await expect(clones).toContainText('23');await expect(clones).toContainText('2 bonus remaps');await expect(clones).toContainText('Ocular Filter - Basic');await expect(clones).toContainText('Home: Jita IV');await expect(clones).toContainText('Staging');await expect(clones).toContainText('Player structure');await expect(clones).toContainText('Next clone jump');
});
test('one failed endpoint keeps the rest of the wallet visible',async({page})=>{
 await mockApp(page,{connected:true,walletFail:true});await openApp(page);await tab(page,'wallet');const wallet=page.locator('#wallet-content .card').first();await expect(wallet).toContainText('permission was declined');await expect(wallet).toContainText('bounty prizes');
});
test('training-only grants explain missing permissions and old snapshots ask for a refresh',async({page})=>{
 await mockApp(page,{connected:true,trainingOnly:true});await openApp(page);await tab(page,'wallet');await expect(page.locator('#wallet-content')).toContainText('Permission not granted');
 await page.unrouteAll({behavior:'ignoreErrors'});await mockApp(page,{connected:true,oldSnapshot:true});await page.reload();await tab(page,'clones');await expect(page.locator('#clones-content .card').first()).toContainText('Not synced yet');
});
test('refresh asks the backend to sync instead of calling private ESI',async({page})=>{
 const {calls,privateEsi}=await mockApp(page,{connected:true});await openApp(page);await page.locator('#refresh').click();await expect.poll(()=>calls.some(c=>c.path==='/api/sync'&&c.method==='POST')).toBe(true);expect(privateEsi).toEqual([]);
});
test('connect navigates to the backend consent page',async({page})=>{
 await mockApp(page);await openApp(page);await page.locator('.me-banner [data-connect]').click();await expect(page).toHaveURL(`${API}/auth/start?pilot=${IDS[0]}`);
});
test('an expired backend session falls back to the shared snapshot',async({page})=>{
 const {errors}=await mockApp(page,{connected:true,expired:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('333,000');await expect(page.locator('#overview')).not.toContainText('12,500,000.25');expect(errors).toEqual([]);
});
test('the callback fragment is consumed, scrubbed and followed by a private session',async({page})=>{
 await mockApp(page);await page.goto(`/#backend_session=${opaque.slice(0,42)}0&pilot=${IDS[0]}&expires=${Date.now()+3600000}`);await expect(page.locator('#sync-status')).toContainText('Last refresh');expect(page.url()).not.toContain('backend_session');await expect(page.locator('#overview')).toContainText('12,500,000.25 ISK');
});
test('disconnect removes private data from the page',async({page})=>{
 const {calls}=await mockApp(page,{connected:'first'});await openApp(page);const overview=page.locator('#overview');await expect(overview).toContainText('12,500,000.25');page.once('dialog',d=>d.accept());await page.locator('.me-banner').getByRole('button',{name:'Disconnect'}).click();await expect(overview).not.toContainText('12,500,000.25');expect(calls.some(c=>c.path==='/api/disconnect')).toBe(true);
 await tab(page,'wallet');await expect(page.locator('#wallet-content .card').first()).toContainText('Connect this pilot');
});
