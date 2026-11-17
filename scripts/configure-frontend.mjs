import {readFile,writeFile} from 'node:fs/promises';
const backend=new URL(process.env.BACKEND_URL);
if(backend.protocol!=='https:'||!backend.hostname.endsWith('.workers.dev'))throw new Error('Expected a deployed Cloudflare Workers HTTPS URL.');
const config=JSON.parse(await readFile('config.json','utf8'));
config.backendUrl=backend.origin;
await writeFile('config.json',JSON.stringify(config,null,2)+'\n');
// The source page allows any *.workers.dev (so local and browser tests can reach their own mock); the published one
// may connect to this Worker only.
const html=await readFile('index.html','utf8');
if(!html.includes('https://*.workers.dev'))throw new Error('index.html has no *.workers.dev entry to pin.');
await writeFile('index.html',html.replace('https://*.workers.dev',backend.origin));
console.log('Public frontend backend URL configured and pinned in the page security policy.');
