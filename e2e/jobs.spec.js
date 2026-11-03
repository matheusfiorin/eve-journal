import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('jobs lists both pilots’ industry jobs: ready first, progress, slots and a detail drawer',async({page},testInfo)=>{
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'jobs');
 await expect(page).toHaveURL(/#earn\/jobs$/);
 const rows=page.locator('#jobs-content .job');await expect(rows).toHaveCount(3);
 await expect(rows.first()).toContainText('Ready to deliver');await expect(rows.first()).toContainText('Copying');await expect(rows.first()).toContainText('4 copies × 300 runs');
 await expect(rows.nth(1)).toContainText('Decxus');await expect(rows.nth(1)).toContainText('ME research');
 await expect(rows.nth(2)).toContainText('Heron');await expect(rows.nth(2)).toContainText('2 runs');
 const summary=page.locator('#jobs-summary');await expect(summary).toContainText('Ready to deliver');await expect(summary.locator('dd').nth(1)).toHaveText('1');await expect(summary.locator('dd').first()).toHaveText('2');
 const chips=page.locator('#jobs-summary .slot-chip');await expect(chips).toHaveCount(2);
 // Slot totals come from the pilots' skills straight away, without visiting a market screen first.
 await expect(chips.first()).toContainText('build 1/1 · science 0/1');await expect(chips.nth(1)).toContainText('build 0/1 · science 1/1 · 1 idle build slot');
 await expect(rows.nth(2).locator('[role=progressbar]')).toHaveAttribute('aria-valuenow','50');
 await page.screenshot({path:testInfo.outputPath('jobs.png'),fullPage:true});
 await rows.nth(2).click();const drawer=page.locator('#drawer');await expect(drawer).toBeVisible();await expect(drawer).toContainText('Manufacturing');await expect(drawer).toContainText('125,000 ISK');await expect(drawer).toContainText('Jita IV - Moon 4');
 expect(ctx.errors).toEqual([]);
});
test('slot totals come from the pilots’ skills even without a market snapshot',async({page})=>{
 await mockApp(page,{connected:'first',noMarket:true});await openApp(page);await tab(page,'jobs');
 const chips=page.locator('#jobs-summary .slot-chip');await expect(chips).toHaveCount(2);
 await expect(chips.first()).toContainText('build 1/1 · science 0/1');await expect(chips.nth(1)).toContainText('1 idle build slot');
});
test('the minute tick updates countdowns in place without dropping keyboard focus',async({page})=>{
 await page.clock.install();await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'jobs');
 const rows=page.locator('#jobs-content .job');await expect(rows).toHaveCount(3);
 const before=await rows.nth(2).locator('[role=progressbar]').getAttribute('aria-valuenow');
 await rows.nth(2).focus();const node=await rows.nth(2).elementHandle();
 await page.clock.runFor(15*60000); // under the mocked session's 20-minute expiry
 await expect(rows.nth(2).locator('[role=progressbar]')).not.toHaveAttribute('aria-valuenow',before);
 await expect(rows.nth(2)).toBeFocused();expect(await node.evaluate(el=>el.isConnected)).toBe(true);
});
test('jobs explain an empty board',async({page})=>{
 await mockApp(page,{connected:'first',noJobs:true});await openApp(page);await tab(page,'jobs');
 await expect(page.locator('#jobs-content .job')).toHaveCount(1,'only the wingmate’s shared job remains');
});
