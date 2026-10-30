import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,KEY} from './fixtures.js';
test('API data leads the dashboard and local features are secondary',async({page})=>{
 const {errors}=await mockApp(page);await openApp(page);await expect(page.locator('#server-status')).toContainText('25,432');await expect(page.locator('#career-content')).toContainText('Test Flight Academy');await expect(page.locator('#career-content')).toContainText('Joined');await expect(page.locator('#career-content')).toContainText('120 members');await expect(page.locator('#api-summary')).toContainText('CONNECTED PILOTS');await expect(page.locator('#flight-summary')).not.toBeVisible();await expect(page.locator('#journal')).not.toBeVisible();expect(errors).toEqual([]);
});
test('operations show authenticated wallet, ship, location, and industry data',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:true,operations:true});await openApp(page);await tab(page,'operations');const panel=page.locator('#operations-content>.panel').first();await expect(panel).toContainText('12,500,000.25');await expect(panel).toContainText('Heron');await expect(panel).toContainText('Our first explorer');await expect(panel).toContainText('Jita');await expect(panel).toContainText('2 runs');await expect(panel).toContainText('active');await page.screenshot({path:testInfo.outputPath('operations.png'),fullPage:true});expect(errors).toEqual([]);
});
test('older training-only grants remain usable and operations explain missing permission',async({page})=>{
 await mockApp(page,{connected:true});const requests=[];page.on('request',r=>{if(/\/(wallet|location|ship|industry\/jobs)\//.test(r.url()))requests.push(r.url());});await openApp(page);await tab(page,'operations');await expect(page.locator('#operations-content')).toContainText('Permission not granted');expect(requests).toEqual([]);await tab(page,'training');await expect(page.locator('#training-content')).toContainText('Gunnery');
});
test('one denied operations endpoint does not hide the other data',async({page})=>{
 await mockApp(page,{connected:true,operations:true,walletFail:true});await openApp(page);await tab(page,'operations');const panel=page.locator('#operations-content>.panel').first();await expect(panel).toContainText('access expired or was declined');await expect(panel).toContainText('Heron');await expect(panel).toContainText('Jita');
});
test('operations data is cleared on disconnect and never enters local journal storage',async({page})=>{
 await mockApp(page,{connected:true,operations:true});await openApp(page);expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();await page.locator('[data-disconnect]').first().click();await tab(page,'operations');const panel=page.locator('#operations-content>.panel').first();await expect(panel).not.toContainText('12,500,000.25');await expect(panel).toContainText('Connect this pilot');
});
test('no industry jobs is a real empty state, not a placeholder list',async({page})=>{
 await mockApp(page,{connected:true,operations:true,noJobs:true});await openApp(page);await tab(page,'operations');await expect(page.locator('#operations-content')).toContainText('No current industry jobs');
});
