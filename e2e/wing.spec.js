import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
const ACTS=['mining','industry','hauling','trade','combat','exploration'];

test('the crew map shows tonight’s best activities and one node per activity',async({page},testInfo)=>{
 test.skip(isMobile(page),'the map is the desktop view; phones get the list');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'strengths');
 const tonight=page.locator('#tonight');await expect(tonight.locator('.tonight__act')).toHaveCount(3);
 await expect(tonight).toContainText('Group plan:');await expect(tonight.locator('.role-badge')).toHaveCount(2);
 for(const act of ACTS)await expect(page.locator(`#cm-svg .cm-node[data-act="${act}"]`)).toHaveCount(1);
 await expect(page.locator('#cm-svg .cm-leaf').first()).toBeVisible();
 await expect(page.locator('#strengths')).not.toContainText(/ leads| vs |ahead of|Dead even/);
 await page.screenshot({path:testInfo.outputPath('crew-map.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('the crew map is one tab stop and arrow keys move between branches and leaves',async({page})=>{
 test.skip(isMobile(page),'keyboard map navigation is desktop');
 await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'strengths');
 const nodes=page.locator('#cm-svg .cm-node');await expect(nodes).toHaveCount(6);
 await expect(page.locator('#cm-svg [tabindex="0"]')).toHaveCount(1);
 await nodes.first().focus();
 const focused=()=>page.evaluate(()=>{const el=document.activeElement;return `${el.classList[0]}:${el.dataset.act}`;});
 await page.keyboard.press('ArrowRight');expect(await focused()).toBe('cm-node:industry');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');expect(await focused()).toBe('cm-node:exploration');
 await page.keyboard.press('Home');expect(await focused()).toBe('cm-node:mining');
 await page.keyboard.press('ArrowDown');expect(await focused()).toBe('cm-leaf:mining');
 await page.keyboard.press('ArrowUp');expect(await focused()).toBe('cm-node:mining');
 await expect(page.locator('#cm-svg [tabindex="0"]')).toHaveCount(1);
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 const drawer=page.locator('#drawer');await expect(drawer).toBeVisible();await expect(page.locator('#drawer-title')).toContainText('Industry');
 await expect(drawer).toContainText('What each of you brings');await expect(drawer).toContainText('Make it stronger');await expect(drawer).toContainText('Decxus');
 await page.keyboard.press('Escape');await expect(drawer).toBeHidden();expect(await focused()).toBe('cm-node:industry');
});

test('clicking a branch opens why it is strong, and Plan this opens that activity',async({page},testInfo)=>{
 test.skip(isMobile(page),'phones use the list');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'strengths');
 await page.locator('#cm-svg .cm-node[data-act="mining"]').click();
 const drawer=page.locator('#drawer');await expect(drawer).toBeVisible();await expect(page.locator('#drawer-title')).toContainText('Mining');
 await expect(drawer.locator('.cap-parts meter').first()).toBeVisible();
 await expect(page.locator('#cm-svg .cm-node[data-act="mining"]')).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:testInfo.outputPath('crew-drawer.png')});
 await drawer.getByRole('button',{name:'Plan this',exact:true}).click();
 await expect(drawer).toBeHidden();await expect(page.locator('#mining')).toBeVisible();await expect(page).toHaveURL(/#earn\/mine/);
 await tab(page,'strengths');await page.locator('#cm-svg .cm-leaf[data-act="industry"]').first().click();
 await expect(page.locator('#drawer-title')).toContainText('Industry');await expect(drawer.locator('.cap-contrib .is-focus')).toHaveCount(1);
 await drawer.getByRole('button',{name:'Plan this',exact:true}).click();await expect(page.locator('#industry')).toBeVisible();
 await tab(page,'strengths');await page.locator('[data-plan-session]').click();await expect(page.locator('#strengths')).toBeHidden();
 expect(errors).toEqual([]);
});

test('phones get the crew map as a list, sorted by readiness',async({page},testInfo)=>{
 test.skip(!isMobile(page),'mobile fallback');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'strengths');
 await expect(page.locator('#cm-svg')).toBeHidden();
 const branches=page.locator('.cm-list .cm-branch');await expect(branches).toHaveCount(6);await expect(branches.first()).toHaveAttribute('open','');
 const scores=await branches.locator('summary .num').allTextContents();expect(scores.map(Number)).toEqual(scores.map(Number).sort((a,b)=>b-a));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('crew-list.png'),fullPage:true});
 const act=await branches.first().getAttribute('data-act');
 await branches.first().getByRole('button',{name:'Plan this'}).click();
 const view={mining:'mining',industry:'industry',hauling:'hauling',trade:'market',combat:'training',exploration:'exploration'}[act];
 await expect(page.locator(`#${view}`)).toBeVisible();expect(errors).toEqual([]);
});

test('the desktop list toggle shows the same activities as an accordion',async({page})=>{
 test.skip(isMobile(page),'the toggle is hidden on phones');
 await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'strengths');
 await page.getByRole('radio',{name:'List'}).click();await expect(page.locator('#cm-svg')).toBeHidden();await expect(page.locator('.cm-list .cm-branch')).toHaveCount(6);
 await page.getByRole('radio',{name:'Map'}).click();await expect(page.locator('#cm-svg')).toBeVisible();
});

test('goals frame the wing: totals, what we own and milestones for either pilot',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'goals');
 const summary=page.locator('#wing-summary');await expect(summary.locator('.wing-total')).toHaveText('80.0M ISK');
 await expect(page.locator('#goals')).toContainText('Our goals');await expect(page.locator('#goals')).not.toContainText(/ leads| vs |share of/i);
 await summary.locator('summary').click();const top=summary.locator('.holdings li');
 await expect(top.first()).toContainText('Heron');await expect(top.first()).toContainText('Fiofka');await expect(top.nth(1)).toContainText('Rifter');await expect(top.nth(1)).toContainText('Decxus');
 await expect(summary).toContainText('Rookie Warrior');await expect(summary).toContainText('Rookie Industrialist');
 const ms=page.locator('#milestones');await expect(ms).toContainText('Decxus reached 2.0M skill points.');await expect(ms).toContainText('The wing passed 75.0M ISK.');await expect(ms).toContainText('Decxus trained');
 await page.screenshot({path:testInfo.outputPath('goals.png'),fullPage:true});expect(errors).toEqual([]);
});
