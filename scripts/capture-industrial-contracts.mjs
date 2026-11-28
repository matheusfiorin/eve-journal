// Diagnostic evidence capture for phase 0B. No normalization, schema homologation or production pipeline writes.
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ESI_DATE='2026-11-19';
const SDE='https://sde.evetech.net', ESI='https://esi.evetech.net';
const TABLES=['types','groups','categories','blueprints'];
// Small reference probes, NOT a catalog allowlist or a claim that their live contents have been reviewed.
const SEEDS=[['types',587],['types',691],['blueprints',691],['groups',25],['categories',6],['categories',9]];
const HEADERS={Accept:'application/json, application/openapi+json','User-Agent':'eve-journal industrial contract capture (+https://github.com/matheusfiorin/eve-journal)'};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export class CaptureError extends Error { constructor(code,message) { super(message);this.name='CaptureError';this.code=code; } }
const fail=(code,message)=>{throw new CaptureError(code,message);};
function validRelease(value){
  if(typeof value!=='string'||!/^\d{8}T\d{6}Z$/.test(value))return false;
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;
  return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().replace(/[-:]/g,'').replace('.000','')===value;
}
function record(value){
  const parts=typeof value==='string'?value.split(':'):Array.isArray(value)?value:[], [table,id]=parts;
  if(parts.length!==2||typeof table!=='string'||!/^[a-zA-Z][a-zA-Z0-9]*$/.test(table)||!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<1)fail('invalid_record','Records must be table:positiveInteger.');
  return [table,Number(id)];
}
function safeURL(value,initial,manifest,schemaVersion=null){
  let url,original;try{url=new URL(value);original=new URL(initial);}catch{fail('unsafe_redirect','Invalid public resource URL.');}
  if(url.origin!==original.origin||url.protocol!=='https:'||url.username||url.password||url.hash)fail('unsafe_redirect','Redirect left the approved public origin.');
  if(manifest){
    const m=/^\/tranquility\/(latest|\d{8}T\d{6}Z)\/$/.exec(url.pathname);
    if(!m||url.search||(m[1]!=='latest'&&!validRelease(m[1])))fail('unsafe_redirect','Unexpected SDE manifest location.');
  }else{
    // The release-specific schema URL aliases a blob identified by that table's manifest version.
    // This is a table version, NOT an assertion that the schema bytes hash to the same value.
    const blob=schemaVersion&&/^[a-f0-9]{64}$/.test(schemaVersion)?`${SDE}/blobs/${schemaVersion}.schema.json`:null;
    if(url.href!==original.href&&url.href!==blob)fail('unsafe_redirect','Redirect changed the pinned resource identity.');
  }
  return url.href;
}
async function bytesOf(response,maxBytes){
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();fail('size_limit','Decoded response exceeded the capture size limit.');}chunks.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
async function download(initial,{fetchImpl,manifest=false,maxBytes,schemaVersion=null}){
  let url=initial;const redirects=[];
  for(let i=0;i<6;i++){
    url=safeURL(url,initial,manifest,schemaVersion);
    let response;
    try{response=await fetchImpl(url,{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(30000),
      headers:{...HEADERS,...(new URL(url).origin===ESI?{'X-Compatibility-Date':ESI_DATE}:{})}});}
    catch(error){fail('network_error',`Public request failed (${error?.cause?.code??error?.code??error?.name??'network'}).`);}
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location)fail('unsafe_redirect','Redirect did not provide a location.');
      let target;try{target=new URL(location,url).href;}catch{fail('unsafe_redirect','Invalid redirect location.');}
      const next=safeURL(target,initial,manifest,schemaVersion);redirects.push({url,status:response.status,to:next});url=next;continue;
    }
    if(response.status!==200){await response.body?.cancel();fail('http_error',`HTTP ${response.status}; Retry-After: ${response.headers.get('retry-after')??'absent'}.`);}
    let bytes;try{bytes=await bytesOf(response,maxBytes);}catch(error){
      if(error instanceof CaptureError)throw error;
      fail('network_error','Public response stream was interrupted.');
    }
    const headers={};
    for(const name of ['etag','last-modified','content-type','content-encoding','cache-control','x-compatibility-date']){
      const value=response.headers.get(name);if(value!==null)headers[name]=value;
    }
    return {bytes,url,redirects,headers,status:response.status};
  }
  fail('redirect_limit','Too many redirects.');
}

export async function captureIndustrialContracts({outputRoot,fetchImpl=globalThis.fetch,now=()=>new Date(),release=null,extraRecords=[]}={}){
  if(typeof outputRoot!=='string'||!outputRoot.trim()||typeof fetchImpl!=='function')fail('invalid_options','An output directory and fetch implementation are required.');
  if(release!==null&&!validRelease(release))fail('invalid_release','Expected an exact SDE release, for example YYYYMMDDTHHMMSSZ.');
  if(!Array.isArray(extraRecords)||extraRecords.length>24)fail('invalid_record','At most 24 additional record probes are allowed.');
  const records=[...new Map([...SEEDS,...extraRecords.map(record)].map(r=>[r.join(':'),r])).values()];
  const tables=[...new Set([...TABLES,...records.map(([table])=>table)])];
  const at=now().toISOString(), outputDir=join(resolve(outputRoot),`${at.replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
  await mkdir(outputDir,{recursive:true});
  const report={version:1,purpose:'industrial-phase-0B-evidence',status:'incomplete',homologation:'pending-review',
    startedAt:at,completedAt:null,release:null,esiCompatibilityDate:ESI_DATE,
    bodyRepresentation:'Fetch-decoded response bytes; SHA-256 hashes the exact saved file, not gzip transport bytes.',
    resources:[],failures:[]};
  let totalBytes=0;
  async function capture(file,url,{manifest=false,table=null,schema=false}={}){
    try{
      const remaining=32*1024*1024-totalBytes;
      if(remaining<=0)fail('size_limit','Capture exceeded the total size limit.');
      const data=await download(url,{fetchImpl,manifest,schemaVersion:schema?table?.version:null,maxBytes:Math.min(8*1024*1024,remaining)});totalBytes+=data.bytes.length;
      await writeFile(join(outputDir,file),data.bytes,{flag:'wx'});
      const resource={file,requestedUrl:url,url:data.url,status:data.status,retrievedAt:now().toISOString(),
        bytes:data.bytes.length,sha256:hash(data.bytes),headers:data.headers,redirects:data.redirects,
        ...(table?{table:table.name,tableVersion:table.version,release:report.release}:{})};report.resources.push(resource);
      let json;try{json=JSON.parse(data.bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('invalid_json',`${file} is not JSON; raw bytes were preserved.`);}
      return {json,resource};
    }catch(error){
      if(!(error instanceof CaptureError))throw error;
      report.failures.push({file,url,code:error.code,message:error.message});return null;
    }
  }
  const manifest=await capture('sde-manifest.json',`${SDE}/tranquility/${release??'latest'}/`,{manifest:true});
  if(manifest){
    const found=manifest.json?.release, pathRelease=/\/tranquility\/(\d{8}T\d{6}Z)\/$/.exec(new URL(manifest.resource.url).pathname)?.[1];
    if(!plain(manifest.json)||!validRelease(found)||(release&&found!==release)||(pathRelease&&pathRelease!==found)){
      report.failures.push({file:'sde-manifest.json',code:'invalid_release',message:'Manifest release is absent, invalid or inconsistent with its URL. Review the saved manifest.'});
    }else{
      report.release=found;const base=`${SDE}/tranquility/${found}/`, sources=new Map();
      for(const name of tables){
        const version=manifest.json.tables?.[name]?.version;
        if(typeof version!=='string'||!version.trim()){
          report.failures.push({file:`${name}.schema.json`,code:'invalid_table_version',message:'Selected table has no manifest version; no resource identity can be established.'});continue;
        }
        const table={name,version};sources.set(name,table);
        await capture(`${name}.schema.json`,`${base}${name}.schema.json`,{table,schema:true});
      }
      for(const [name,id] of records)if(sources.has(name))await capture(`${name}-${id}.json`,`${base}${name}/${id}.json`,{table:sources.get(name)});
    }
  }
  await capture('esi-openapi.json',`${ESI}/meta/openapi.json?compatibility_date=${ESI_DATE}`);
  report.completedAt=now().toISOString();
  if(report.release&&report.failures.length===0)report.status='captured';
  await writeFile(join(outputDir,'capture-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return {outputDir,report};
}

export function parseCaptureArgs(args){
  const options={extraRecords:[]};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--help')return {help:true};
    if(!['--output','--release','--record'].includes(arg)||!args[i+1]||args[i+1].startsWith('--'))fail('invalid_options','Use --output DIRECTORY [--release RELEASE] [--record TABLE:ID].');
    const value=args[++i];if(arg==='--record')options.extraRecords.push(value);else options[arg==='--output'?'outputRoot':'release']=value;
  }
  if(!options.outputRoot)fail('invalid_options','--output DIRECTORY is required; captures are never written to the repository implicitly.');
  return options;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const options=parseCaptureArgs(process.argv.slice(2));
    if(options.help)console.log('node scripts/capture-industrial-contracts.mjs --output DIRECTORY [--release YYYYMMDDTHHMMSSZ] [--record TABLE:ID]\nGET-only public evidence capture. This does not homologate schemas or modify the production pipeline.');
    else{const {outputDir,report}=await captureIndustrialContracts(options);
      console.log(`Capture: ${report.status}\nDirectory: ${outputDir}\nRelease: ${report.release??'unknown'}\nSaved resources: ${report.resources.length}\nHomologation: ${report.homologation}`);
      for(const f of report.failures)console.error(`${f.file}: ${f.code}: ${f.message}`);
      if(report.status!=='captured')process.exitCode=1;
    }
  }catch(error){console.error(error instanceof CaptureError?`${error.code}: ${error.message}`:'Capture failed while reading or writing local files.');process.exitCode=1;}
}
