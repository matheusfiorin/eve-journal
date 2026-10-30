export const SCOPES = ['esi-skills.read_skills.v1', 'esi-skills.read_skillqueue.v1'];
export const OPERATIONS_SCOPES = {
  wallet:'esi-wallet.read_character_wallet.v1',
  location:'esi-location.read_location.v1',
  ship:'esi-location.read_ship_type.v1',
  jobs:'esi-industry.read_character_jobs.v1',
  journal:'esi-wallet.read_character_wallet.v1',
  transactions:'esi-wallet.read_character_wallet.v1',
  attributes:'esi-skills.read_skills.v1',
  clones:'esi-clones.read_clones.v1',
  implants:'esi-clones.read_implants.v1'
};
export const REQUESTED_SCOPES = [...new Set([...SCOPES, ...Object.values(OPERATIONS_SCOPES)])];
export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) {
  if (!/^[\w-]+$/.test(value)) throw new Error('Malformed EVE token.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function challenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export function validateState(pending, state, now = Date.now()) {
  if (!pending || !state || pending.state !== state || !Number.isFinite(pending.created) ||
      now - pending.created > 300000 || pending.created > now ||
      !Number.isSafeInteger(pending.expectedId) || !pending.clientId || !pending.verifier) {
    throw new Error('EVE login expired or did not match this browser. Connect again.');
  }
}
// Trust only keys from the fixed CCP HTTPS endpoint, never a URL from the token.
export async function validateToken(token, clientId, expectedId, keys, now = Date.now()) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed EVE token.');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if (!['RS256', 'ES256'].includes(header.alg) || header.crit) throw new Error('Unsupported EVE token signature.');
  const jwk = keys.find(k => k.kid === header.kid && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg));
  if (!jwk) throw new Error('EVE signing key not found. Please reconnect.');
  const algorithm = header.alg === 'RS256' ? {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'} : {name:'ECDSA', namedCurve:'P-256'};
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  const verified = await crypto.subtle.verify(header.alg === 'RS256' ? 'RSASSA-PKCS1-v1_5' : {name:'ECDSA', hash:'SHA-256'}, key,
    decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!verified) throw new Error('EVE token signature could not be verified.');
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (!['login.eveonline.com','https://login.eveonline.com','https://login.eveonline.com/'].includes(claims.iss) ||
      !Array.isArray(claims.aud) || !claims.aud.includes(clientId) || !claims.aud.includes('EVE Online') ||
      !Number.isFinite(claims.exp) || claims.exp * 1000 <= now ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now)) ||
      (claims.azp !== undefined && claims.azp !== clientId)) throw new Error('EVE token issuer, audience, or expiry is invalid.');
  if (claims.sub !== `CHARACTER:EVE:${expectedId}`) throw new Error('You selected a different EVE character. Connect the configured pilot.');
  const scopes = Array.isArray(claims.scp) ? claims.scp : String(claims.scp || '').split(' ');
  if (!SCOPES.every(s => scopes.includes(s))) throw new Error('EVE did not grant both skills and queue permissions. Reconnect and allow both.');
  return {name:claims.name, expires:claims.exp * 1000, scopes};
}
