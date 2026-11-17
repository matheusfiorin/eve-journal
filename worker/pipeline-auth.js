// Signed requests from the market pipeline, shared by the Worker (verify) and scripts/market-pipeline.mjs (sign).
// The signature covers the timestamp, method, path and a digest of the body, so a captured request can't be replayed
// outside PIPELINE_WINDOW, reused on another route, or carry another body.
export const PIPELINE_WINDOW=5*60000;
const encoder=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function bodyDigest(bytes){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}
// bytes: the request body as sent (Uint8Array, empty for a GET).
export async function pipelineSignature(secret,{ts,method,path,bytes=new Uint8Array(0)}){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${ts}|${method.toUpperCase()}|${path}|${await bodyDigest(bytes)}`))));
}
// Headers to send with a request to path (no query string is signed: the pipeline sends none).
export async function signPipelineRequest(secret,method,path,body='',now=Date.now()){
 const ts=String(now);
 return {'X-Pipeline-Timestamp':ts,'X-Pipeline-Signature':await pipelineSignature(secret,{ts,method,path,bytes:encoder.encode(body)})};
}
