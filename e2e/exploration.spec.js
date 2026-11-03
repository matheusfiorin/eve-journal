import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
test('exploration ranks quiet systems, plans a loop, tracks visits and shows wormhole shortcuts',async({page},testInfo)=>{
 test.setTimeout(90000);
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'exploration');const ex=page.locator('#exploration'),drawer=page.locator('#drawer');
 await expect(page.locator('#explore-system')).toContainText('Jita · Fiofka’s location');
 await expect(page.locator('#explore-status')).toContainText('within 10 jumps of Jita');await expect(page.locator('#explore-status')).toContainText('2 recently visited systems');
 const sum=ex.locator('.earn-sum');await expect(sum.locator('.readout>div')).toHaveCount(3);await expect(sum).toContainText('Arrive safely');await expect(sum.locator('.loop-strip li')).toHaveCount(3);
 const rows=ex.locator('.rows__row');await expect(rows).toHaveCount(4,'high-sec only: Tama is low-sec');
 await expect(rows.first()).toContainText('Niarja');await expect(rows.first()).toContainText('300');
 await expect(rows.filter({hasText:'Perimeter'})).toContainText('Visited 2 h ago');
 await page.screenshot({path:testInfo.outputPath('exploration.png'),fullPage:true});
 // Row → drawer with the system's details and its route.
 await rows.first().click();await expect(page.locator('#drawer-title')).toHaveText('Niarja');await expect(drawer).toContainText('Sansha / Blood Raiders');await expect(drawer).toContainText('2 jumps');
 await expect(drawer.locator('.hops li')).toHaveText(['0.9Jita','1.0Perimeter','0.5Niarja']);
 await page.screenshot({path:testInfo.outputPath('exploration-drawer.png')});
 await drawer.getByRole('button',{name:'Mark scanned'}).click();await expect(drawer).toBeHidden();await expect(page.locator('#toasts')).toContainText('Marked Niarja as scanned');
 await expect(rows.first()).not.toContainText('Niarja');await expect(rows.filter({hasText:'Niarja'})).toContainText('Visited under an hour ago');
 await rows.filter({hasText:'Amarr'}).getByRole('button',{name:'Mark scanned'}).click();await expect(rows.filter({hasText:'Amarr'})).toContainText('Visited under an hour ago');
 // Loop plan, explorer fit and EVE-Scout shortcuts open in the drawer.
 await ex.getByRole('button',{name:'Loop plan'}).click();await expect(drawer.locator('.loop li')).toHaveCount(3);await expect(drawer).toContainText('Arrive safely');await page.keyboard.press('Escape');
 await ex.getByRole('button',{name:'Explorer fit and skills'}).click();await expect(drawer).toContainText('Heron');await expect(drawer).toContainText('Astrometrics I');await page.keyboard.press('Escape');
 await expect(page.locator('#explore-scout-btn')).toHaveText('Wormhole shortcuts (1)');await page.locator('#explore-scout-btn').click();
 const scout=drawer.locator('#explore-scout');await expect(scout).toContainText('Niarja');await expect(scout).toContainText('Thera');await expect(scout).toContainText('large ships · 14 h left');await expect(scout.locator('li')).toHaveCount(1,'the Turnur hole leads into wormhole space');await page.keyboard.press('Escape');
 // Sorting, filtering and the security bands.
 const sortBy=async key=>isMobile(page)?page.locator('#explore-sort').selectOption(key):ex.locator(`.sort[data-sort="${key}"]`).click();
 await sortBy('jumps');await expect(rows.first()).toContainText('Jita');await sortBy('kills');await expect(page.locator('#explore-sort')).toHaveValue('kills');
 isMobile(page)?await page.locator('#explore-sort').selectOption(''):await ex.locator('.sort[data-sort="kills"]').click();await expect(page.locator('#explore-sort')).toHaveValue('');
 await page.locator('#explore-filter').fill('amarr');await expect(rows.filter({visible:true})).toHaveCount(1);await page.locator('#explore-filter').fill('');
 await ex.locator('[data-band="low"]').check();await expect(rows.filter({hasText:'Tama'})).toHaveCount(1);
 await ex.locator('.earn-sum').getByRole('button',{name:'Send to Fiofka’s autopilot'}).click();await expect(page.locator('#explore-sent')).toContainText('Autopilot set');
 expect(ctx.state.waypoints.at(-1)).toBe(30000142,'the loop returns to the start');
 await ex.locator('.loop-strip').getByRole('button').first().click();await expect(page.locator('#map-modal')).toBeVisible();await page.locator('#map-modal-close').click();
 await ex.locator('[data-band="low"]').uncheck();await ex.locator('[data-band="hi"]').uncheck();await expect(ex.locator('.state')).toContainText('Pick at least one security band');
 await ex.getByRole('button',{name:'Use high-sec'}).click();await expect(rows).toHaveCount(4);
 expect(ctx.errors).toEqual([]);
});
