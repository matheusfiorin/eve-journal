// The wing room: one Durable Object (SQLite-backed, WebSocket Hibernation API) shared by the two pilots' Android apps. It keeps the
// shared timers and the last 50 shared items (plans, pings) in its own SQLite, fans messages out to the other pilot's sockets, and
// (only with FCM secrets) sends a push to a wingmate whose app is not connected. Everything in it is private to the two pilots;
// nothing here is logged, and a message's text, label and route never leave the room except to the other pilot.
//
// Protocol: JSON {type, id, from, at, ...}; the server sets `from` (the authenticated pilot) and `at` (ms), whatever the client sent.
//   client -> room: timer.upsert {timer}, timer.remove {timer:{id}}, plan.share {plan}, ping {kind, text?, system?}, presence {timers}
//   room -> client: state {timers, items, presence} first on connect, then the others' messages, presence on every join/leave, error {code}
// Not extending cloudflare:workers' DurableObject keeps this importable in Node tests; the class-with-constructor(state, env) form is
// still a valid Durable Object.

export const DAY = 86400000, MAX_MESSAGE = 8192, MAX_ITEMS = 50, MAX_TIMERS = 100, RATE_WINDOW = 10000, RATE_MAX = 40;
const PING_KINDS = ['undock', 'help', 'omw', 'docked', 'custom'], PLAN_KINDS = ['sell', 'haul', 'explore'];
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = v => Number.isFinite(v) && v >= 0;

/** A timer as the room stores it: validated, owner forced to the sender. Returns null for a malformed one. */
export function cleanTimer(t, pilot) {
  if (!t || typeof t !== 'object' || !str(t.id, 64) || !str(t.kind, 32) || !num(t.startedAt) || !num(t.durationMs) || t.durationMs > 7 * DAY) return null;
  if (t.label !== undefined && t.label !== null && !(typeof t.label === 'string' && t.label.length <= 80)) return null;
  if (t.pausedAt !== undefined && t.pausedAt !== null && !num(t.pausedAt)) return null;
  const meta = t.meta && typeof t.meta === 'object' && !Array.isArray(t.meta) ? t.meta : {};
  if (JSON.stringify(meta).length > 2048) return null;
  return {id: t.id, kind: t.kind, label: t.label || '', startedAt: t.startedAt, durationMs: t.durationMs, ...(t.pausedAt ? {pausedAt: t.pausedAt} : {}), owner: pilot, shared: t.shared !== false, meta};
}
function cleanPlan(p) {
  if (!p || typeof p !== 'object' || !PLAN_KINDS.includes(p.kind) || !str(p.title, 80)) return null;
  const route = Array.isArray(p.route) ? p.route.filter(n => Number.isSafeInteger(n) && n > 30000000 && n < 33000000).slice(0, 60) : [];
  const out = {kind: p.kind, title: p.title, summary: typeof p.summary === 'string' ? p.summary.slice(0, 400) : '', route};
  return JSON.stringify(out).length > 4096 ? null : out;
}
/** When a timer stops mattering: a day after it ended (a paused one, a day after it was paused). */
export const timerExpiry = t => Math.max(t.startedAt + t.durationMs, t.pausedAt || 0) + DAY;

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
/** FCM HTTP v1 needs an OAuth token from a service account: a JWT signed RS256 with the account's key, traded at Google's token endpoint. */
export async function fcmJwt(account, now = Date.now()) {
  const pem = String(account.private_key || '').replace(/-----[A-Z ]+-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
  const head = b64(enc.encode(JSON.stringify({alg: 'RS256', typ: 'JWT'}))), iat = Math.floor(now / 1000);
  const body = b64(enc.encode(JSON.stringify({iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3000})));
  return `${head}.${body}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)))}`;
}

export class WingRoom {
  constructor(state, env, {fetchImpl = (...a) => fetch(...a), pair = () => new WebSocketPair()} = {}) {
    this.state = state; this.env = env; this.fetchImpl = fetchImpl; this.pair = pair; this.rates = new WeakMap(); this.token = null;
    this.sql = state.storage.sql;
    this.q = (text, ...bind) => this.sql.exec(text, ...bind).toArray();
    this.q('CREATE TABLE IF NOT EXISTS timers (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, data TEXT NOT NULL, ends_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0)');
    this.q('CREATE TABLE IF NOT EXISTS items (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
  }
  // The Worker has checked the session and ALLOWED; it names the pilot in these headers (the room is reachable only through it).
  async fetch(request) {
    const url = new URL(request.url), pilot = Number(request.headers.get('X-Wing-Pilot') || NaN), name = request.headers.get('X-Wing-Name') || '';
    if (!Number.isSafeInteger(pilot)) return new Response('Forbidden', {status: 403});
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
    if (url.pathname === '/state' && request.method === 'GET') return json(this.snapshot());
    if (url.pathname === '/timer' && request.method === 'POST') {
      let body; try { body = JSON.parse(await request.text()); } catch { return json({error: 'Send JSON.'}, 400); }
      const out = body?.remove ? this.apply({type: 'timer.remove', timer: {id: body.remove}}, pilot, name) : this.apply({type: 'timer.upsert', timer: body?.timer}, pilot, name);
      if (out.error) return json({error: out.error}, 400);
      await this.deliver(out, null); return json(this.snapshot());
    }
    if (url.pathname === '/socket' && request.headers.get('Upgrade') === 'websocket') {
      const {0: client, 1: server} = Object.values(this.pair());
      this.attach(server, pilot, name);
      return new Response(null, {status: 101, webSocket: client});
    }
    return json({error: 'Not found.'}, 404);
  }
  attach(ws, pilot, name) {
    this.state.acceptWebSocket(ws);
    ws.serializeAttachment({pilot, name, timers: 0});
    ws.send(JSON.stringify({type: 'state', from: 0, at: Date.now(), ...this.snapshot()}));
    this.broadcastPresence();
  }
  sockets() { return this.state.getWebSockets().map(ws => ({ws, a: ws.deserializeAttachment() || {}})); }
  presence() {
    const by = new Map();
    for (const {a} of this.sockets()) if (a.pilot) { const p = by.get(a.pilot) || {pilot: a.pilot, name: a.name, online: true, timers: 0}; p.timers = Math.max(p.timers, a.timers || 0); by.set(a.pilot, p); }
    return [...by.values()];
  }
  purge(now = Date.now()) { this.q('DELETE FROM timers WHERE expires_at <= ?', now); }
  snapshot(now = Date.now()) {
    this.purge(now);
    return {timers: this.q('SELECT data FROM timers ORDER BY ends_at').map(r => JSON.parse(r.data)), items: this.q('SELECT data FROM items ORDER BY seq DESC LIMIT ?', MAX_ITEMS).map(r => JSON.parse(r.data)).reverse(), presence: this.presence()};
  }
  broadcastPresence() { const m = JSON.stringify({type: 'presence', from: 0, at: Date.now(), presence: this.presence()}); for (const {ws} of this.sockets()) try { ws.send(m); } catch { /* Closed. */ } }
  /** Validate a client message from `pilot` and update the room. Returns {broadcast: message|null, push?: {...}} or {error}. */
  apply(msg, pilot, name, now = Date.now()) {
    const base = {id: str(msg?.id, 64) ? msg.id : crypto.randomUUID(), from: pilot, at: now};
    switch (msg?.type) {
      case 'timer.upsert': {
        const t = cleanTimer(msg.timer, pilot);
        if (!t) return {error: 'invalid timer'};
        const row = this.q('SELECT owner FROM timers WHERE id = ?', t.id)[0];
        if (row && row.owner !== pilot) return {error: 'not your timer'};
        // A private timer is never kept or sent on; if it was shared before, the wingmate is told it is gone.
        if (!t.shared) { this.q('DELETE FROM timers WHERE id = ?', t.id); return row ? {broadcast: {type: 'timer.remove', ...base, timer: {id: t.id, owner: pilot}}} : {}; }
        if (!row && this.q('SELECT COUNT(*) AS n FROM timers')[0].n >= MAX_TIMERS) return {error: 'too many timers'};
        const ends = t.pausedAt ? 0 : t.startedAt + t.durationMs;
        this.q('INSERT INTO timers (id, owner, data, ends_at, expires_at, notified) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET data = excluded.data, ends_at = excluded.ends_at, expires_at = excluded.expires_at, notified = 0', t.id, pilot, JSON.stringify(t), ends, timerExpiry(t));
        return {broadcast: {type: 'timer.upsert', ...base, timer: t}, push: row ? null : {kind: 'timer.start', label: t.label, from: name}, alarm: true};
      }
      case 'timer.remove': {
        const id = msg.timer?.id, row = str(id, 64) ? this.q('SELECT owner FROM timers WHERE id = ?', id)[0] : null;
        if (!str(id, 64)) return {error: 'invalid timer'};
        if (row && row.owner !== pilot) return {error: 'not your timer'};
        this.q('DELETE FROM timers WHERE id = ?', id);
        return {broadcast: {type: 'timer.remove', ...base, timer: {id, owner: pilot}}};
      }
      case 'plan.share': {
        const plan = cleanPlan(msg.plan);
        if (!plan) return {error: 'invalid plan'};
        const out = {type: 'plan.share', ...base, plan};
        this.keep(out); return {broadcast: out};
      }
      case 'ping': {
        if (!PING_KINDS.includes(msg.kind) || (msg.text !== undefined && !str(msg.text, 140))) return {error: 'invalid ping'};
        const out = {type: 'ping', ...base, kind: msg.kind, ...(msg.text ? {text: msg.text} : {}), ...(Number.isSafeInteger(msg.system) && msg.system > 30000000 && msg.system < 33000000 ? {system: msg.system} : {})};
        this.keep(out); return {broadcast: out, push: {kind: 'ping', ping: msg.kind, text: msg.text || '', from: name}};
      }
      default: return {error: 'unknown type'};
    }
  }
  keep(item) {
    this.q('INSERT INTO items (data) VALUES (?)', JSON.stringify(item));
    this.q('DELETE FROM items WHERE seq <= (SELECT MAX(seq) FROM items) - ?', MAX_ITEMS);
  }
  async webSocketMessage(ws, message) {
    const a = ws.deserializeAttachment() || {}, now = Date.now(), r = this.rates.get(ws) || {at: now, n: 0};
    if (now - r.at > RATE_WINDOW) { r.at = now; r.n = 0; }
    this.rates.set(ws, r);
    const fail = code => ws.send(JSON.stringify({type: 'error', from: 0, at: now, code}));
    if (++r.n > RATE_MAX) return fail('rate_limited');
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return fail('too_large');
    let msg; try { msg = JSON.parse(message); } catch { return fail('bad_json'); }
    if (msg?.type === 'presence') {
      ws.serializeAttachment({...a, timers: Number.isSafeInteger(msg.timers) && msg.timers >= 0 ? Math.min(msg.timers, 99) : 0});
      return this.broadcastPresence();
    }
    const out = this.apply(msg, a.pilot, a.name, now);
    if (out.error) return fail(out.error.replace(/ /g, '_'));
    await this.deliver(out, ws);
  }
  async deliver(out, except) {
    if (out.broadcast) { const m = JSON.stringify(out.broadcast); for (const {ws} of this.sockets()) if (ws !== except) try { ws.send(m); } catch { /* Closed. */ } }
    if (out.push && out.broadcast) await this.push(out.broadcast.from, out.push);
    if (out.alarm) await this.schedule();
  }
  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch { /* Already closed. */ } this.broadcastPresence(); }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  // Timer ends: one alarm for the earliest un-notified end; it pushes to a wingmate who is not connected, then re-arms.
  async schedule() {
    const next = this.q('SELECT MIN(ends_at) AS at FROM timers WHERE notified = 0 AND ends_at > 0')[0]?.at;
    if (next) await this.state.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
  async alarm() {
    const now = Date.now();
    for (const r of this.q('SELECT id, data FROM timers WHERE notified = 0 AND ends_at > 0 AND ends_at <= ?', now)) {
      this.q('UPDATE timers SET notified = 1 WHERE id = ?', r.id);
      const t = JSON.parse(r.data);
      // An end long past (the room slept, or the wingmate was away) is not news.
      if (now - (t.startedAt + t.durationMs) < 3600000) await this.push(t.owner, {kind: 'timer.end', label: t.label, from: ''});
    }
    this.purge(now); await this.schedule();
  }
  // Push to the other pilot's registered devices, only when they have no live socket (the app in the foreground shows it already).
  async push(sender, data) {
    const account = this.env.FCM_SERVICE_ACCOUNT, project = this.env.FCM_PROJECT_ID;
    if (!account || !project || !this.env.DB) return {sent: 0, skipped: true};
    if (this.sockets().some(({a}) => a.pilot && a.pilot !== sender)) return {sent: 0, connected: true};
    let tokens; try { tokens = (await this.env.DB.prepare('SELECT token FROM push_tokens WHERE character_id != ?').bind(sender).all()).results.map(r => r.token); } catch { return {sent: 0}; }
    if (!tokens.length) return {sent: 0};
    let sent = 0;
    try {
      const bearer = await this.accessToken(account);
      for (const token of tokens) {
        const r = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {method: 'POST', headers: {Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json'}, body: JSON.stringify({message: {token, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), android: {priority: 'high'}}}), signal: AbortSignal.timeout(10000)});
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 400 || r.status === 410) await this.env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();
      }
    } catch { /* Push is best effort. */ }
    return {sent};
  }
  async accessToken(raw) {
    if (this.token && this.token.exp > Date.now() + 60000) return this.token.value;
    const account = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const r = await this.fetchImpl(account.token_uri || 'https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await fcmJwt(account)}), signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error('fcm token');
    const j = await r.json();
    this.token = {value: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000};
    return this.token.value;
  }
}
