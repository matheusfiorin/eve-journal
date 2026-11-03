import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';

test('next up ranks what to do now, and each action opens the right view',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 const steps=page.locator('#bridge .course__step');await expect(steps.filter({hasText:'Mine '})).toHaveCount(1);
 expect(await steps.count()).toBeGreaterThanOrEqual(3);expect(await steps.count()).toBeLessThanOrEqual(5);
 // Fiofka's Heron job ends within a day, so it comes first and links to Earn → Jobs.
 await expect(steps.first()).toContainText('Deliver 1 finished job','the copy job in the fixtures is past its end');await expect(steps.first().locator('button')).toHaveAttribute('data-go','earn/jobs');
 await expect(steps.filter({hasText:'Start a Hobgoblin I run'})).toContainText('ISK/day');
 await page.screenshot({path:testInfo.outputPath('bridge.png'),fullPage:true});
 for(const [text,button,view] of [['Mine ','Show the belts','mining'],['Start a Hobgoblin','Plan the build','industry'],['Scan from','Plan the loop','exploration']]){
  await steps.filter({hasText:text}).getByRole('button',{name:button}).click();await expect(page.locator(`#${view}`)).toBeVisible();
  // G then B goes home (on phones the Earn view's rows currently sit over the tab bar; reported to the shell owner).
  await page.keyboard.press('g');await page.keyboard.press('b');await expect(steps.filter({hasText:'Mine '})).toHaveCount(1);
 }
 await expect(page.locator('#bridge')).not.toContainText(/ leads| vs |Dead even|ahead of/);
 expect(errors).toEqual([]);
});

test('together names a plan for both pilots and opens my part of it',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 const together=page.locator('#bridge .together');await expect(together.locator('.role-badge')).toHaveCount(2);
 await expect(together).toContainText('Decxus');await expect(together).toContainText('Fiofka');
 await together.getByRole('button',{name:'Plan this session'}).click();await expect(page.locator('#bridge')).toBeHidden();
 await tab(page,'overview');await page.locator('#bridge .wing-card').getByRole('button',{name:'Open the crew map'}).click();await expect(page.locator('#strengths')).toBeVisible();
 expect(errors).toEqual([]);
});

test('an empty queue is the first thing on the bridge',async({page})=>{
 await mockApp(page,{connected:true,queueEmpty:true,noJobs:true});await openApp(page);
 const first=page.locator('#bridge .course__step').first();await expect(first).toHaveAttribute('data-kind','alert');await expect(first).toContainText('Add a skill to your queue');
 await first.getByRole('button',{name:'Open training'}).click();await expect(page.locator('#training')).toBeVisible();
});
