// Writes the Android Plan tests' fixture (android/app/src/test/resources/plan-fixture.json) from the web's e2e fixture
// market, with every time pinned to NOW so the Kotlin tests' expected values never drift. Run after changing
// e2e/fixtures.js: node scripts/android-plan-fixture.mjs
import fs from 'node:fs';
const NOW = 1795000000000;
const real = Date.now;
Date.now = () => NOW;
const {MARKET} = await import('../e2e/fixtures.js');
Date.now = real;
const out = {now:NOW, universe:MARKET.universe, meta:MARKET.meta.data, regions:MARKET.regions};
fs.writeFileSync(new URL('../android/app/src/test/resources/plan-fixture.json', import.meta.url), JSON.stringify(out));
console.log('Wrote plan-fixture.json', JSON.stringify(out).length, 'bytes');
