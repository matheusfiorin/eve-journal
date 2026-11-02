import {test,expect} from '@playwright/test';
import {mockApp,openApp,isMobile} from './fixtures.js';
const hash=page=>new URL(page.url()).hash;
test('the rail moves between destinations and remembers each one’s last view',async({page})=>{
 test.skip(isMobile(page),'the rail is a desktop control');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 const rail=page.locator('.rail');await expect(rail.locator('[data-dest="bridge"]')).toHaveAttribute('aria-current','page');
 await rail.locator('[data-dest="earn"]').click();await expect(page.locator('#industry')).toBeVisible();expect(hash(page)).toBe('#earn/build');
 await expect(rail.locator('[data-dest="earn"]')).toHaveAttribute('aria-current','page');await expect(page.locator('#viewbar .screen-title')).toHaveText('Earn');
 await page.locator('#viewbar').getByRole('tab',{name:'Mine'}).click();await expect(page.locator('#mining')).toBeVisible();expect(hash(page)).toBe('#earn/mine');
 await rail.locator('[data-dest="navigate"]').click();await expect(page.locator('#map')).toBeVisible();expect(hash(page)).toBe('#navigate/map');
 await rail.locator('[data-dest="earn"]').click();await expect(page.locator('#mining')).toBeVisible();
 await page.locator('#rail-toggle').click();await expect(page.locator('body')).toHaveAttribute('data-rail','collapsed');await expect(rail.locator('[data-dest="earn"]')).toHaveAttribute('aria-label','Earn');
 expect(errors).toEqual([]);
});
test('the command palette opens with Control+K and jumps to screens and systems',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 await page.keyboard.press('Control+K');const palette=page.locator('#palette');await expect(palette).toBeVisible();await expect(page.locator('#palette-input')).toBeFocused();
 await page.keyboard.type('mine');await expect(palette.locator('[aria-selected="true"]')).toContainText('Mine');
 await page.keyboard.press('Enter');await expect(palette).toBeHidden();await expect(page.locator('#mining')).toBeVisible();expect(hash(page)).toBe('#earn/mine');
 // Systems come from the universe graph once the market snapshot has loaded.
 await expect(page.locator('#mining .opps .opp').first()).toBeVisible();
 await page.keyboard.press('Control+K');await page.keyboard.type('niarja');await expect(palette.locator('[aria-selected="true"]')).toContainText('System');
 await page.keyboard.press('Enter');await expect(page.locator('#map-modal')).toBeVisible();await expect(page.locator('#map-modal-title')).toHaveText('Niarja');
 await page.locator('#map-modal-close').click();
 await page.keyboard.press('Control+K');await page.keyboard.type('jitxq');await expect(palette).toContainText('No match for “jitxq”');await page.keyboard.press('Escape');await expect(palette).toBeHidden();
 expect(errors).toEqual([]);
});
test('keyboard shortcuts switch destinations and views and show the help sheet',async({page})=>{
 test.skip(isMobile(page),'hardware keyboard shortcuts');
 await mockApp(page);await openApp(page);
 await page.keyboard.press('g');await page.keyboard.press('e');await expect(page.locator('#industry')).toBeVisible();
 await page.keyboard.press('2');await expect(page.locator('#mining')).toBeVisible();
 await page.keyboard.press('g');await page.keyboard.press('j');await expect(page.locator('#logbook')).toBeVisible();
 await page.keyboard.press('/');await expect(page.locator('#journal-search')).toBeFocused();await page.keyboard.type('g');await expect(page.locator('#logbook')).toBeVisible();
 await page.locator('#journal-search').blur();
 await page.keyboard.press('Shift+?');await expect(page.locator('#drawer')).toBeVisible();await expect(page.locator('#drawer-title')).toHaveText('Keyboard shortcuts');
 await page.keyboard.press('Escape');await expect(page.locator('#drawer')).toBeHidden();
 await page.keyboard.press('[');await expect(page.locator('body')).toHaveAttribute('data-rail','collapsed');
});
test('old tab hashes open their new homes',async({page})=>{
 await mockApp(page);
 for(const [old,view,now] of [['mining','mining','#earn/mine'],['empire','strengths','#wing/crew'],['notes','logbook','#logbook'],['wallet','ledger','#ledger'],['goals','goals','#wing/goals'],['overview','bridge','#bridge'],['map','map','#navigate/map']]){
  await page.goto("about:blank");await page.goto(`/#${old}`);await expect(page.locator(`#${view}`)).toBeVisible();expect(hash(page)).toBe(now);
 }
});
test('the mobile tab bar reaches every destination through More',async({page})=>{
 test.skip(!isMobile(page),'the tab bar is the phone navigation');
 const {errors}=await mockApp(page);await openApp(page);
 const bar=page.locator('#tabbar');await expect(bar).toBeVisible();await expect(page.locator('.rail')).toBeHidden();
 await bar.getByRole('button',{name:'Earn'}).click();await expect(page.locator('#industry')).toBeVisible();await expect(bar.locator('[data-dest="earn"]')).toHaveAttribute('aria-current','page');
 await bar.getByRole('button',{name:'More'}).click();const sheet=page.locator('#drawer');await expect(sheet).toBeVisible();
 await sheet.getByRole('button',{name:/Ledger/}).click();await expect(sheet).toBeHidden();await expect(page.locator('#ledger')).toBeVisible();await expect(bar.locator('#tabbar-more')).toHaveAttribute('aria-current','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
