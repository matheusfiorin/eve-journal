import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('mining ranks nearby belts by ISK per hour with kills, traffic, ships and the ledger',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'mining');const mining=page.locator('#mining');
 await expect(page.locator('#mining-system')).toContainText('Jita · Fiofka’s location');
 const sites=mining.locator('.opps .opp');await expect(sites).toHaveCount(2);
 await expect(sites.first()).toContainText('Perimeter');await expect(sites.first()).toContainText('1 jump');await expect(sites.first()).toContainText('4 belts');await expect(sites.first()).toContainText('busy');
 await expect(sites.nth(1)).toContainText('Niarja');await expect(sites.nth(1)).toContainText('3 ships killed in the last hour');await expect(sites.nth(1)).toContainText('Pyroxeres');
 await expect(mining).toContainText('Venture (not trained yet)');await expect(mining).not.toContainText('Tama');
 await expect(mining.locator('table').first().locator('tbody tr')).toHaveCount(4);await expect(mining).toContainText('Train Mining Frigate I');
 await expect(mining.locator('table').nth(1).locator('tbody tr')).toHaveCount(3);
 const last=mining.locator('article').filter({hasText:'Last 30 days'});await expect(last).toContainText('2 days in the last 30');await expect(last).toContainText('Perimeter');
 await expect(mining.locator('article').filter({hasText:'Decxus’s best spots'})).toContainText('Perimeter');
 await sites.nth(1).locator('details summary').click();await expect(sites.nth(1).locator('.hops li')).toHaveText(['0.9Jita','1.0Perimeter','0.5Niarja']);
 await page.screenshot({path:testInfo.outputPath('mining.png'),fullPage:true});
 await page.locator('#mining-lowsec').check();await expect(mining.locator('.opps .opp').filter({hasText:'Tama'})).toContainText('low-sec');
 expect(errors).toEqual([]);
});
