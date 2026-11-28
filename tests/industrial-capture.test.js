// Synthetic HTTP fixtures test the diagnostic tool, NOT compatibility with actual CCP payloads.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {captureIndustrialContracts,parseCaptureArgs,ESI_DATE} from '../scripts/capture-industrial-contracts.mjs';

const RELEASE='20261119T120000Z', OTHER='20261120T120000Z', SDE='https://sde.evetech.net';
const json=(value,headers={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json',...headers}});
async function options(t,override={}){
  const base=resolve(tmpdir()), outputRoot=await mkdtemp(join(base,'eve-industrial-capture-test-'));
  t.after(async()=>{
    // Only remove the directory generated for this test, under the resolved system temp directory.
    assert.ok(resolve(outputRoot).startsWith(base+sep));
    assert.ok(outputRoot.slice(base.length+1).startsWith('eve-industrial-capture-test-'));
    await rm(outputRoot,{recursive:true,force:true});
  });
  return {outputRoot,now:()=>new Date('2026-11-27T22:00:00Z'),fetchImpl:async url=>
    url.endsWith('/latest/')?new Response(null,{status:302,headers:{location:`/tranquility/${RELEASE}/`}}):
    url.endsWith(`/${RELEASE}/`)?json({release:RELEASE,tables:{}}):json({synthetic:true}),...override};
}
test('capture pins the release, saves exact bytes and hashes, and leaves homologation pending',async t=>{
  const opts=await options(t), original=opts.fetchImpl, calls=[];
  const raw=Buffer.from('\uFEFF{ "synthetic": true, "name": "Ação" }\n');
  opts.fetchImpl=async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/types/587.json'))return new Response(raw,{headers:{etag:'"fixture-v1"','set-cookie':'private=excluded','content-type':'application/json'}});
    return original(url,init);
  };
  const {outputDir,report}=await captureIndustrialContracts(opts);
  assert.equal(report.status,'captured');assert.equal(report.homologation,'pending-review');
  assert.equal(report.release,RELEASE);assert.equal(report.resources.length,12);assert.deepEqual(report.failures,[]);
  assert.equal(calls.filter(x=>x.url.endsWith('/latest/')).length,1);
  for(const {url,init} of calls){
    assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
    assert.match(init.headers.Accept,/application\/openapi\+json/);
    assert.equal(init.headers.Authorization,undefined);
    if(url.startsWith(SDE)&&!url.endsWith('/latest/'))assert.ok(url.startsWith(`${SDE}/tranquility/${RELEASE}/`));
    assert.equal(init.headers['X-Compatibility-Date'],url.startsWith('https://esi.evetech.net')?ESI_DATE:undefined);
  }
  const resource=report.resources.find(x=>x.file==='types-587.json');
  assert.deepEqual(await readFile(join(outputDir,resource.file)),raw);
  assert.equal(resource.sha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(resource.bytes,raw.length);assert.deepEqual(resource.headers,{'etag':'"fixture-v1"','content-type':'application/json'});
  assert.equal(report.resources[0].redirects.length,1);
  assert.deepEqual(JSON.parse(await readFile(join(outputDir,'capture-report.json'),'utf8')),report);
});
test('explicit release skips latest; extra probes are deduplicated and get their schemas',async t=>{
  const opts=await options(t,{release:RELEASE,extraRecords:['types:587','typeDogma:587','typeDogma:587']}), original=opts.fetchImpl,calls=[];
  opts.fetchImpl=(url,init)=>{calls.push(url);return original(url,init);};
  const {report}=await captureIndustrialContracts(opts);
  assert.equal(report.status,'captured');assert.equal(report.resources.length,14);
  assert.ok(!calls.some(x=>x.includes('/latest/')));
  assert.equal(calls.filter(x=>x.endsWith('/typeDogma/587.json')).length,1);
  assert.ok(calls.includes(`${SDE}/tranquility/${RELEASE}/typeDogma.schema.json`));
});
test('inconsistent or invalid manifest stops SDE probes, retaining evidence for review',async t=>{
  for(const release of [OTHER,'20260230T120000Z',null]){
    const opts=await options(t,{release:RELEASE,fetchImpl:async url=>url.startsWith(SDE)?json({release}):json({synthetic:true})});
    const {report}=await captureIndustrialContracts(opts);
    assert.equal(report.status,'incomplete');assert.equal(report.release,null);
    assert.equal(report.resources.length,2);assert.equal(report.failures[0].code,'invalid_release');
  }
});
test('cross-origin and cross-release redirects fail before the target is fetched',async t=>{
  for(const target of ['https://example.com/secret','https://[bad','https://user:pass@sde.evetech.net/tranquility/latest/',`${SDE}/tranquility/${OTHER}/types/587.json`]){
    const opts=await options(t), original=opts.fetchImpl,calls=[];
    opts.fetchImpl=async(url,init)=>{
      calls.push(url);return url.endsWith('/types/587.json')?new Response(null,{status:302,headers:{location:target}}):original(url,init);
    };
    const {report}=await captureIndustrialContracts(opts);
    assert.equal(report.status,'incomplete');assert.equal(report.failures[0].code,'unsafe_redirect');assert.ok(!calls.includes(target));
  }
});
test('redirected manifest must agree with the exact release in its final URL',async t=>{
  const opts=await options(t), original=opts.fetchImpl;
  opts.fetchImpl=(url,init)=>url.endsWith(`/${RELEASE}/`)?json({release:OTHER}):original(url,init);
  const {report}=await captureIndustrialContracts(opts);
  assert.equal(report.release,null);assert.equal(report.failures[0].code,'invalid_release');assert.equal(report.resources.length,2);
});
test('invalid JSON is preserved; HTTP errors and stream/network failures stay incomplete',async t=>{
  const opts=await options(t), original=opts.fetchImpl;
  opts.fetchImpl=async(url,init)=>{
    if(url.endsWith('/types.schema.json'))return new Response('{broken');
    if(url.endsWith('/groups.schema.json'))return new Response(null,{status:429,headers:{'retry-after':'60'}});
    if(url.endsWith('/categories.schema.json'))throw Object.assign(new Error('secret must not be logged'),{code:'ENOTFOUND'});
    if(url.endsWith('/blueprints.schema.json'))return new Response(new ReadableStream({start(c){c.error(new Error('private detail'));}}));
    return original(url,init);
  };
  const {report,outputDir}=await captureIndustrialContracts(opts);
  assert.equal(report.status,'incomplete');assert.deepEqual(report.failures.map(x=>x.code),['invalid_json','http_error','network_error','network_error']);
  assert.equal(await readFile(join(outputDir,'types.schema.json'),'utf8'),'{broken');
  assert.match(report.failures[1].message,/429.*60/);assert.ok(!JSON.stringify(report).includes('secret'));assert.ok(!JSON.stringify(report).includes('private detail'));
});
test('response size limit prevents saving oversized evidence',async t=>{
  const opts=await options(t), original=opts.fetchImpl;
  opts.fetchImpl=(url,init)=>url.endsWith('/types.schema.json')?new Response(new Uint8Array(8*1024*1024+1)):original(url,init);
  const {report,outputDir}=await captureIndustrialContracts(opts);
  assert.equal(report.status,'incomplete');assert.equal(report.failures[0].code,'size_limit');
  assert.ok(!(await readdir(outputDir)).includes('types.schema.json'));
});
test('DNS failures produce a saved incomplete report without invented resources',async t=>{
  const opts=await options(t,{fetchImpl:async()=>{throw {cause:{code:'ENOTFOUND'}};}});
  const {report,outputDir}=await captureIndustrialContracts(opts);
  assert.equal(report.status,'incomplete');assert.equal(report.release,null);assert.deepEqual(report.resources,[]);
  assert.deepEqual(report.failures.map(x=>x.code),['network_error','network_error']);assert.deepEqual(await readdir(outputDir),['capture-report.json']);
});
test('repeated runs never overwrite previous capture files',async t=>{
  const opts=await options(t), first=await captureIndustrialContracts(opts), second=await captureIndustrialContracts(opts);
  assert.notEqual(first.outputDir,second.outputDir);assert.equal((await readdir(opts.outputRoot)).length,2);
  assert.deepEqual(await readFile(join(first.outputDir,'capture-report.json')),await readFile(join(second.outputDir,'capture-report.json')));
});
test('invalid options reject before any HTTP request or output directory is created',async t=>{
  const opts=await options(t);let calls=0;opts.fetchImpl=()=>{calls++;throw new Error('must not run');};
  for(const override of [{release:'20261301T000000Z'},{extraRecords:['types:1:2']},{extraRecords:['../types:1']},{extraRecords:['types:0']},{extraRecords:['types:9007199254740992']},{extraRecords:Array(25).fill('types:587')}]){
    await assert.rejects(captureIndustrialContracts({...opts,...override}),e=>e.code==='invalid_release'||e.code==='invalid_record');
  }
  assert.equal(calls,0);assert.deepEqual(await readdir(opts.outputRoot),[]);
});
test('CLI requires an explicit output directory and rejects ambiguous arguments',()=>{
  assert.deepEqual(parseCaptureArgs(['--output','capture dir','--release',RELEASE,'--record','typeDogma:587']),{outputRoot:'capture dir',release:RELEASE,extraRecords:['typeDogma:587']});
  assert.deepEqual(parseCaptureArgs(['--help']),{help:true});
  for(const args of [[],['--output'],['--output','--release'],['--token','private']])assert.throws(()=>parseCaptureArgs(args),e=>e.code==='invalid_options');
});
