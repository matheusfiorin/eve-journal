import test from 'node:test';
import assert from 'node:assert/strict';
import {SCOPES,base64url,challenge,validateState,validateToken} from '../auth.js';

const now=Date.parse('2026-10-30T12:00:00Z');
const client='test-public-client', id=123456;
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',use:'sig',alg:'RS256'};
const claims={iss:'https://login.eveonline.com',aud:[client,'EVE Online'],sub:`CHARACTER:EVE:${id}`,azp:client,exp:now/1000+1200,name:'Fiofka',scp:SCOPES};
const encode=value=>base64url(new TextEncoder().encode(JSON.stringify(value)));
async function sign(overrides={},header={alg:'RS256',kid:'test-key'}) {
  const input=`${encode(header)}.${encode({...claims,...overrides})}`;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}
test('PKCE uses the RFC 7636 S256 challenge vector',async()=>{
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('login state rejects mismatches, old, future and incomplete state',()=>{
  const pending={state:'random',created:now,expectedId:id,clientId:client,verifier:'secret'};
  assert.doesNotThrow(()=>validateState(pending,'random',now));
  for(const [p,s] of [[null,'random'],[pending,'other'],[{...pending,created:now-300001},'random'],[{...pending,created:now+1},'random'],[{...pending,expectedId:undefined},'random']])assert.throws(()=>validateState(p,s,now));
});
test('accepts a signed EVE token for the correct application and pilot',async()=>{
  assert.deepEqual(await validateToken(await sign(),client,id,[jwk],now),{name:'Fiofka',expires:now+1200000});
});
test('rejects a tampered payload even if its claims look valid',async()=>{
  const token=await sign(),parts=token.split('.');parts[1]=encode({...claims,name:'Impostor'});
  await assert.rejects(validateToken(parts.join('.'),client,id,[jwk],now),/signature/);
});
test('rejects unsigned, unknown-key and unsupported algorithms',async()=>{
  for(const header of [{alg:'none',kid:'test-key'},{alg:'HS256',kid:'test-key'},{alg:'RS256',kid:'other'},{alg:'RS256',kid:'test-key',crit:['custom']}])await assert.rejects(validateToken(await sign({},header),client,id,[jwk],now));
});
for(const [name,overrides] of [
  ['wrong issuer',{iss:'https://evil.example'}],['missing client audience',{aud:['EVE Online']}],['missing EVE audience',{aud:[client]}],
  ['expired',{exp:now/1000}],['future validity',{nbf:now/1000+10}],['wrong character',{sub:'CHARACTER:EVE:999'}],
  ['missing skill scope',{scp:['esi-skills.read_skillqueue.v1']}],['wrong authorized party',{azp:'another-app'}]
])test(`rejects signed tokens with ${name}`,async()=>{await assert.rejects(validateToken(await sign(overrides),client,id,[jwk],now));});
test('supports the EVE hostname issuer form',async()=>{const token=await sign({iss:'login.eveonline.com'}); assert.equal((await validateToken(token,client,id,[jwk],now)).name,'Fiofka');});
test('verifies ECDSA tokens using a CCP-style P-256 key',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'ec-key',alg:'ES256',use:'sig'};
  const input=`${encode({alg:'ES256',kid:'ec-key'})}.${encode(claims)}`;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(input));
  const token=`${input}.${base64url(new Uint8Array(signature))}`;
  assert.equal((await validateToken(token,client,id,[key],now)).name,'Fiofka');
});
