import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const token=process.env.CLOUDFLARE_API_TOKEN?.trim(),account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),eveSecret=process.env.EVE_CLIENT_SECRET?.trim();
if(!token||!account||!eveSecret)throw new Error('Missing CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or EVE_CLIENT_SECRET. Add repository Actions secrets before deploying.');
if(!/^[a-f0-9]{32}$/i.test(account))throw new Error('Cloudflare Account ID must contain 32 hexadecimal characters.');
const clientId='a94f7ccbcc8b4b0d8f7fd90fec110d2b';
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
await mkdir('.cloudflare',{recursive:true});
const config={name,main:resolve('worker/index.js'),compatibility_date:'2025-09-01',workers_dev:true,observability:{enabled:false},vars:{FRONTEND_URL:'https://matheusfiorin.github.io/eve-journal/',EVE_CLIENT_ID:clientId},d1_databases:[{binding:'DB',database_name:dbName,database_id:database.uuid,migrations_dir:resolve('worker/migrations')}],triggers:{crons:['*/30 * * * *']}};
const configPath=resolve('.cloudflare/wrangler.json');await writeFile(configPath,JSON.stringify(config,null,2));
function wrangler(args){
 const result=spawnSync('npx',['--no-install','wrangler',...args,'--config',configPath],{encoding:'utf8',input:'y\n',env:process.env,maxBuffer:4*1024*1024});
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
let healthy=false;
for(let attempt=0;attempt<15;attempt++){
 try{const r=await fetch(`${url}/health`,{signal:AbortSignal.timeout(15000)});healthy=r.ok&&(await r.json()).ready;}catch{}
 if(healthy)break;await new Promise(r=>setTimeout(r,2000));
}
if(!healthy)throw new Error('Worker health check failed after deployment. Check the Worker and D1 binding in Cloudflare.');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`url=${url}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## EVE backend deployed\n\n- API: ${url}\n- **Set the EVE application callback to: ${url}/auth/callback**\n- Refresh schedule: every 30 minutes.\n- Skill totals and queue are published only after each pilot confirms sharing consent.\n- Wallet, ship, location, and industry data require that pilot's private dashboard session.\n`);
console.log(`Backend ready: ${url}`);console.log(`EVE callback: ${url}/auth/callback`);
