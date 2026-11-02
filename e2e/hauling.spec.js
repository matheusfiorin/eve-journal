import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('hauling plans a risk-weighted route with live gate camps and sends it to the autopilot',async({page},testInfo)=>{
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'hauling');const haul=page.locator('#hauling');
 const stops=haul.locator('.stop-row input');await expect(stops).toHaveCount(2);await expect(stops.first()).toHaveValue('Jita');await expect(stops.last()).toHaveValue('Amarr');
 await page.locator('#haul-value').fill('500000000');await page.locator('#haul-plan').click();
 await expect(page.locator('#haul-status')).toContainText('Live: 3 kills in the last hour');
 await expect(haul.locator('.mode')).toHaveCount(3);await expect(haul.locator('.mode.on')).toContainText('Balanced');await expect(haul.locator('.mode.on')).toContainText('3 jumps');
 const hops=haul.locator('.hop-row');await expect(hops).toHaveCount(4);
 const niarja=hops.filter({hasText:'Niarja'});await expect(niarja).toContainText('3 on your gates');await expect(niarja).toContainText('Smartbombs');await expect(niarja).toHaveClass(/danger/);
 await expect(haul.locator('.alert')).toContainText('Watch Niarja');await expect(haul).toContainText('Blockade runner (suggested)');
 await expect(niarja.locator('a')).toHaveAttribute('href','https://zkillboard.com/system/30003504/');
 await page.screenshot({path:testInfo.outputPath('hauling.png'),fullPage:true});
 await haul.getByRole('button',{name:'Send to Fiofka’s autopilot'}).click();await expect(page.locator('#haul-sent')).toContainText('Autopilot set: 3 waypoints');
 expect(ctx.state.waypoints).toEqual([30000144,30003504,30002187]);
 // A refresh re-plans with the live camps still priced in.
 await page.locator('#refresh').click();await expect(page.locator('#sync-status')).toContainText('Synced');await expect(page.locator('#haul-status')).toContainText('Live: 3 kills');await expect(niarja).toContainText('3 on your gates');
 await page.locator('#haul-add').click();await stops.nth(1).fill('Niarja');await page.locator('#haul-optimize').check();await page.locator('#haul-end').selectOption('free');
 await stops.nth(2).fill('Perimeter');await page.locator('#haul-plan').click();
 await expect(haul.locator('.card h3')).toContainText('Jita → Perimeter → Niarja');
 await stops.nth(1).fill('Nowhere');await page.locator('#haul-plan').click();await expect(page.locator('#haul-status')).toContainText('Unknown system: Nowhere');
 expect(ctx.errors).toEqual([]);
});
