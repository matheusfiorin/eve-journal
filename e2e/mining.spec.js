import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
test('mining ranks nearby belts by ISK per hour with kills, traffic, ships and the ledger',async({page},testInfo)=>{
 test.setTimeout(90000);
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'mining');const mining=page.locator('#mining'),drawer=page.locator('#drawer');
 await expect(page.locator('#mining-system')).toContainText('Jita · Fiofka’s location');
 const sum=mining.locator('.earn-sum');await expect(sum.locator('.readout>div')).toHaveCount(3);await expect(sum).toContainText('Venture');await expect(sum).toContainText('Venture (not trained yet)');
 await expect(sum.locator('.earn-together')).toContainText('You and Decxus both do best at Perimeter. Mine together and share one hauler trip.');
 const sites=mining.locator('.rows__row');await expect(sites).toHaveCount(2);
 await expect(sites.first()).toContainText('Perimeter');await expect(sites.first()).toContainText('busy');
 await expect(sites.nth(1)).toContainText('Niarja');await expect(sites.nth(1)).toContainText('Pyroxeres');await expect(mining).not.toContainText('Tama');
 await page.screenshot({path:testInfo.outputPath('mining.png'),fullPage:true});
 // A belt row opens its details: ores, risk and the route, with autopilot.
 await sites.nth(1).click();await expect(page.locator('#drawer-title')).toHaveText('Niarja');
 await expect(drawer).toContainText('3 ships killed in the last hour');await expect(drawer).toContainText('3 belts');await expect(drawer).toContainText('Pyroxeres');
 await expect(drawer.locator('.hops li')).toHaveText(['0.9Jita','1.0Perimeter','0.5Niarja']);
 await page.screenshot({path:testInfo.outputPath('mining-drawer.png')});
 await drawer.getByRole('button',{name:'Send to Fiofka’s autopilot'}).click();await expect(page.locator('#mining-sent')).toContainText('Autopilot set');expect(ctx.state.waypoints).toEqual([30000144,30003504]);
 await page.keyboard.press('Escape');
 await sites.first().click();await expect(drawer).toContainText('1 jump');await expect(drawer).toContainText('4 belts');await expect(drawer).toContainText('busy, belts may be stripped');await page.keyboard.press('Escape');
 // Ships, ore values and the ledger live behind the summary's buttons.
 await mining.getByRole('button',{name:'Compare ships'}).click();await expect(drawer.locator('tbody tr')).toHaveCount(4);await expect(drawer).toContainText('Train Mining Frigate I');await page.keyboard.press('Escape');
 await mining.getByRole('button',{name:'Ore values'}).click();await expect(drawer.locator('tbody tr')).toHaveCount(3);await page.keyboard.press('Escape');
 await mining.getByRole('button',{name:'Mining ledger'}).click();await expect(drawer).toContainText('2 days in the last 30');await expect(drawer).toContainText('Perimeter');
 await drawer.getByRole('button',{name:'See mining income'}).click();await expect(page.locator('#ledger')).toBeVisible();await tab(page,'mining');
 await mining.getByRole('button',{name:'Decxus’s spots'}).click();await expect(drawer).toContainText('Perimeter');await page.keyboard.press('Escape');
 // Sorting and filtering.
 // Column headers sort on desktop; phones get the toolbar's Sort select instead.
 const sortBy=async key=>isMobile(page)?page.locator('#mining-sort').selectOption(key):mining.locator(`.sort[data-sort="${key}"]`).click();
 await sortBy('kills');await expect(page.locator('#mining-sort')).toHaveValue('kills');await expect(sites.first()).toContainText('Perimeter');
 await sortBy('traffic');await expect(page.locator('#mining-sort')).toHaveValue('traffic');await expect(sites.first()).toContainText('Niarja');
 if(!isMobile(page)){await expect(mining.locator('.sort[data-sort="traffic"]')).toHaveAttribute('aria-sort','ascending');await expect(page.locator('#mining-sort')).toBeHidden();}
 isMobile(page)?await page.locator('#mining-sort').selectOption(''):await mining.locator('.sort[data-sort="traffic"]').click();await expect(page.locator('#mining-sort')).toHaveValue('');await expect(sites.first()).toContainText('Perimeter');
 await page.locator('#mining-filter').fill('pyrox');await expect(sites.filter({visible:true})).toHaveCount(1);await page.locator('#mining-filter').fill('');
 // The system link opens the map.
 await sites.first().locator('a[data-system]').click();await expect(page.locator('#map-modal')).toBeVisible();await expect(page.locator('#map-modal-title')).toHaveText('Perimeter');await page.locator('#map-modal-close').click();
 await page.locator('#mining-lowsec').check();await expect(sites.filter({hasText:'Tama'})).toContainText('low-sec');
 expect(ctx.errors).toEqual([]);
});
