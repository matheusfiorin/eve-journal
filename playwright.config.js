import {defineConfig,devices} from '@playwright/test';
// E2E_PORT picks the local server port; CHROMIUM_PATH points at a preinstalled Chromium when Playwright's own build is missing.
const port=Number(process.env.E2E_PORT)||8000, base=`http://127.0.0.1:${port}`;
const launchOptions=process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{};
export default defineConfig({
  testDir:'./e2e', timeout:30000, expect:{timeout:7000},
  fullyParallel:true, forbidOnly:!!process.env.CI, retries:process.env.CI?1:0, workers:2,
  reporter:[['list'],['html',{open:'never'}],['json',{outputFile:'test-results/results.json'}]],
  use:{...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),baseURL:base,trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:{command:'node scripts/static-server.mjs',env:{PORT:String(port)},url:base,reuseExistingServer:!process.env.CI}
});
