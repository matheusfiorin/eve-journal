// Hourly health check (.github/workflows/health.yml): asks the Worker's public /health/freshness and reports whether the
// stored market data, kills sample and pilot syncs are recent. The Worker's address comes from the published config.json,
// the same place the market pipeline reads it; no secret is involved. The answer holds ages only, so the report is safe to
// post in a public issue.
import {appendFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const age=s=>s===null||s===undefined?'missing':s<5400?`${Math.round(s/60)} min`:`${(s/3600).toFixed(1)} h`;
export async function checkHealth(site,fetchImpl=fetch){
 let backend;
 try{backend=(await (await fetchImpl(new URL('config.json',site),{signal:AbortSignal.timeout(30000)})).json()).backendUrl;}catch{return {healthy:false,report:'The published config.json could not be read.'};}
 if(!backend)return {healthy:false,report:'The published config.json has no backendUrl.'};
 let r;try{r=await fetchImpl(`${backend}/health/freshness`,{signal:AbortSignal.timeout(30000)});}catch{return {healthy:false,report:'The Worker did not answer /health/freshness.'};}
 let body=null;try{body=await r.json();}catch{/* Reported below. */}
 if(r.status===404)return {healthy:false,report:'The Worker has no /health/freshness yet (deploy pending?).'};
 if(!body||!Array.isArray(body.problems))return {healthy:false,report:`The Worker answered HTTP ${r.status} without a freshness report.`};
 const lines=[`Market meta ${age(body.market?.metaAge)}, hub rows ${age(body.market?.hubs?.oldestAge)} (oldest of ${body.market?.hubs?.count??0}), universe ${age(body.market?.universeAge)}`,`Activity sample ${age(body.activityAge)}`,...(body.pilots||[]).map(p=>`Pilot ${p.pilot}: last sync ${age(p.syncAge)}${p.error?', error flagged':''}`)];
 return {healthy:r.ok&&body.ok===true,report:`${body.ok?'Healthy':`Stale: ${body.problems.join(', ')}`}\n\n${lines.map(l=>`- ${l}`).join('\n')}`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {healthy,report}=await checkHealth(process.env.SITE_URL||'https://matheusfiorin.github.io/eve-journal/');
 console.log(report);
 await writeFile('health-report.md',report);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`healthy=${healthy}\n`);
 // The job itself stays green here: the next step opens, updates or closes the issue from the output.
}
