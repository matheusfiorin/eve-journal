import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,addEntry,data,KEY} from './fixtures.js';
test('public profiles, navigation and overview are usable without login',async({page})=>{
 const {errors}=await mockApp(page);await openApp(page);
 await expect(page.locator('.pilot-card')).toHaveCount(2);await expect(page.locator('.pilot-card').first()).toContainText('Fiofka');await expect(page.locator('.pilot-card').nth(1)).toContainText('Decxus');
 await expect(page.locator('.pilot-card').first()).toContainText('Test Flight Academy');await expect(page.locator('.pilot-card').first()).toContainText('Security status');
 for(const name of ['training','goals','journal','overview'])await tab(page,name);
 await page.getByRole('button',{name:'Write an entry'}).click();await expect(page.locator('#journal')).toBeVisible();expect(errors).toEqual([]);
});
test('journal creates, edits, filters, persists and deletes an entry',async({page})=>{
 const {errors}=await mockApp(page);await openApp(page);await addEntry(page);
 await page.locator('#entries').getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#journal-form').getByLabel('Private notes').fill('We learned to bookmark exits.');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('#entries')).toContainText('bookmark exits');await page.locator('#journal-search').fill('bookmark');await expect(page.locator('.entry')).toHaveCount(1);await page.locator('#journal-search').fill('no-match');await expect(page.locator('.entry')).toHaveCount(0);await page.locator('#journal-search').fill('');
 await page.reload();await tab(page,'journal');await expect(page.locator('#entries')).toContainText('bookmark exits');
 page.once('dialog',d=>d.accept());await page.locator('#entries').getByRole('button',{name:/^Delete /}).click();await expect(page.locator('.entry')).toHaveCount(0);expect(errors).toEqual([]);
});
test('journal filters combine pilot, category and text',async({page})=>{
 await mockApp(page,{data});await openApp(page);await tab(page,'journal');await page.locator('#journal-pilot').selectOption('Decxus');await page.locator('#journal-category').selectOption('Adventure');await page.locator('#journal-search').fill('connection');await expect(page.locator('.entry')).toHaveCount(1);await expect(page.locator('.entry')).toContainText('Wormhole discovery');await page.locator('#journal-category').selectOption('Milestone');await expect(page.locator('.entry')).toHaveCount(0);
});
test('draft recovers after reload and discard does not delete saved entries',async({page})=>{
 await mockApp(page,{data});await openApp(page);await tab(page,'journal');await page.locator('#journal-form').getByLabel('Entry title').fill('Unfinished thought');await page.locator('#journal-form').getByLabel('Private notes').fill('Remember to bring probes.');await expect(page.locator('#draft-status')).toContainText('Draft saved');await page.reload();await tab(page,'journal');await expect(page.locator('#journal-form').getByLabel('Entry title')).toHaveValue('Unfinished thought');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Discard draft'}).click();await expect(page.locator('#journal-form').getByLabel('Entry title')).toHaveValue('');await expect(page.locator('.entry')).toHaveCount(2);
});
test('cancel entry edit preserves the saved entry',async({page})=>{
 await mockApp(page,{data});await openApp(page);await tab(page,'journal');await page.locator('.entry').first().getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#journal-form').getByLabel('Entry title').fill('Should not save');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel edit',exact:true}).click();await expect(page.locator('#entries')).not.toContainText('Should not save');await expect(page.locator('#entries')).toContainText('Wormhole discovery');
});
test('goals create, edit, complete, filter, reopen and delete',async({page})=>{
 await mockApp(page);await openApp(page);await tab(page,'goals');const f=page.locator('#goal-form');await f.getByLabel('Next milestone').fill('Fly a Heron');await f.getByRole('combobox',{name:'Pilot',exact:true}).selectOption('Decxus');await f.getByRole('combobox',{name:'Focus',exact:true}).selectOption('Ships');await f.getByLabel('Target date').fill('2026-12-01');await f.getByRole('button',{name:'Add goal'}).click();await expect(page.locator('.goal')).toContainText('2026-12-01');
 await page.locator('.goal').getByRole('button',{name:'Edit',exact:true}).click();await f.getByLabel('Next milestone').fill('Fly a Buzzard');await f.getByRole('button',{name:'Save changes'}).click();await page.locator('.goal input').click();await expect(page.locator('.goal')).toHaveCount(0);await page.locator('#goal-filter').selectOption('done');await expect(page.locator('.goal')).toContainText('Fly a Buzzard');await page.locator('.goal input').click();await page.locator('#goal-filter').selectOption('open');await expect(page.locator('.goal')).toHaveCount(1);page.once('dialog',d=>d.accept());await page.locator('.goal').getByRole('button',{name:/^Delete /}).click();await expect(page.locator('.goal')).toHaveCount(0);
});
test('overview reflects local goals and journal history',async({page})=>{
 await mockApp(page,{data});await openApp(page);await expect(page.locator('#flight-summary')).toContainText('1');await expect(page.locator('#next-chapter')).toContainText('Fly a cruiser');await expect(page.locator('#next-chapter')).toContainText('Wormhole discovery');
});
test('markup in notes and imported titles stays literal',async({page})=>{
 await mockApp(page);await openApp(page);await addEntry(page,{title:'<img src=x onerror=alert(1)>',body:'<script>window.compromised=true</script>'});await expect(page.locator('#entries img')).toHaveCount(0);await expect(page.locator('#entries script')).toHaveCount(0);await expect(page.locator('#entries')).toContainText('<script>');expect(await page.evaluate(()=>window.compromised)).toBeUndefined();
});
test('export contains records but no tokens or settings',async({page})=>{
 await mockApp(page,{data,connected:true});await openApp(page);await tab(page,'journal');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export local backup'}).click();const download=await downloadPromise;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const text=Buffer.concat(chunks).toString();expect(JSON.parse(text)).toEqual(data);expect(text).not.toContain('test-client');expect(text).not.toContain('token');
});
test('backup merge preserves existing entries and rejects malformed imports',async({page})=>{
 await mockApp(page,{data});await openApp(page);await tab(page,'journal');page.once('dialog',d=>d.accept());await page.locator('#import').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,goals:[],entries:[{...data.entries[0],id:'third',title:'Third entry'}]}))});await expect(page.locator('.entry')).toHaveCount(3);await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await expect(page.locator('#notice')).toContainText('Import failed');await expect(page.locator('.entry')).toHaveCount(3);
});
test('corrupt storage blocks writes and offers raw recovery',async({page})=>{
 await mockApp(page,{corrupt:true});await openApp(page);await tab(page,'journal');await expect(page.getByRole('button',{name:'Save entry locally'})).toBeDisabled();await expect(page.locator('#recover')).toBeVisible();await expect(page.locator('#import')).toBeDisabled();await expect(page.locator('#notice')).toContainText('blocked');expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('{broken');
});
test('a change in another tab blocks stale saves and preserves the draft',async({page})=>{
 await mockApp(page);await openApp(page);await tab(page,'journal');await page.locator('#journal-form').getByLabel('Entry title').fill('My draft');await page.locator('#journal-form').getByLabel('Private notes').fill('Do not overwrite a concurrent entry.');await page.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key:KEY,data});await page.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#notice')).toContainText('Another tab');await expect(page.locator('#journal-form').getByLabel('Entry title')).toHaveValue('My draft');expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).entries.length,KEY)).toBe(2);
});
test('public refresh failure keeps previous profiles visible',async({page})=>{
 const {state}=await mockApp(page);await openApp(page);state.fail=true;await page.getByRole('button',{name:'Refresh ESI'}).click();await expect(page.locator('#sync-status')).toContainText('Refresh failed');await expect(page.locator('.pilot-card').first()).toContainText('Test Flight Academy');await expect(page.getByRole('button',{name:'Refresh ESI'})).toBeEnabled();
});
test('unknown characters have an actionable error',async({page})=>{
 await mockApp(page,{missing:true});await openApp(page);await expect(page.locator('.pilot-card').first()).toContainText('Character not found');await expect(page.locator('.pilot-card').first().getByRole('button')).toBeDisabled();
});
test('settings reject duplicate pilots and persist valid edits',async({page})=>{
 await mockApp(page);await openApp(page);await page.getByRole('button',{name:'Configure pilots'}).click();await page.getByLabel('Second pilot').fill('fiofka');await page.getByRole('button',{name:'Save configuration'}).click();await expect(page.locator('#settings-error')).toContainText('different');await page.getByLabel('Second pilot').fill('Decxus');await page.getByRole('button',{name:'Save configuration'}).click();await expect(page.locator('#settings')).not.toBeVisible();
});
test('layout stays within viewport and captures overview and journal',async({page},testInfo)=>{
 await mockApp(page,{data});await openApp(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('overview.png'),fullPage:true});await tab(page,'journal');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('journal.png'),fullPage:true});
});
test('new Both pilots journal entries become filterable without reloading',async({page})=>{
 await mockApp(page);await openApp(page);await addEntry(page,{pilot:'Both pilots'});await page.locator('#journal-pilot').selectOption('Both pilots');await expect(page.locator('.entry')).toHaveCount(1);
});
test('raw recovery download preserves corrupt bytes rather than exporting an empty journal',async({page})=>{
 await mockApp(page,{corrupt:true});await openApp(page);await tab(page,'journal');const pending=page.waitForEvent('download');await page.locator('#recover').click();const stream=await(await pending).createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);expect(Buffer.concat(chunks).toString()).toBe('{broken');await page.locator('#export').click();await expect(page.locator('#notice')).toContainText('Export is blocked');
});
test('storage quota failure leaves the form and saved journal intact',async({page})=>{
 await mockApp(page);await openApp(page);await tab(page,'journal');await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new Error('Storage quota exceeded');return original.call(this,k,v);};},KEY);
 await page.locator('#journal-form').getByLabel('Entry title').fill('Unsaved flight');await page.locator('#journal-form').getByLabel('Private notes').fill('Keep this text if storage is full.');await page.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#notice')).toContainText('not saved');await expect(page.locator('#journal-form').getByLabel('Entry title')).toHaveValue('Unsaved flight');await expect(page.locator('.entry')).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
});
test('two browser tabs cannot overwrite each other and the draft survives reload',async({page,context})=>{
 await mockApp(page);await openApp(page);const second=await context.newPage();await mockApp(second);await openApp(second);await addEntry(second,{title:'Saved in second tab'});await expect(page.locator('#notice')).toContainText('Another tab');await tab(page,'journal');await page.locator('#journal-form').getByLabel('Entry title').fill('First tab draft');await page.locator('#journal-form').getByLabel('Private notes').fill('Keep both stories.');await page.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#notice')).toContainText('Reload');await page.reload();await expect(page.locator('#entries')).toContainText('Saved in second tab');await expect(page.locator('#journal-form').getByLabel('Entry title')).toHaveValue('First tab draft');await second.close();
});
test('private notes never leave the browser in API requests',async({page})=>{
 const requests=[];page.on('request',r=>{if(r.url().startsWith('https://'))requests.push(r.url()+' '+(r.postData()||''));});await mockApp(page);await openApp(page);await addEntry(page,{body:'PRIVATE-NOTE-SENTINEL-93812'});await tab(page,'overview');await page.getByRole('button',{name:'Refresh ESI'}).click();await expect(page.locator('#sync-status')).toContainText('Last refresh');expect(requests.join('\n')).not.toContain('PRIVATE-NOTE-SENTINEL-93812');
});
test('entry edits recover as edits instead of creating a duplicate',async({page})=>{
 await mockApp(page,{data});await openApp(page);await tab(page,'journal');await page.locator('.entry').first().getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#journal-form').getByLabel('Private notes').fill('Recovered edit.');await expect(page.locator('#draft-status')).toContainText('Draft saved');await page.reload();await expect(page.locator('#entry-submit')).toHaveText('Save changes');await page.locator('#entry-submit').click();await expect(page.locator('.entry')).toHaveCount(2);await expect(page.locator('#entries')).toContainText('Recovered edit.');
});
