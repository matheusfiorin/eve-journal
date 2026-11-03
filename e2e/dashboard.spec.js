import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,IDS,API,opaque} from './fixtures.js';
test('public visitors see their pilot and shared training without any private request',async({page})=>{
 const {calls,errors,privateEsi}=await mockApp(page);await openApp(page);
 await expect(page.locator('#server-status')).toContainText('25,432');
 const banner=page.locator('.me-banner');await expect(banner).toContainText('Fiofka');await expect(banner).toContainText('Test Flight Academy [TFA]');await expect(banner).toContainText('333,000');await expect(banner).toContainText('Training Gunnery V');
 await expect(page.locator('#bridge details')).toContainText('Joined');
 await tab(page,'skills');await expect(page.locator('#skills-content')).toContainText('Connect Fiofka to see the full skill sheet');
 await tab(page,'wallet');await expect(page.locator('#ledger-content')).toContainText('Connect this pilot');
 expect(calls.some(c=>c.path==='/api/session'||c.path==='/api/wing')).toBe(false);expect(privateEsi).toEqual([]);expect(errors).toEqual([]);
});
test('connected pilots show wallet, journal, transactions, mining, industry and location',async({page},testInfo)=>{
 const {errors,privateEsi}=await mockApp(page,{connected:true});await openApp(page);
 const overview=page.locator('#bridge');await expect(page.locator('.me-banner')).toContainText('125,000');await expect(overview).toContainText('12,500,000.25 ISK');await expect(overview).toContainText('Jita IV');await expect(overview).toContainText('Heron');
 await tab(page,'wallet');const ledger=page.locator('#ledger'),wallet=page.locator('#ledger-content');
 await expect(ledger.locator('[data-show-pilot="Fiofka"]')).toHaveAttribute('aria-pressed','true');
 await expect(wallet.locator('.readout')).toContainText('12,500,000');await expect(wallet.locator('.readout')).toContainText('+1.5M ISK');
 await expect(wallet).toContainText('bounty prizes');await expect(wallet).toContainText('1,500,000.00 ISK');await expect(wallet).toContainText('Tritanium ×1,000');await expect(wallet).toContainText('-5,500.00 ISK');await expect(wallet).toContainText('2 runs');
 // A market transaction shows once, from the transactions list.
 const rows=wallet.locator('.rows__row');await expect(rows).toHaveCount(2);
 await expect(wallet.locator('.jobs-line')).toContainText('1 job running, 1 ready to deliver');await expect(wallet.locator('.jobs-line')).toHaveAttribute('data-go','earn/jobs');
 await page.screenshot({path:testInfo.outputPath('wallet.png'),fullPage:true});
 // Type chips, search and sorting narrow the one table; a row opens the full record.
 await ledger.getByRole('button',{name:'Market',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Tritanium');
 await ledger.getByRole('button',{name:'Mining',exact:true}).click();await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('Veldspar');await expect(rows.first()).toContainText('Perimeter');await expect(rows.first()).toContainText('worth');
 await ledger.getByRole('button',{name:'All',exact:true}).click();await page.keyboard.press('/');await expect(page.locator('#ledger-search')).toBeFocused();await page.keyboard.type('bounty');await expect(rows).toHaveCount(1);await page.locator('#ledger-search').fill('');
 if(testInfo.project.name!=='mobile'){const amount=wallet.locator('[data-sort="ledger:amount"]');await amount.click();await expect(amount).toHaveAttribute('aria-sort','descending');await expect(rows.first()).toContainText('1,500,000.00');await amount.click();await expect(rows.first()).toContainText('-5,500.00');await wallet.locator('[data-sort="ledger:date"]').click();}
 await rows.filter({hasText:'Bounty prizes in Jita'}).locator('b').click();await expect(page.locator('#drawer-title')).toHaveText('Bounty prizes');await expect(page.locator('#drawer')).toContainText('Balance after');await expect(page.locator('#drawer')).toContainText('12,500,000.25 ISK');await page.keyboard.press('Escape');
 // The wingmate's ledger sits one tap away.
 await ledger.locator('[data-show-pilot="Decxus"]').click();await expect(ledger.locator('.ledger')).toHaveAttribute('data-pilot','decxus');
 expect(privateEsi).toEqual([]);expect(errors).toEqual([]);
});
test('clones tab shows attributes, implants, home station and jump clones',async({page},testInfo)=>{
 await mockApp(page,{connected:true});await openApp(page);await tab(page,'clones');const clones=page.locator('#clones-content');
 await expect(clones).toContainText('Intelligence');await expect(clones).toContainText('23');await expect(clones).toContainText('2 bonus remaps');await expect(clones).toContainText('Ocular Filter - Basic');await expect(clones).toContainText('Home: Jita IV');await expect(clones).toContainText('Staging');await expect(clones).toContainText('Player structure');await expect(clones).toContainText('Next clone jump');
 await expect(clones.locator('.readout')).toContainText('Active implants');await expect(clones.locator('.attrs li')).toHaveCount(5);
 await page.screenshot({path:testInfo.outputPath('clones.png'),fullPage:true});
});
test('one failed endpoint keeps the rest of the wallet visible',async({page})=>{
 await mockApp(page,{connected:true,walletFail:true});await openApp(page);await tab(page,'wallet');const wallet=page.locator('#ledger-content');await expect(wallet).toContainText('permission was declined');await expect(wallet).toContainText('bounty prizes');
});
test('training-only grants explain missing permissions and old snapshots ask for a refresh',async({page})=>{
 await mockApp(page,{connected:true,trainingOnly:true});await openApp(page);await tab(page,'wallet');await expect(page.locator('#ledger-content')).toContainText('Permission not granted');
 await page.unrouteAll({behavior:'ignoreErrors'});await mockApp(page,{connected:true,oldSnapshot:true});await page.reload();await tab(page,'clones');await expect(page.locator('#clones-content')).toContainText('Not synced yet');
});
test('refresh asks the backend to sync instead of calling private ESI',async({page})=>{
 const {calls,privateEsi}=await mockApp(page,{connected:true});await openApp(page);await page.locator('#refresh').click();await expect.poll(()=>calls.some(c=>c.path==='/api/sync'&&c.method==='POST')).toBe(true);expect(privateEsi).toEqual([]);
});
test('connect navigates to the backend consent page',async({page})=>{
 await mockApp(page);await openApp(page);await page.locator('.me-banner [data-connect]').click();await expect(page).toHaveURL(`${API}/auth/start?pilot=${IDS[0]}`);
});
test('an expired backend session falls back to the shared snapshot',async({page})=>{
 const {errors}=await mockApp(page,{connected:true,expired:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('333,000');await expect(page.locator('#bridge')).not.toContainText('12,500,000.25');expect(errors).toEqual([]);
});
test('the callback fragment is consumed, scrubbed and followed by a private session',async({page})=>{
 await mockApp(page);await page.goto(`/#backend_session=${opaque.slice(0,42)}0&pilot=${IDS[0]}&expires=${Date.now()+3600000}`);await expect(page.locator('#sync-status')).toContainText('Synced');expect(page.url()).not.toContain('backend_session');await expect(page.locator('#bridge')).toContainText('12,500,000.25 ISK');
});
test('a connection link the browser did not start cannot replace a connected pilot’s session',async({page})=>{
 const {calls}=await mockApp(page,{connected:'first'});
 await page.goto(`/#backend_session=${'x'.repeat(43)}&pilot=${IDS[0]}&expires=${Date.now()+3600000}`);await expect(page.locator('#sync-status')).toContainText('Synced');
 expect(page.url()).not.toContain('backend_session');await expect(page.locator('#notice')).toContainText('already connected');
 await expect(page.locator('#bridge')).toContainText('12,500,000.25 ISK');
 expect(calls.filter(c=>c.authorization).every(c=>c.authorization===`Bearer ${opaque.slice(0,42)}0`)).toBe(true);
});
test('disconnect removes private data from the page',async({page})=>{
 const {calls}=await mockApp(page,{connected:'first'});await openApp(page);const overview=page.locator('#bridge');await expect(overview).toContainText('12,500,000.25');page.once('dialog',d=>d.accept());await page.locator('.me-banner').getByRole('button',{name:'Disconnect'}).click();await expect(overview).not.toContainText('12,500,000.25');expect(calls.some(c=>c.path==='/api/disconnect')).toBe(true);
 await tab(page,'wallet');await expect(page.locator('#ledger-content')).toContainText('Connect this pilot');
});
