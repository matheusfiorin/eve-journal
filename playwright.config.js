import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', timeout:30000, expect:{timeout:7000},
  fullyParallel:true, forbidOnly:!!process.env.CI, retries:process.env.CI?1:0, workers:2,
  reporter:[['list'],['html',{open:'never'}],['json',{outputFile:'test-results/results.json'}]],
  use:{...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),baseURL:'http://127.0.0.1:8000',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:{command:'python3 -m http.server 8000 --bind 127.0.0.1',url:'http://127.0.0.1:8000',reuseExistingServer:!process.env.CI}
});
