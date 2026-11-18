import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {posix} from 'node:path';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const uiFiles=async()=>{const out=[];for(const dir of ['ui','ui/screens'])for(const f of await readdir(new URL(`../${dir}`,import.meta.url)))if(f.endsWith('.js'))out.push(`${dir}/${f}`);return out;};
// Each screen module's static markup (its `export const markup = {...};` block) is part of the document.
const markupOf=source=>source.match(/export const markup[\s\S]*?};$/m)?.[0]||'';
test('every explicit app control exists exactly once in the document',async()=>{
  const files=['app.js',...await uiFiles()];
  const [html,...sources]=await Promise.all(['index.html',...files].map(read));
  const ids=[html,...sources.map(markupOf)].flatMap(s=>[...s.matchAll(/\bid="([\w-]+)"/g)].map(m=>m[1]));
  assert.equal(new Set(ids).size,ids.length,'duplicate HTML IDs');
  for(const [i,source] of sources.entries())for(const m of source.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),`missing control in ${files[i]}: ${m[1]}`);
});
test('Pages artifact includes every browser module and stylesheet and excludes journal data',async()=>{
  const [workflow,html]=await Promise.all(['.github/workflows/pages.yml','index.html'].map(read));
  const copyLine=workflow.split('\n').find(l=>l.includes('cp index.html'));
  assert.match(copyLine,/cp -r ui styles icons _site\//,'ui/, styles/ and icons/ are copied whole');
  // Walk the whole import graph from the page's entry scripts: root modules' imports too, static and dynamic.
  const seen=new Set(),queue=[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m=>posix.normalize(m[1]));
  assert.ok(queue.includes('app.js'));
  while(queue.length){
    const path=queue.shift();if(seen.has(path))continue;seen.add(path);
    assert.ok(path.startsWith('ui/')||copyLine.includes(` ${path}`),`module omitted from Pages: ${path}`);
    const source=await read(path);
    for(const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g))queue.push(posix.normalize(posix.join(posix.dirname(path),m[1])));
  }
  for(const f of ['storage.js','backend.js','model.js','route.js'])assert.ok(seen.has(f),`the walk reaches ${f}`);
  for(const m of html.matchAll(/href="(styles\/[\w.-]+)"/g))await read(m[1]);
  assert.ok(!copyLine.includes('*.json'),'only explicit public configuration is packaged');
  assert.ok(copyLine.includes('config.json'));
});
test('index.html preloads exactly the modules app.js imports statically, and Earn and Navigate stay lazy',async()=>{
  const html=await read('index.html');
  const preloaded=new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m=>m[1]));
  const seen=new Set(),queue=['app.js'];
  while(queue.length){
    const path=queue.shift();if(seen.has(path))continue;seen.add(path);
    for(const m of (await read(path)).matchAll(/^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm))queue.push(posix.normalize(posix.join(posix.dirname(path),m[1]||m[2])));
  }
  seen.delete('app.js');
  assert.deepEqual([...preloaded].sort(),[...seen].sort(),'modulepreload links match the static import graph of app.js');
  for(const lazy of ['ui/screens/earn.js','ui/screens/navigate.js','ui/screens/starmap.js','mapview.js','ui/gestures.js','hauling.js'])assert.ok(!seen.has(lazy),`${lazy} is not part of the boot graph`);
  assert.match(await read('app.js'),/import\('\.\/ui\/screens\/earn\.js'\)/);
  assert.match(await read('app.js'),/import\('\.\/ui\/screens\/navigate\.js'\)/);
});
test('the web app manifest and its icons are linked and packaged',async()=>{
  const [workflow,html]=await Promise.all(['.github/workflows/pages.yml','index.html'].map(read));
  const copyLine=workflow.split('\n').find(l=>l.includes('cp index.html'));
  const href=rel=>html.match(new RegExp(`<link rel="${rel}" href="([^"]+)">`))?.[1];
  assert.equal(href('manifest'),'manifest.webmanifest');
  assert.ok(copyLine.includes(' manifest.webmanifest '),'the manifest is packaged');
  const manifest=JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name,'Echelon');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
  const tokens=await read('styles/tokens.css');
  assert.ok(tokens.includes(`--bg:${manifest.background_color};`),'background colour is the --bg token');
  assert.match(html,new RegExp(`<meta name="theme-color" content="${manifest.theme_color}">`));
  const icons=[...manifest.icons.map(i=>i.src),href('apple-touch-icon')];
  for(const size of ['192x192','512x512'])assert.ok(manifest.icons.some(i=>i.sizes===size&&i.type==='image/png'),`a ${size} PNG icon`);
  for(const src of icons){assert.ok(src.startsWith('icons/'),`${src} lives in icons/`);await readFile(new URL(`../${src}`,import.meta.url));}
});
test('the Content-Security-Policy allows every host the app fetches and runs no inline script',async()=>{
  const files=['app.js','backend.js',...await uiFiles()];
  const [html,...sources]=await Promise.all(['index.html',...files].map(read));
  const csp=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(csp,'index.html declares a CSP');
  const directive=name=>csp.split(';').map(d=>d.trim().split(/\s+/)).find(([n])=>n===name)?.slice(1)||[];
  assert.deepEqual(directive('script-src'),["'self'"]);
  assert.deepEqual(directive('worker-src'),[],"module Workers (the Haul planner) fall back to script-src 'self'");
  const hosts=new Set(sources.flatMap(s=>[...s.matchAll(/json\([`'](https:\/\/[^/`'$]+)/g)].map(m=>m[1])));
  assert.ok(hosts.size>=3,'found the fetched hosts');
  for(const host of hosts)assert.ok(directive('connect-src').includes(host),`connect-src misses ${host}`);
  assert.ok(directive('connect-src').includes('https://*.workers.dev'),'the deployed Worker backend');
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/,'no inline scripts');
  for(const s of [html,...sources])assert.doesNotMatch(s,/\son[a-z]+="/,'no inline event handlers');
});

test('every workflow action is pinned to a commit SHA, and the secret-holding jobs run only from main',async()=>{
  const dir=new URL('../.github/workflows/',import.meta.url);
  for(const f of await readdir(dir)){
    const text=await readFile(new URL(f,dir),'utf8');
    for(const m of text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)){
      assert.match(m[1],/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,`${f}: ${m[1]} is pinned to a full commit SHA`);
      assert.match(m[2],/#\s*v\d+(\.\d+)*/,`${f}: ${m[1]} names its version in a comment`);
    }
  }
  const [check,market,pages]=await Promise.all(['cloudflare-check','market','pages'].map(n=>read(`.github/workflows/${n}.yml`)));
  assert.match(check,/if: github\.ref == 'refs\/heads\/main'\n\s+environment: github-pages/,'the Cloudflare check uses the secrets environment only on main');
  assert.match(market,/if: github\.ref == 'refs\/heads\/main'\n\s+environment: github-pages/);
  assert.equal((pages.match(/environment: github-pages|name: github-pages/g)||[]).length,2);
  assert.equal((pages.match(/github\.ref == 'refs\/heads\/main'/g)||[]).length,2,'both deploy jobs');
  assert.match(market,/PIPELINE_SECRET: \$\{\{ secrets\.PIPELINE_SECRET \}\}/);assert.match(pages,/PIPELINE_SECRET: \$\{\{ secrets\.PIPELINE_SECRET \}\}/);
});
test('the health workflow runs hourly, writes one "health" issue with an issues-only token, and holds no secrets',async()=>{
  const text=await read('.github/workflows/health.yml');
  assert.match(text,/schedule:\s+- cron: '\d+ \* \* \* \*'/);assert.match(text,/workflow_dispatch:/);
  assert.match(text,/permissions:\n  contents: read\n  issues: write/);assert.doesNotMatch(text,/secrets\./);
  assert.match(text,/actions\/github-script@[0-9a-f]{40}/);assert.match(text,/labels: \['health'\]/);assert.match(text,/state: 'closed'/);
});
test('check-health reads the Worker address from the published config and reports ages only',async()=>{
  const {checkHealth}=await import('../scripts/check-health.mjs');
  const answer=(status,body)=>async url=>String(url).endsWith('config.json')?new Response(JSON.stringify({backendUrl:'https://w.example'})):(assert.equal(String(url),'https://w.example/health/freshness'),new Response(JSON.stringify(body),{status}));
  const fresh={ok:true,problems:[],market:{metaAge:600,universeAge:99999,hubs:{count:5,oldestAge:900}},activityAge:1200,pilots:[{pilot:1,syncAge:300,error:false}]};
  assert.equal((await checkHealth('https://site.example/',answer(200,fresh))).healthy,true);
  const stale=await checkHealth('https://site.example/',answer(503,{...fresh,ok:false,problems:['activity','pilot 1'],activityAge:9000,pilots:[{pilot:1,syncAge:7200,error:true}]}));
  assert.equal(stale.healthy,false);assert.match(stale.report,/Stale: activity, pilot 1/);assert.match(stale.report,/Pilot 1: last sync 2\.0 h, error flagged/);
  assert.equal((await checkHealth('https://site.example/',answer(500,{error:'x'}))).healthy,false);
  assert.match((await checkHealth('https://site.example/',answer(404,{error:'Not found.'}))).report,/no \/health\/freshness/);
  assert.equal((await checkHealth('https://site.example/',async()=>{throw new Error('offline');})).healthy,false);
  assert.equal((await checkHealth('https://site.example/',async()=>new Response(JSON.stringify({backendUrl:''})))).healthy,false);
});
test('the deploy script turns on logs, the rate limits, both cron triggers and the pipeline secret, and says 5 minutes',async()=>{
  const [deploy,worker]=await Promise.all([read('scripts/deploy-backend.mjs'),read('worker/index.js')]);
  assert.match(deploy,/observability:\{enabled:true,head_sampling_rate:1,/);
  for(const n of ['RATE_AUTH','RATE_MARKET','RATE_JOURNAL'])assert.match(deploy,new RegExp(`name:'${n}',namespace_id:'\\d+',simple:\\{limit:\\d+,period:60\\}`));
  assert.match(deploy,/crons:\['\*\/5 \* \* \* \*',DAILY_CRON\]/);
  assert.equal(deploy.match(/const DAILY_CRON='([^']+)'/)[1],worker.match(/export const DAILY_CRON='([^']+)'/)[1],'the deploy script and the Worker name the same daily cron');
  assert.match(deploy,/name:'PIPELINE_SECRET'/);assert.doesNotMatch(deploy,/every 30 minutes/);assert.match(deploy,/every 5 minutes/);
  assert.match(deploy,/env:wranglerEnv/,'wrangler gets an environment without the EVE and pipeline secrets');assert.doesNotMatch(deploy,/env:process\.env/);
  assert.match(deploy,/name:'DISCORD_WEBHOOK_URL'/);assert.match(deploy,/DISCORD_WEBHOOK_URL:_discord/,'the webhook is kept out of wrangler\'s environment');
  assert.match(await read('.github/workflows/pages.yml'),/DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL \}\}/,'the deploy step passes the optional secret on');
});
test('the published page pins its connect-src to the deployed Worker; the source keeps the wildcard for local runs',async()=>{
  const {mkdtemp,writeFile,readFile:rf}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {spawnSync}=await import('node:child_process');
  const dir=await mkdtemp(`${tmpdir()}/configure-`),html=await read('index.html');
  assert.match(html,/connect-src [^;]*https:\/\/\*\.workers\.dev/);
  await writeFile(`${dir}/index.html`,html);await writeFile(`${dir}/config.json`,'{"backendUrl":""}');
  const run=url=>spawnSync(process.execPath,[new URL('../scripts/configure-frontend.mjs',import.meta.url).pathname],{cwd:dir,env:{BACKEND_URL:url},encoding:'utf8'});
  assert.notEqual(run('https://evil.example').status,0,'only a workers.dev address is accepted');
  const ok=run('https://eve-journal-api.someone.workers.dev');assert.equal(ok.status,0,ok.stderr);
  const pinned=await rf(`${dir}/index.html`,'utf8'),connect=pinned.match(/connect-src ([^;]+);/)[1].split(' ');
  assert.ok(connect.includes('https://eve-journal-api.someone.workers.dev'));assert.ok(!pinned.includes('*.workers.dev'));
  assert.equal(JSON.parse(await rf(`${dir}/config.json`,'utf8')).backendUrl,'https://eve-journal-api.someone.workers.dev');
});
test('the footer carries the CCP notice and the page refuses to run in a frame',async()=>{
  const html=await read('index.html'),footer=html.match(/<footer class="foot">[\s\S]*?<\/footer>/)[0];
  assert.match(footer,/© 2014 CCP hf\. All rights reserved\./);assert.match(footer,/trademarks or registered trademarks of CCP hf\./);assert.match(footer,/not affiliated with CCP Games/);
  assert.match(await read('app.js'),/window\.top !== window\.self/);
});
