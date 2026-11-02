import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const b = await chromium.launch(), page = await b.newPage({viewport:{width:1280, height:1000}});
const log = [];
page.on('pageerror', e => log.push(`PAGEERROR ${e.message}`));
page.on('console', m => { if (m.type() === 'error') log.push(`CONSOLE ${m.text()}`); });
try {
await page.addInitScript(() => localStorage.setItem('eve-me:v1', 'Fiofka'));
await page.goto('https://matheusfiorin.github.io/eve-journal/?v=' + Date.now() + '#exploration', {waitUntil:'networkidle'});
await page.waitForTimeout(10000);
log.push(`STATUS ${await page.locator('#explore-status').textContent()}`);
log.push(`ROWS ${await page.locator('#explore-content .opps .explore').count()}`);
log.push(`TOP ${(await page.locator('#explore-content .opps .explore').first().innerText()).replace(/\n/g, ' | ')}`);
log.push(`LOOP ${(await page.locator('#explore-content .loop').innerText()).replace(/\n/g, ' | ')}`);
log.push(`SCOUT ${(await page.locator('#explore-scout').innerText()).replace(/\n/g, ' | ').slice(0, 600)}`);
await page.screenshot({path:'dump/live-explore.png', fullPage:true});
} catch (e) { log.push(`ERROR ${e.message.slice(0, 800)}`); await page.screenshot({path:'dump/live-map.png'}).catch(() => {}); }
writeFileSync('dump/live.txt', log.join('\n'));
await b.close();
