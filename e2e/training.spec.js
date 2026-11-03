import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('training shows the active skill, timeline, suggestions and the wingmate’s queue',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:true});await openApp(page);await tab(page,'training');const view=page.locator('#training');
 await expect(view.locator('.readout')).toContainText('Gunnery V');await expect(view.locator('.readout')).toContainText('Queue ends in');
 await expect(view.locator('.alert')).toContainText('queue ends in');await expect(view.locator('.active')).toContainText('Gunnery V');
 const rows=view.locator('.timeline .rows__row');await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('Gunnery');await expect(rows.first()).toHaveClass(/is-active/);await expect(view).toContainText('Paused / not scheduled');
 // Skills that unlock a way to earn, each tagged with the activity it opens.
 const next=view.locator('.suggest');await expect(next).toContainText('Mining Frigate I');await expect(next.locator('[data-act="industry"]').first()).toContainText('Build');await expect(next.locator('[data-act="exploration"]').first()).toContainText('Explore');
 await expect(view.locator('.wing-line')).toContainText('Decxus is training Gunnery V');
 await page.screenshot({path:testInfo.outputPath('training.png'),fullPage:true});
 // A queue row opens its details; j/k move between rows.
 await rows.first().click();await expect(page.locator('#drawer')).toBeVisible();await expect(page.locator('#drawer-title')).toHaveText('Gunnery V');await expect(page.locator('#drawer')).toContainText('Position');
 await page.keyboard.press('Escape');await expect(page.locator('#drawer')).toBeHidden();
 await page.keyboard.press('j');await page.keyboard.press('j');await expect(rows.nth(1)).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#drawer-title')).toHaveText('Spaceship Command III');await expect(page.locator('#drawer')).toContainText('Paused');await page.keyboard.press('Escape');
 // The wingmate's queue is one tap away; the picker remembers the choice across Pilot views.
 await view.getByRole('button',{name:'See Decxus’s queue'}).click();await expect(view.locator('[data-show-pilot="Decxus"]').first()).toHaveAttribute('aria-pressed','true');await expect(view.locator('.queue')).toHaveAttribute('data-pilot','decxus');await expect(view.locator('.wing-line')).toContainText('Fiofka is training Gunnery V');
 await tab(page,'skills');await expect(page.locator('#skills [data-show-pilot="Decxus"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#skills .sheet')).toHaveAttribute('data-pilot','decxus');
 await page.locator('#skills [data-show-pilot="Fiofka"]').click();await expect(page.locator('#skills .sheet')).toHaveAttribute('data-pilot','fiofka');
 expect(errors).toEqual([]);
});
test('an empty queue raises a not-training alert everywhere',async({page})=>{
 await mockApp(page,{connected:true,queueEmpty:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('Not training');await tab(page,'training');await expect(page.locator('#training-content')).toContainText('Your training queue is empty');await expect(page.locator('#training .alert.danger')).toContainText('Not training');
});
test('a queue that runs out within a day warns the pilot',async({page})=>{
 await mockApp(page,{connected:true,queueEnding:true});await openApp(page);await expect(page.locator('.me-banner').locator('.alert.warn')).toContainText('Queue runs out');
 await tab(page,'training');await expect(page.locator('#training .alert.warn')).toContainText('Queue runs out');
});
test('skill sheet groups skills, shows levels, sorts, filters and opens details',async({page},testInfo)=>{
 await mockApp(page,{connected:true});await openApp(page);await tab(page,'skills');const sheet=page.locator('#skills');
 await expect(sheet.locator('.readout')).toContainText('125,000');await expect(sheet.locator('.readout')).toContainText('5,000');
 await expect(sheet.locator('.skill-group')).toHaveCount(2);await expect(sheet.locator('.skill-group').first()).toContainText('Gunnery');await expect(sheet).toContainText('90,510 SP');await expect(sheet).toContainText('Active 3 of 4');
 await expect(sheet.locator('.skill[data-skill="3300"] .pips i.on')).toHaveCount(3);await expect(sheet.locator('.skill[data-skill="3300"]')).toContainText('to V');
 // / focuses the search, which opens matching groups.
 await page.keyboard.press('/');await expect(page.locator('#skill-search')).toBeFocused();await page.keyboard.type('Spaceship');
 await expect(sheet.locator('.skill-group:visible')).toHaveCount(1);await expect(sheet.locator('.skill:visible')).toHaveCount(1);
 await page.locator('#skill-search').fill('');
 await sheet.getByRole('button',{name:'At V'}).click();await expect(sheet.locator('#skills-none')).toBeVisible();
 await sheet.getByRole('button',{name:'In queue'}).click();await expect(sheet.locator('.skill:visible')).toHaveCount(2);
 await sheet.getByRole('button',{name:'All'}).click();
 if(testInfo.project.name!=='mobile'){const sp=sheet.locator('[data-sort="skills:sp"]');await sp.click();await expect(sp).toHaveAttribute('aria-sort','descending');await sp.click();await expect(sp).toHaveAttribute('aria-sort','ascending');}
 await sheet.locator('.skill-group').first().locator('summary').click();await sheet.locator('.skill[data-skill="3300"] .skill__name').click();
 await expect(page.locator('#drawer-title')).toHaveText('Gunnery');await expect(page.locator('#drawer')).toContainText('Level 4');await expect(page.locator('#drawer')).toContainText('alpha clone limit');await expect(page.locator('#drawer')).toContainText('Decxus');
 await page.keyboard.press('Escape');
 await page.screenshot({path:testInfo.outputPath('skills.png'),fullPage:true});
});
test('session expiry clears private data and keeps shared training',async({page})=>{
 await page.clock.install();await mockApp(page,{connected:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('125,000');await page.clock.fastForward(21*60*1000);await expect(page.locator('#notice')).toContainText('expired');await expect(page.locator('.me-banner')).toContainText('333,000');
});
