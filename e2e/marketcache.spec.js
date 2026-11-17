import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
const belts=page=>expect(page.locator('#mining .rows__row')).toHaveCount(2); // needs the gate map, ores and live prices
test('the universe map is fetched once, kept across reloads, and fetched again only for a new version',async({page})=>{
 const ctx=await mockApp(page,{connected:'first'}),universe=()=>ctx.calls.filter(c=>c.path==='/api/market/universe').length;
 await openApp(page);await tab(page,'mining');await belts(page);
 await expect(page.locator('#mining .rows__row').nth(1)).toContainText('Pyroxeres');
 expect(universe()).toBe(1);
 await page.locator('#refresh').click();await expect(page.locator('#sync-status')).toContainText('Synced');await belts(page);
 await expect.poll(()=>ctx.calls.filter(c=>c.path==='/api/market').length).toBe(2);expect(universe()).toBe(1);
 await page.reload();await openApp(page);await tab(page,'mining');await belts(page);
 expect(universe()).toBe(1);
 ctx.state.universeVersion='u2';await page.reload();await openApp(page);await tab(page,'mining');await belts(page);
 expect(universe()).toBe(2);
 expect(ctx.errors).toEqual([]);
});
test('an older backend that sends the whole market inline still works and no universe document is asked for',async({page})=>{
 const ctx=await mockApp(page,{connected:'first',legacyMarket:true});
 await openApp(page);await tab(page,'mining');await belts(page);
 await expect(page.locator('#mining .rows__row').nth(1)).toContainText('Pyroxeres');
 expect(ctx.calls.filter(c=>c.path==='/api/market/universe')).toEqual([]);expect(ctx.errors).toEqual([]);
});
