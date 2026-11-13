// Renders icons/icon.svg to the PNG app icons with Playwright's Chromium: node scripts/render-icons.mjs
// (CHROMIUM_PATH picks a preinstalled Chromium). Rerun after editing the SVG and commit the PNGs.
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const dir = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = await readFile(`${dir}icon.svg`, 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  const page = await browser.newPage({viewport:{width:size, height:size}, deviceScaleFactor:1});
  await page.setContent(`<style>html,body{margin:0;background:#0C1424}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({path:`${dir}${name}`});
  await page.close();
}
await browser.close();
