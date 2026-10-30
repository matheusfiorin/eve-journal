import {readFile,writeFile} from 'node:fs/promises';
const backend=new URL(process.env.BACKEND_URL);
if(backend.protocol!=='https:'||!backend.hostname.endsWith('.workers.dev'))throw new Error('Expected a deployed Cloudflare Workers HTTPS URL.');
const config=JSON.parse(await readFile('config.json','utf8'));
config.backendUrl=backend.origin;
await writeFile('config.json',JSON.stringify(config,null,2)+'\n');
console.log('Public frontend backend URL configured.');
