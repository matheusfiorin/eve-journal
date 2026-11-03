import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
test('industry ranks starter blueprints with research plans, payback and pilot assignments',async({page},testInfo)=>{
 test.setTimeout(90000);
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'industry');const industry=page.locator('#industry'),drawer=page.locator('#drawer');
 await expect(page.locator('#industry-status')).toContainText('2 cheap T1 blueprints that NPCs sell (seller survey covers 3 of 4 high-sec regions)');
 await expect(page.locator('#industry-system')).toContainText('Jita · Fiofka’s location');await expect(page.locator('#industry-budget')).toHaveValue('12500000');
 // Summary: three figures and the setup in one sentence.
 const sum=industry.locator('.earn-sum');await expect(sum.locator('.readout>div')).toHaveCount(3);await expect(sum).toContainText('Fit your budget');await expect(sum).toContainText('Niarja');
 await expect(sum).toContainText('Alpha clone with');await expect(sum).toContainText('build slot');
 // The wing plan is teamwork: who builds what, never a contest.
 const plan=industry.locator('.wplan');await expect(plan).toContainText('Fiofka builds Hobgoblin I, Decxus builds Rifter. No overlap, so you don’t undercut each other.');
 await expect(plan.locator('.wplan__pilot')).toHaveCount(2);await expect(plan.locator('.wplan__pilot').first()).toContainText('1 of');await expect(plan.locator('.wplan__pilot').first()).not.toContainText('Rifter','Fiofka lacks the skill');
 await expect(industry).not.toContainText(/ leads| vs /);
 const picks=industry.locator('.rows__row');await expect(picks).toHaveCount(2);
 await expect(picks.first()).toContainText('Hobgoblin I');await expect(picks.first()).toContainText('Fiofka’s plan');
 await expect(picks.nth(1)).toContainText('Rifter');await expect(picks.nth(1)).toContainText('Decxus’s plan');await expect(picks.nth(1)).toContainText('Needs skills');
 const facilities=industry.locator('details.earn-more');await facilities.locator('summary').first().click();
 await expect(facilities.locator('.facilities').first().locator('li').first()).toContainText('Niarja III - Factory');await expect(facilities.locator('.facilities').first().locator('li').first()).toContainText('2 jumps');await expect(facilities).not.toContainText('Tama','low-sec stations are never suggested');
 await expect(facilities.locator('.facilities').nth(1).locator('li').first()).toContainText('Perimeter II - Moon 1 - Lab');
 await expect(facilities.locator('.facilities a').first()).toHaveAttribute('href','https://evemaps.dotlan.net/system/Niarja');
 await page.screenshot({path:testInfo.outputPath('industry.png'),fullPage:true});
 // A row opens the drawer with the material bill and the five-leg trip.
 await picks.filter({hasText:'Rifter'}).click();await expect(drawer).toBeVisible();await expect(page.locator('#drawer-title')).toHaveText('Rifter');
 await expect(picks.filter({hasText:'Rifter'})).toHaveAttribute('aria-selected','true');
 await expect(drawer).toContainText('ME 0 → 6');await expect(drawer).toContainText('In Decxus’s plan');await expect(drawer).toContainText('Needs Spaceship Command III');await expect(drawer).toContainText('nearest 3 jumps');
 await expect(drawer.locator('.bill tbody tr')).toHaveCount(2);await expect(drawer.locator('.bill')).toContainText('Tritanium');
 const legs=drawer.locator('.legs>li');await expect(legs.first()).toContainText('Amarr VIII');await expect(legs.first()).toContainText('3 jumps');
 await expect(legs.first().locator('.hops li')).toHaveText(['0.9Jita','1.0Perimeter','0.5Niarja','1.0Amarr']);
 await expect(legs.nth(1)).toContainText('Research to ME 6');await expect(legs.nth(3)).toContainText('Build');await expect(legs.last()).toContainText('Sell');
 await expect(drawer.locator('.trip-link')).toHaveAttribute('href',/dotlan\.net\/route\/Jita:Amarr:Perimeter:Jita:Niarja:Jita/);
 await page.screenshot({path:testInfo.outputPath('industry-drawer.png')});
 await drawer.locator('#drawer-foot .map-btn').click();await expect(page.locator('#map-modal')).toBeVisible();await page.locator('#map-modal-close').click();await expect(page.locator('#map-modal')).toBeHidden();
 await page.keyboard.press('Escape');await expect(drawer).toBeHidden();await expect(picks.filter({hasText:'Rifter'})).not.toHaveAttribute('aria-selected','true');
 await picks.first().click();await expect(drawer).toContainText('NPC sells it at 1 station · nearest here');await expect(drawer).toContainText('Hub price +25% vs 7-day average · likely a spike');await page.keyboard.press('Escape');
 // Keyboard: j/k move along rows, Enter opens the drawer, / focuses the filter.
 if(!isMobile(page)){
  await page.locator('#industry h2').first().click();await page.keyboard.press('j');await expect(picks.first()).toBeFocused();await page.keyboard.press('j');await expect(picks.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('#drawer-title')).toHaveText('Rifter');await page.keyboard.press('Escape');
  await page.keyboard.press('/');await expect(page.locator('#industry-filter')).toBeFocused();
 }
 await page.locator('#industry-filter').fill('hob');await expect(picks.filter({visible:true})).toHaveCount(1);await page.locator('#industry-filter').fill('zzz');await expect(industry.locator('.rows__none')).toBeVisible();await page.locator('#industry-filter').fill('');
 // The guide holds the setup, the stage plan, train-next and the traps.
 await industry.getByRole('button',{name:'Build guide'}).click();await expect(drawer).toContainText('Your industry setup');await expect(drawer).toContainText('Week 1');await expect(drawer).toContainText('Mass Production');await expect(drawer).toContainText('Avoid these traps');
 await drawer.getByRole('button',{name:'Open training'}).click();await expect(drawer).toBeHidden();await expect(page.locator('#training')).toBeVisible();await tab(page,'industry');
 // Toolbar: category, sorting by select and by column header.
 await page.locator('#industry-category').selectOption('Frigate');await expect(picks).toHaveCount(1);await expect(picks.first()).toContainText('Rifter');
 await page.locator('#industry-category').selectOption('');await page.locator('#industry-sort').selectOption('near');await expect(picks.first()).toContainText('Hobgoblin I');
 await page.locator('#industry-sort').selectOption('cheap');await expect(picks.first()).toContainText('Hobgoblin I');await page.locator('#industry-sort').selectOption('');
 if(!isMobile(page)){
  const head=industry.locator('.sort[data-sort="invest"]');await head.click();await expect(page.locator('#industry-sort')).toHaveValue('invest');await expect(industry.locator('.sort[data-sort="invest"]')).toHaveAttribute('aria-sort','ascending');
  await industry.locator('.sort[data-sort="invest"]').click();await expect(page.locator('#industry-sort')).toHaveValue('');
 }
 await page.locator('#industry-budget').fill('1000000');await page.locator('#industry-budget').blur();
 await expect(picks.filter({hasText:'Rifter'})).toHaveCount(0,'picks over budget are hidden');await expect(industry).toContainText('1 more pick needs a bigger budget');
 await page.locator('#industry-over').check();await expect(picks.filter({hasText:'Rifter'})).toContainText('Decxus’s plan','a pick over your budget can still fit your wingmate');await expect(picks.first()).toContainText('Hobgoblin I');
 await page.locator('#industry-budget').fill('1');await page.locator('#industry-budget').blur();await page.locator('#industry-over').uncheck();
 await expect(industry.locator('.state')).toContainText('Nothing profitable fits');await industry.getByRole('button',{name:'Show picks over budget'}).click();await expect(page.locator('#industry-over')).toBeChecked();await expect(picks).toHaveCount(2);
 expect(errors).toEqual([]);
});
test('industry works for a visitor without a session, using base fees',async({page})=>{
 await mockApp(page);await openApp(page);await tab(page,'industry');await expect(page.locator('#industry')).toContainText('Connect Fiofka to plan with real skills');await expect(page.locator('#industry .rows__row').first()).toContainText('Hobgoblin I');
});
test('industry explains an empty pipeline',async({page})=>{
 await mockApp(page,{noMarket:true});await openApp(page);await tab(page,'industry');await expect(page.locator('#industry .state')).toContainText('No blueprint prices yet');
});
