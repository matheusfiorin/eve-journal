const required=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','EVE_CLIENT_SECRET'];
let missing=false;
for(const key of required) {
  const exists=Boolean(process.env[key]?.trim());
  console.log(`${key}: ${exists?'present':'MISSING'}`);
  if(!exists)missing=true;
}
if(missing)process.exit(1);
const id=process.env.CLOUDFLARE_ACCOUNT_ID.trim();
if(!/^[a-f0-9]{32}$/i.test(id)) {console.error('Cloudflare Account ID must contain 32 hexadecimal characters.');process.exit(1);}
async function check(path,label) {
  const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN.trim()}`},signal:AbortSignal.timeout(20000)});
  const body=await response.json();
  if(!response.ok||!body.success) {console.error(`${label}: FAILED (HTTP ${response.status}; provider codes ${(body.errors||[]).map(e=>e.code).join(',')})`);return false;}
  console.log(`${label}: accessible`);return true;
}
const results=[];
for(const [path,label] of [[`/accounts/${id}`,'Account settings'],[`/accounts/${id}/workers/scripts`,'Workers API'],[`/accounts/${id}/d1/database`,'D1 API']])results.push(await check(path,label));
if(results.some(r=>!r))process.exit(1);
console.log('Connection checks passed. EVE secret presence is confirmed; actual EVE authorization is tested after callback setup.');

const subdomainResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/workers/subdomain`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN.trim()}`}});
const subdomain=await subdomainResponse.json();
if(subdomain.success&&subdomain.result?.subdomain){
 const url=`https://eve-journal-api.${subdomain.result.subdomain}.workers.dev`;
 console.log(`Worker URL: ${url}`);
 try{const health=await fetch(`${url}/health`);const body=await health.json();console.log(`Worker health: ${JSON.stringify({status:health.status,ready:body.ready,database:body.database,error:body.error})}`);}catch(error){console.log(`Worker health network status: ${error.code||error.cause?.code||error.name}`);}
}
