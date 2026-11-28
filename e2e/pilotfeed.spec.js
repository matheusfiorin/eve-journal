import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile,data} from './fixtures.js';

// Every control a finger meets is at least 44 px on a phone.
const tall=async(locator)=>{const box=await locator.boundingBox();expect(box.height).toBeGreaterThanOrEqual(43.5);};
const HERON_FIT=`[Heron, Our first explorer]
Overdrive Injector System II

5MN Quad LiF Restrained Microwarpdrive
Medium Shield Extender I

Gas Cloud Scoop I
Gas Cloud Scoop I
Core Probe Launcher I, Nanite Repair Paste

Small Polycarbon Engine Housing II
Small Polycarbon Engine Housing II

Hobgoblin I x2`;

test('the Bridge shows the current fit by slot and copies it as EFT',async({page,context},testInfo)=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const {errors,privateEsi}=await mockApp(page,{connected:'first'});await openApp(page);
 const card=page.locator('#bridge .fit-card[data-pilot="fiofka"]');
 await expect(card.getByRole('heading',{name:'Current fit'})).toBeVisible();await expect(card).toContainText('Heron');
 const sum=card.locator('.fit-card__sum');await expect(sum).toContainText('3 high');await expect(sum).toContainText('2 mid');await expect(sum).toContainText('1 low');await expect(sum).toContainText('2 rigs');await expect(sum).toContainText('2 drones');
 await expect(card).toContainText('Gas Cloud Scoop I');await expect(card.locator('li',{hasText:'Gas Cloud Scoop I'})).toContainText('×2');
 await expect(card.locator('li',{hasText:'Core Probe Launcher I'})).toContainText('Nanite Repair Paste');
 await expect(card).toContainText('Hobgoblin I');
 const copy=card.getByRole('button',{name:'Copy as EFT'});if(isMobile(page))await tall(copy);
 await copy.click();await expect(page.locator('#toasts')).toContainText('Fit copied');
 // Windows' text clipboard uses CRLF; compare its complete native representation, including blank lines.
 const clipboardFit=process.platform==='win32'?HERON_FIT.replaceAll('\n','\r\n'):HERON_FIT;
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(clipboardFit);
 await page.screenshot({path:testInfo.outputPath('fit.png'),fullPage:true});
 expect(errors).toEqual([]);expect(privateEsi).toEqual([]);
});
test('when the browser refuses to copy, the fit opens in a box to copy by hand',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true});});
 await mockApp(page,{connected:'first'});await openApp(page);
 await page.locator('#bridge .fit-card[data-pilot="fiofka"]').getByRole('button',{name:'Copy as EFT'}).click();
 await expect(page.getByRole('dialog')).toContainText('Copy this fit');await expect(page.getByLabel('Fit as EFT text')).toHaveValue(HERON_FIT);
});
test('a fit read for another ship is not shown, and a pilot without permission is told to reconnect',async({page})=>{
 await mockApp(page,{connected:'first',staleFit:true});await openApp(page);
 const card=page.locator('#bridge .fit-card[data-pilot="fiofka"]');await expect(card).toContainText('You changed ships');await expect(card.getByRole('button',{name:'Copy as EFT'})).toHaveCount(0);
 const other=await page.context().newPage();await mockApp(other,{connected:'first',trainingOnly:true});await openApp(other);
 const mine=other.locator('#bridge .fit-card[data-pilot="fiofka"]');await expect(mine).toContainText('Permission not granted for your current fit');await expect(mine.getByRole('button',{name:'Reconnect'})).toBeVisible();
});
test('the wingmate’s fit shows under consent level 2 and not under level 1',async({page})=>{
 await mockApp(page,{connected:'first'});await openApp(page);
 const card=page.locator('#bridge .fit-card[data-pilot="decxus"]');await expect(card.getByRole('heading',{name:'Decxus’s current fit'})).toBeVisible();await expect(card).toContainText('Overdrive Injector System II');await expect(card).toContainText('Hobgoblin I');
 const older=await page.context().newPage();await mockApp(older,{connected:'first',wingLevel:1});await openApp(older);
 await expect(older.locator('#bridge .fit-card[data-pilot="fiofka"]')).toBeVisible();await expect(older.locator('#bridge .fit-card[data-pilot="decxus"]')).toHaveCount(0);
});

test('Trade lists my orders with outbid, best price and not-checked, and the last 30 days',async({page},testInfo)=>{
 const {errors,privateEsi}=await mockApp(page,{connected:'first'});await openApp(page);
 await tab(page,'market');const orders=page.locator('#market-content .orders');
 await expect(orders.getByRole('heading',{name:'My orders'})).toBeVisible();await expect(orders.locator('[aria-label="Open orders"] .orow')).toHaveCount(5);
 const order=n=>orders.locator(`[data-order="${n}"]`);
 await expect(order(1)).toContainText('Tritanium');await expect(order(1)).toContainText('Sell');await expect(order(1)).toContainText('6.00 ISK');await expect(order(1)).toContainText('400 of 1,000 left');await expect(order(1)).toContainText('Jita IV');await expect(order(1)).toContainText(/\d+ days left/);
 await expect(order(1)).toContainText('Outbid by 1.00 ISK');
 await expect(order(2)).toContainText('Best price');await expect(order(3)).toContainText('Buy');await expect(order(3)).toContainText('Best price');
 await expect(order(4)).toContainText('Outbid by 1.00 ISK');await expect(order(5)).toContainText('Not checked');
 // The words carry the state, not only the colour.
 await expect(orders.locator('.chip--danger')).toHaveCount(2);await expect(orders.locator('.chip--ok')).toHaveCount(2);
 const history=orders.locator('.orders__history');await expect(history.locator('summary')).toContainText('1 filled, 1 expired');await expect(history.locator('summary')).toContainText('ISK sold');
 await history.locator('summary').click();await expect(history.locator('.orow')).toHaveCount(2);await expect(history).toContainText('Filled');await expect(history).toContainText('Expired');
 await page.screenshot({path:testInfo.outputPath('orders.png'),fullPage:true});
 expect(errors).toEqual([]);expect(privateEsi).toEqual([]);
});
test('Trade says so when there are no orders, and asks to reconnect when the permission is missing',async({page})=>{
 await mockApp(page,{connected:'first',noOrders:true});await openApp(page);
 await tab(page,'market');await expect(page.locator('#market-content .orders')).toContainText('No open market orders');
 const old=await page.context().newPage();await mockApp(old,{connected:'first',oldScopes:true});await openApp(old);
 await tab(old,'market');await expect(old.locator('#market-content .orders')).toContainText('Permission not granted for market orders');await expect(old.locator('#market-content .orders').getByRole('button',{name:'Reconnect'})).toBeVisible();
});
test('the Ledger summarises orders and links to them',async({page})=>{
 await mockApp(page,{connected:'first'});await openApp(page);
 await tab(page,'wallet');const line=page.locator('#ledger-content .orders-line');
 await expect(line).toContainText('5 open orders (3 sell, 2 buy)');await expect(line).toContainText('2 outbid');await expect(line).toContainText('last 30 days: 1 filled, 1 expired');
 if(isMobile(page))await tall(line);
 await line.click();await expect(page.locator('#market')).toBeVisible();await expect(page.locator('#market-content .orders')).toBeVisible();
});

test('contracts: open, in progress and finished, courier terms up front, and contracts about to run out flagged',async({page},testInfo)=>{
 const {errors,privateEsi}=await mockApp(page,{connected:'first'});await openApp(page);
 await tab(page,'wallet');const contracts=page.locator('#ledger-content .contracts');
 await expect(contracts.getByRole('heading',{name:'Contracts'})).toBeVisible();
 for(const heading of ['Outstanding','In progress','Recently finished or expired'])await expect(contracts.getByRole('heading',{name:heading})).toBeVisible();
 const courier=contracts.locator('[data-contract="7001"]');
 await expect(courier).toContainText('Courier');await expect(courier).toContainText('Reward 2.0M ISK');await expect(courier).toContainText('Collateral 50.0M ISK');await expect(courier).toContainText('5,000 m³');
 await expect(courier.locator('[data-expiring]')).toContainText(/Expires in (9h|10h)/);
 await expect(contracts.locator('[data-expiring]')).toHaveCount(1,{timeout:7000});
 await expect(contracts.locator('[data-contract="7002"]')).toContainText('Asks 25.0M ISK');await expect(contracts.locator('[data-contract="7003"]')).toContainText('In progress');await expect(contracts.locator('[data-contract="7004"]')).toContainText('Completed');
 if(isMobile(page))await tall(courier);
 await page.screenshot({path:testInfo.outputPath('contracts.png'),fullPage:true});
 expect(errors).toEqual([]);expect(privateEsi).toEqual([]);
});
test('contract items are read only when asked for, one contract at a time',async({page})=>{
 const {state}=await mockApp(page,{connected:'first'});await openApp(page);
 await tab(page,'wallet');expect(state.contractItemCalls).toBeUndefined();
 await page.locator('#ledger [data-contract="7001"]').click();const drawer=page.getByRole('dialog');
 await expect(drawer).toContainText('Courier contract');await expect(drawer).toContainText('Anyone');await expect(drawer).toContainText('Courier contracts carry cargo');await expect(drawer.getByRole('button',{name:'Show items'})).toHaveCount(0);
 await expect(drawer).toContainText('runs out in');
 await page.keyboard.press('Escape');
 await page.locator('#ledger [data-contract="7002"]').click();expect(state.contractItemCalls).toBeUndefined();
 await expect(drawer).toContainText('Decxus');await expect(drawer).toContainText('25,000,000.00 ISK');
 const show=drawer.getByRole('button',{name:'Show items'});if(isMobile(page))await tall(show);
 await show.click();await expect(drawer.locator('#contract-items')).toContainText('Tritanium');await expect(drawer.locator('#contract-items')).toContainText('×1,000');await expect(drawer.locator('#contract-items')).toContainText('Wanted in return');await expect(drawer.locator('#contract-items')).toContainText('Pyerite');
 expect(state.contractItemCalls).toEqual([7002]);
});
test('a contract whose items cannot be read says so, and a pilot without the permission is asked to reconnect',async({page})=>{
 await mockApp(page,{connected:'first',contractItemsFail:true});await openApp(page);
 await tab(page,'wallet');await page.locator('#ledger [data-contract="7002"]').click();await page.getByRole('button',{name:'Show items'}).click();
 await expect(page.locator('#contract-items')).toContainText('temporarily unavailable');
 const old=await page.context().newPage();await mockApp(old,{connected:'first',oldScopes:true});await openApp(old);
 await tab(old,'wallet');await expect(old.locator('#ledger-content .contracts')).toContainText('Permission not granted for contracts');await expect(old.locator('#ledger-content .contracts [data-contract]')).toHaveCount(0);
});

test('Logbook lists losses as a filterable kind and starts a journal entry from one',async({page},testInfo)=>{
 const {errors,privateEsi}=await mockApp(page,{connected:'first',losses:true,data});await openApp(page);
 const date=new Date(Date.now()-30*3600000).toISOString().slice(0,10);
 await tab(page,'journal');const list=page.locator('#entries');
 await expect(list.locator('.entry--loss')).toHaveCount(2);await expect(list.locator('.entry')).toHaveCount(4);
 const loss=list.locator('[data-loss="555"]');
 await expect(loss.getByRole('heading',{name:'Lost a Rifter in Tama'})).toBeVisible();await expect(loss).toContainText('3 attackers');await expect(loss).toContainText('Test Flight Academy');await expect(loss).toContainText('Fiofka');
 await expect(loss.getByRole('link',{name:/View on zKillboard/})).toHaveAttribute('href','https://zkillboard.com/kill/555/');
 await expect(page.locator('#entry-count')).toContainText('2 entries and 2 losses');
 await page.locator('#journal-kind').selectOption('losses');await expect(list.locator('.entry')).toHaveCount(2);await expect(page.locator('#entry-count')).toContainText('2 of 2 losses match');
 await page.locator('#journal-kind').selectOption('entries');await expect(list.locator('.entry--loss')).toHaveCount(0);await expect(list.locator('.entry')).toHaveCount(2);
 await page.locator('#journal-kind').selectOption('');await page.locator('#journal-search').fill('heron');await expect(list.locator('.entry--loss')).toHaveCount(1);await expect(list.locator('[data-loss="554"]')).toBeVisible();await page.locator('#journal-search').fill('');
 await page.getByRole('combobox',{name:'Focus',exact:true}).selectOption('Milestone');await expect(list.locator('.entry--loss')).toHaveCount(0);await page.getByRole('combobox',{name:'Focus',exact:true}).selectOption('');
 const add=loss.getByRole('button',{name:/Add the loss of Rifter to the journal/});if(isMobile(page))await tall(add);
 await page.screenshot({path:testInfo.outputPath('losses.png'),fullPage:true});
 await add.click();
 const form=page.locator('#journal-form');await expect(form).toBeVisible();
 await expect(form.getByLabel('Entry title')).toHaveValue('Lost a Rifter in Tama');await expect(form.getByRole('combobox',{name:'Focus',exact:true})).toHaveValue('Lesson learned');await expect(form.getByRole('combobox',{name:'Pilot',exact:true})).toHaveValue('Fiofka');await expect(form.getByLabel('Date',{exact:true})).toHaveValue(date);
 await expect(form.getByLabel('Private notes')).toHaveValue(/zkillboard\.com\/kill\/555\/[\s\S]*what would I do differently/i);
 await form.getByRole('button',{name:'Save entry locally'}).click();
 await expect(list.locator('.entry:not(.entry--loss)',{hasText:'Lost a Rifter in Tama'})).toContainText('Lesson learned');
 expect(errors).toEqual([]);expect(privateEsi).toEqual([]);
});
test('Logbook without losses is unchanged, and says what to do when the loss filter is empty',async({page})=>{
 await mockApp(page,{connected:'first',data});await openApp(page);
 await tab(page,'journal');await expect(page.locator('#entries .entry--loss')).toHaveCount(0);await expect(page.locator('#entry-count')).toContainText('2 entries');await expect(page.locator('#entry-count')).not.toContainText('loss');
 await page.locator('#journal-kind').selectOption('losses');await expect(page.locator('#entries')).toContainText('No losses recorded');
});
