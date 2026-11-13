import {test,expect} from '@playwright/test';
import {mockApp,openApp,isMobile,API,IDS,opaque,reconnected} from './fixtures.js';
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
test('moving to another view puts focus on its title and announces it; the view tabs keep focus',async({page})=>{
 test.skip(isMobile(page),'the rail is a desktop control');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 await page.locator('.rail [data-dest="earn"]').click();await expect(page.locator('#viewbar .screen-title')).toBeFocused();
 await expect(page.locator('#announcer')).toHaveText('Build · Earn');
 await page.locator('#viewbar').getByRole('tab',{name:'Mine'}).focus();await page.keyboard.press('ArrowRight');
 await expect(page.locator('#exploration')).toBeVisible();await expect(page.locator('#viewbar').getByRole('tab',{name:'Explore'})).toBeFocused();
 await page.locator('#viewbar').getByRole('tab',{name:'Trade'}).click();await expect(page.locator('#viewbar').getByRole('tab',{name:'Trade'})).toBeFocused();
 await expect(page.locator('#announcer')).toHaveText('Trade · Earn');
 await page.locator('.rail [data-dest="bridge"]').click();await expect(page.locator('#bridge .screen-title')).toBeFocused();
 expect(errors).toEqual([]);
});
test('the pilot picker keeps focus inside itself until a pilot is chosen',async({page})=>{
 await mockApp(page);await openApp(page);
 await page.locator('#switch-pilot').click();const hero=page.locator('#hero');await expect(hero).toBeVisible();
 for(const sel of ['#rail','.shell__main','#tabbar'])expect(await page.locator(sel).evaluate(el=>el.inert)).toBe(true);
 for(let i=0;i<4;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement.closest('#hero')!==null||document.activeElement===document.body)).toBe(true);}
 await hero.getByRole('button',{name:/Decxus/}).click();await expect(hero).toBeHidden();
 expect(await page.locator('.shell__main').evaluate(el=>el.inert)).toBe(false);await expect(page.locator('#bridge .screen-title')).toBeFocused();
});
test('picking a pilot in one tab switches the other tabs to them',async({page,context})=>{
 await mockApp(page);await openApp(page);
 const other=await context.newPage();const {errors}=await mockApp(other);await openApp(other);
 await expect(other.locator('#switch-pilot')).toHaveAttribute('data-pilot','fiofka');
 await page.locator('#switch-pilot').click();await page.locator('#hero').getByRole('button',{name:/Decxus/}).click();
 await expect(other.locator('#switch-pilot')).toHaveAttribute('data-pilot','decxus');await expect(other.locator('body')).toHaveAttribute('data-pilot','decxus');
 await expect(other.locator('#switch-pilot')).toHaveAttribute('aria-label','Switch pilot (Decxus flying)');
 // A picker open in the other tab closes: the choice was made elsewhere.
 await other.locator('#switch-pilot').click();await expect(other.locator('#hero')).toBeVisible();
 await page.locator('#switch-pilot').click();await page.locator('#hero').getByRole('button',{name:/Fiofka/}).click();
 await expect(other.locator('#hero')).toBeHidden();await expect(other.locator('#switch-pilot')).toHaveAttribute('data-pilot','fiofka');
 expect(await other.locator('.shell__main').evaluate(el=>el.inert)).toBe(false);
 expect(errors).toEqual([]);
});
test('Reconnect is accepted when EVE answers in another tab, and the replaced session is ended',async({page,context})=>{
 await mockApp(page,{connected:'first'});await openApp(page);
 await page.locator('.me-banner [data-connect]').click();await expect(page).toHaveURL(`${API}/auth/start?pilot=${IDS[0]}`);
 // On a phone the EVE login often comes back in a fresh tab.
 const other=await context.newPage();const {errors,calls}=await mockApp(other,{connected:'first'});
 await other.goto(`/#backend_session=${reconnected.slice(0,42)}0&pilot=${IDS[0]}&expires=${Date.now()+3600000}`);await expect(other.locator('#sync-status')).toContainText('Synced');
 await expect(other.locator('#notice')).toContainText('Pilot connected');await expect(other.locator('#notice')).not.toContainText('already connected');
 expect(await other.evaluate(key=>JSON.parse(localStorage.getItem(key))[0][1].token,`eve-backend-sessions:${API}`)).toBe(`${reconnected.slice(0,42)}0`);
 await expect.poll(()=>calls.filter(c=>c.path==='/api/session/revoke').map(c=>c.authorization)).toEqual([`Bearer ${opaque.slice(0,42)}0`]);
 await expect(other.locator('#bridge')).toContainText('12,500,000.25 ISK');
 expect(errors).toEqual([]);
});
test('the command palette opens with Control+K and jumps to screens and systems',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);
 await page.keyboard.press('Control+K');const palette=page.locator('#palette');await expect(palette).toBeVisible();await expect(page.locator('#palette-input')).toBeFocused();
 await page.keyboard.type('mine');await expect(palette.locator('[aria-selected="true"]')).toContainText('Mine');
 await page.keyboard.press('Enter');await expect(palette).toBeHidden();await expect(page.locator('#mining')).toBeVisible();expect(hash(page)).toBe('#earn/mine');
 // Systems come from the universe graph once the market snapshot has loaded.
 await expect(page.locator('#mining .rows__row').first()).toBeVisible();
 await page.keyboard.press('Control+K');await page.keyboard.type('niarja');await expect(palette.locator('[aria-selected="true"]')).toContainText('System');
 // Enter shows a system on the Star map; Shift+Enter opens it in the 3D modal.
 await page.keyboard.press('Enter');await expect(page.locator('#map')).toBeVisible();await expect(page.locator('#map-panel h3')).toHaveText('Niarja');
 await expect(page.locator('#map-region')).toHaveValue('10000043');await expect.poll(()=>hash(page)).toContain('s=30003504');
 await page.keyboard.press('Control+K');await page.keyboard.type('niarja');await expect(palette.locator('[aria-selected="true"]')).toContainText('System');
 await page.keyboard.press('Shift+Enter');await expect(page.locator('#map-modal')).toBeVisible();await expect(page.locator('#map-modal-title')).toHaveText('Niarja');
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
test('iOS Safari shows the Home Screen tip until dismissed, in the page flow, without taking focus',async({page})=>{
 test.skip(!isMobile(page),'the tip is for iPhone Safari');
 const hint=page.locator('#install-hint'),synced=()=>expect(page.locator('#sync-status')).toContainText('Synced');
 // The suite's iPhone runs in Chromium, which has no navigator.standalone, so the other tests never see the tip.
 const {errors}=await mockApp(page);await openApp(page);await expect(page.locator('#bridge .screen-title')).toBeVisible();await expect(hint).toBeHidden();
 // Safari in a tab: navigator.standalone is false.
 await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'standalone',{get:()=>false,configurable:true}));
 await page.reload();await synced();
 await expect(hint).toBeVisible();await expect(hint).toContainText('Add Echelon to your Home Screen so Safari doesn’t clear your session and journal after a week away.');
 expect(await page.evaluate(()=>document.activeElement.closest('#install-hint'))).toBeNull();
 expect(await hint.evaluate(el=>getComputedStyle(el).position)).toBe('static');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('#tabbar').getByRole('button',{name:'Earn'}).click();await expect(page.locator('#industry')).toBeVisible();await expect(hint).toBeVisible();
 await page.getByRole('button',{name:'Dismiss home screen tip'}).click();await expect(hint).toBeHidden();await expect(page.locator('#viewbar .screen-title')).toBeFocused();
 await page.reload();await synced();await expect(hint).toBeHidden();
 expect(errors).toEqual([]);
});
