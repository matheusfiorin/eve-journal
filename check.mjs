import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const b = await chromium.launch(), page = await b.newPage({viewport:{width:1280, height:1000}});
const log = [];
page.on('pageerror', e => log.push(`PAGEERROR ${e.message}`));
page.on('console', m => { if (m.type() === 'error') log.push(`CONSOLE ${m.text()}`); });
try {
await page.addInitScript(() => localStorage.setItem('eve-me:v1', 'Fiofka'));
await page.goto('https://matheusfiorin.github.io/eve-journal/#map', {waitUntil:'networkidle'});
await page.waitForTimeout(8000);
log.push(`STATUS ${await page.locator('#map-status').textContent()}`);
log.push(`SYSTEMS ${await page.locator('svg.region-map .sys').count()} REGION ${await page.locator('#map-region').inputValue()}`);
log.push(`PANEL ${(await page.locator('#map-panel').innerText()).slice(0, 300).replace(/\n/g, ' | ')}`);
await page.screenshot({path:'dump/live-map.png'});
await page.locator('#map-view').selectOption('universe'); await page.waitForTimeout(3000);
log.push(`FRAMES ${await page.locator('canvas.star-map').getAttribute('data-frames')}`);
await page.screenshot({path:'dump/live-3d.png'});
await page.locator('#map-search').fill('Uedama'); await page.locator('#map-find button').click(); await page.locator('#map-view').selectOption('region'); await page.waitForTimeout(2000);
log.push(`UEDAMA ${await page.locator('#map-panel h3').textContent()} ${await page.locator('svg.region-map .sys').count()}`);
await page.locator('#map-overlay').selectOption('shipKills'); await page.waitForTimeout(1000);
await page.screenshot({path:'dump/live-kills.png'});
} catch (e) { log.push(`ERROR ${e.message.slice(0, 800)}`); await page.screenshot({path:'dump/live-map.png'}).catch(() => {}); }
writeFileSync('dump/live.txt', log.join('\n'));
await b.close();
