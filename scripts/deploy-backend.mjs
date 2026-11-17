import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const token=process.env.CLOUDFLARE_API_TOKEN?.trim(),account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),eveSecret=process.env.EVE_CLIENT_SECRET?.trim(),pipelineSecret=process.env.PIPELINE_SECRET?.trim();
if(!token||!account||!eveSecret)throw new Error('Missing CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or EVE_CLIENT_SECRET. Add repository Actions secrets before deploying.');
if(!/^[a-f0-9]{32}$/i.test(account))throw new Error('Cloudflare Account ID must contain 32 hexadecimal characters.');
const clientId='a94f7ccbcc8b4b0d8f7fd90fec110d2b';
const DAILY_CRON='17 3 * * *'; // keep in step with DAILY_CRON in worker/index.js (a test checks)
const name='eve-journal-api',dbName='eve-journal';
async function cf(path,method='GET',body){
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();
 if(!response.ok||!result.success){const error=new Error(`Cloudflare ${method} ${path.split('?')[0]} failed: HTTP ${response.status}; provider codes ${(result.errors||[]).map(e=>e.code).join(',')}. Check the token's account and permissions.`);error.status=response.status;error.codes=(result.errors||[]).map(e=>e.code);throw error;}
 return result.result;
}
const databases=await cf('/d1/database?per_page=100');
let database=databases.find(item=>item.name===dbName);
if(!database){database=await cf('/d1/database','POST',{name:dbName});console.log('Created the EVE D1 database.');}
let subdomain;
try{subdomain=await cf('/workers/subdomain');}catch(error){if(error.status!==404||!error.codes.includes(10007))throw error;console.log('This account has no workers.dev subdomain yet; registering one.');}
if(!subdomain?.subdomain)subdomain=await cf('/workers/subdomain','PUT',{subdomain:`eve-pilots-${randomBytes(4).toString('hex')}`});
const url=`https://${name}.${subdomain.subdomain}.workers.dev`;
console.log(`Worker target: ${url}`);
await mkdir('.cloudflare',{recursive:true});
const config={name,main:resolve('worker/index.js'),compatibility_date:'2025-09-01',workers_dev:true,// Workers Logs: the Worker writes one structured JSON line per request and per cron run (worker/index.js log). The free
// plan keeps 200k log events a day for 3 days; every run is sampled (the traffic is far below that) and the automatic
// invocation log is off, so each request costs one event, not two.
observability:{enabled:true,head_sampling_rate:1,logs:{enabled:true,invocation_logs:false,head_sampling_rate:1}},vars:{FRONTEND_URL:'https://matheusfiorin.github.io/eve-journal/',EVE_CLIENT_ID:clientId},d1_databases:[{binding:'DB',database_name:dbName,database_id:database.uuid,migrations_dir:resolve('worker/migrations')}],// Rate Limiting bindings, per client address per minute (the Worker does nothing when one is missing).
ratelimits:[{name:'RATE_AUTH',namespace_id:'710001',simple:{limit:10,period:60}},{name:'RATE_MARKET',namespace_id:'710002',simple:{limit:60,period:60}},{name:'RATE_JOURNAL',namespace_id:'710003',simple:{limit:120,period:60}}],
// Every 5 minutes: pilot sync or the hourly kills sample. Daily: cleanup of expired sessions and journal tombstones.
triggers:{crons:['*/5 * * * *',DAILY_CRON]}};
const configPath=resolve('.cloudflare/wrangler.json');await writeFile(configPath,JSON.stringify(config,null,2));
// Wrangler needs the Cloudflare credentials, not the EVE or pipeline secrets, so those are left out of its environment.
const {EVE_CLIENT_SECRET:_eve,PIPELINE_SECRET:_pipeline,...wranglerEnv}=process.env;
function wrangler(args){
 const result=spawnSync('npx',['--no-install','wrangler',...args,'--config',configPath],{encoding:'utf8',input:'y\n',env:wranglerEnv,maxBuffer:4*1024*1024});
 if(result.status!==0)throw new Error(`Wrangler ${args[0]} failed (exit ${result.status}). No secret values are included in this log.`);
}
wrangler(['d1','migrations','apply','DB','--remote']);console.log('D1 migrations applied.');
wrangler(['deploy']);console.log('Worker deployed.');
const secrets=await cf(`/workers/scripts/${name}/secrets`);
if(!secrets.some(item=>item.name==='TOKEN_ENCRYPTION_KEY')){
 await cf(`/workers/scripts/${name}/secrets`,'PUT',{name:'TOKEN_ENCRYPTION_KEY',type:'secret_text',text:randomBytes(32).toString('base64')});
 console.log('Created a persistent token encryption key in Cloudflare.');
}
await cf(`/workers/scripts/${name}/secrets`,'PUT',{name:'EVE_CLIENT_SECRET',type:'secret_text',text:eveSecret});
console.log('EVE client secret configured in Cloudflare.');
if(pipelineSecret){await cf(`/workers/scripts/${name}/secrets`,'PUT',{name:'PIPELINE_SECRET',type:'secret_text',text:pipelineSecret});console.log('Pipeline signing secret configured in Cloudflare.');}
else console.log('PIPELINE_SECRET is not set: the market pipeline still uses the legacy fixed token. See worker/README.md.');
let healthy=false,lastHealth={};
for(let attempt=0;attempt<30;attempt++){
 try{const r=await fetch(`${url}/health`,{signal:AbortSignal.timeout(15000)});lastHealth={status:r.status};const body=await r.json();lastHealth={status:r.status,ready:body.ready,database:body.database,error:body.error};healthy=r.ok&&body.ready;}catch(error){lastHealth={networkError:error.code||error.cause?.code||error.name};}
 if(healthy)break;await new Promise(r=>setTimeout(r,3000));
}
if(!healthy)console.error(`Health diagnostic: ${JSON.stringify(lastHealth)}`);
if(!healthy)throw new Error('Worker health check failed after deployment. Check the Worker and D1 binding in Cloudflare.');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`url=${url}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## EVE backend deployed\n\n- API: ${url}\n- **Set the EVE application callback to: ${url}/auth/callback**\n- Refresh schedule: every 5 minutes (a pilot sync or the hourly kills sample), plus a daily cleanup at 03:17 UTC.\n- Pipeline signing: ${pipelineSecret?'PIPELINE_SECRET is set; uploads must be signed.':'**PIPELINE_SECRET is not set**; uploads use the legacy fixed token (see worker/README.md).'}\n- Skill totals and queue are published only after each pilot confirms sharing consent.\n- Wallet, ship, location, and industry data require that pilot's private dashboard session.\n`);
console.log(`Backend ready: ${url}`);console.log(`EVE callback: ${url}/auth/callback`);
