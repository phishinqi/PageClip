// Fixture recovered from the pre-overwrite session read; regression cases recreated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { b64, hash, seal, open } from '../src/worker.js';

// Execute production SQL and the actual migration, not canned query responses.
class D1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    this.queue = Promise.resolve();
  }
  prepare(sql) {
    const db = this.db;
    return { bind(...args) {
      const statement = db.prepare(sql);
      return {
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
      };
    } };
  }
  batch(statements) {
    const work = this.queue.then(async () => {
      this.db.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        this.db.exec('COMMIT'); return result;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
    this.queue = work.catch(() => {}); return work;
  }
}
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const site = 'https://oauth.publisher.test';
const secret = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const tokenReply = (extra = {}) => ({ access_token: 'google-access-secret', refresh_token: 'google-refresh-secret', token_type: 'Bearer', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.appdata', ...extra });
const userReply = (extra = {}) => ({ sub: 'google-subject-123', email: 'person@example.com', email_verified: true, ...extra });
function fixture() {
  const env = { DB: new D1(), PUBLIC_ORIGIN: site, GOOGLE_CLIENT_ID: 'publisher-web.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'publisher-secret', TOKEN_ENCRYPTION_KEY_ID: 'k1', TOKEN_ENCRYPTION_KEY: secret(), RATE_LIMIT_SALT: secret(), ALLOWED_EXTENSION_ORIGINS: JSON.stringify([origin]) };
  return { env, request(path, options = {}) {
    const h = { Origin: origin, 'CF-Connecting-IP': '192.0.2.1', ...options.headers };
    if (options.body !== undefined) h['Content-Type'] ||= 'application/json';
    return worker.fetch(new Request(`${site}${path}`, { method: options.method || 'POST', headers: h, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }), env);
  } };
}
function mockProvider(handler) {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    // Match workerd rather than Node: workerd rejects redirect:error before network I/O.
    assert.equal(options.redirect, 'manual');
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls);
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}
function normalProvider(url) {
  if (url.endsWith('/token')) return Response.json(tokenReply());
  if (url.endsWith('/userinfo')) return Response.json(userReply());
  if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
  throw new Error('Unexpected provider URL');
}
async function begin(f, account, credential) {
  const verifier = secret();
  const response = await f.request('/v1/start', { body: { challenge: await hash(verifier), ...(account ? { account } : {}) }, headers: credential ? auth(credential) : {} });
  assert.equal(response.status, 200);
  const start = await response.json();
  const authorize = await worker.fetch(new Request(start.authorizeUrl), f.env);
  assert.equal(authorize.status, 302);
  const google = new URL(authorize.headers.get('Location'));
  const cookie = authorize.headers.get('Set-Cookie').split(';')[0];
  assert.match(authorize.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Lax/);
  return { ...start, verifier, credential: secret(), google, cookie };
}
async function finish(f, s, options = {}) {
  return worker.fetch(new Request(`${site}/oauth/callback?state=${s.google.searchParams.get('state')}&code=google-code`, { headers: { Cookie: s.cookie, ...options.headers } }), f.env);
}
const redeem = (f, s, extra = {}) => f.request('/v1/redeem', { body: { id: s.id, verifier: s.verifier, credential: s.credential, ...extra } });
async function linked(f) {
  const s = await begin(f);
  assert.equal((await finish(f, s)).status, 200);
  const response = await redeem(f, s); assert.equal(response.status, 200);
  return { ...s, result: await response.json() };
}
const auth = credential => ({ Authorization: `Bearer ${credential}` });
const token = (f, s, force = false) => f.request('/v1/token', { body: { force }, headers: auth(s.credential) });
const disconnect = (f, s) => f.request('/v1/connection', { method: 'DELETE', headers: auth(s.credential) });
const cancel = (f, s, verifier = s.verifier) => f.request('/v1/cancel', { body: { id: s.id, verifier } });
const rows = (f, table) => f.env.DB.db.prepare(`SELECT * FROM ${table}`).all();
async function cron(f) { let work; await worker.scheduled({}, f.env, { waitUntil(p) { work = p; } }); await work; }
// Top-level tests intentionally sequential: provider fetch is intercepted.
function regression(name, fn) {
  test(name, async t => {
    const f = fixture(), provider = mockProvider(normalProvider);
    t.after(() => { provider.restore(); f.env.DB.db.close(); });
    await fn(f, provider);
  });
}
regression('secret exchange uses server PKCE and client secret; browser cookie/state and callback replay protected', async (f, p) => {
  const s = await begin(f, 'person@example.com');
  assert.equal(s.google.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(s.google.searchParams.get('redirect_uri'), `${site}/oauth/callback`);
  assert.equal((await finish(f, s, { headers: { Cookie: '' } })).status, 400);
  assert.equal(p.calls.length, 0);
  assert.equal((await finish(f, s)).status, 200);
  const exchangeCall = p.calls.find(c => c.url.endsWith('/token'));
  assert.equal(exchangeCall.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const exchange = exchangeCall.options.body;
  assert.equal(exchange.get('client_secret'), f.env.GOOGLE_CLIENT_SECRET);
  assert.equal(await hash(exchange.get('code_verifier')), s.google.searchParams.get('code_challenge'));
  assert.equal((await finish(f, s)).status, 400);
  assert.equal((await worker.fetch(new Request(s.authorizeUrl), f.env)).status, 400);
  const response = await redeem(f, s), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.email, 'person@example.com');
  assert.equal(result.refreshToken, undefined); assert.equal(result.credential, undefined);
  const stored = JSON.stringify(rows(f, 'connections'));
  assert.ok(!stored.includes('google-refresh-secret')); assert.ok(!stored.includes('google-access-secret')); assert.ok(!stored.includes(s.credential));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
regression('callback diagnostics classify safe provider errors without storing response bodies', async f => {
  for (const [response, expected] of [
    [{ error: 'invalid_request', error_description: 'private-provider-details' }, 'provider_invalid_request'],
    [{ error: 'invalid_client', error_description: 'private-provider-details' }, 'provider_configuration'],
    [{ access_token: 'private-access' }, 'provider_token_format'],
  ]) {
    const p = mockProvider(() => Response.json(response, { status: response.error ? 400 : 200 }));
    try {
      const s = await begin(f);
      assert.equal((await finish(f, s)).status, 400);
      assert.equal(rows(f, 'sessions').find(row => row.id === s.id).error_code, expected);
      const persisted = JSON.stringify(rows(f, 'sessions'));
      assert.ok(!persisted.includes('private-provider-details'));
      assert.ok(!persisted.includes('private-access'));
    } finally { p.restore(); }
  }
});
regression('provider redirects are rejected without following or storing redirect response data', async f => {
  const p = mockProvider(() => new Response('sensitive redirect body', { status: 302, headers: { Location: 'https://untrusted.example/collect' } }));
  try {
    const s = await begin(f);
    assert.equal((await finish(f, s)).status, 400);
    assert.equal(p.calls.length, 1);
    assert.equal(rows(f, 'sessions').find(row => row.id === s.id).error_code, 'provider_redirect');
    assert.ok(!JSON.stringify(rows(f, 'sessions')).includes('sensitive redirect body'));
  } finally { p.restore(); }
});
regression('redemption proof precedes mutation; pending and lost-response idempotency; collision isolation', async f => {
  const s = await begin(f);
  assert.equal((await redeem(f, s, { verifier: secret() })).status, 401);
  const pending = await redeem(f, s); assert.equal(pending.status, 409); assert.equal(pending.headers.get('Retry-After'), '2');
  await finish(f, s);
  assert.equal((await redeem(f, s)).status, 200); assert.equal((await redeem(f, s)).status, 200);
  assert.equal((await redeem(f, s, { credential: secret() })).status, 401);
  const other = await begin(f); await finish(f, other);
  assert.equal((await redeem(f, other, { credential: s.credential })).status, 401);
  assert.equal(rows(f, 'sessions').find(r => r.id === other.id).status, 'ready');
  assert.equal((await redeem(f, other)).status, 200);
  assert.equal(rows(f, 'connections').length, 2);
});
regression('concurrent redemption creates exactly one connection for a session', async f => {
  const s = await begin(f); await finish(f, s);
  const responses = await Promise.all([redeem(f, s), redeem(f, s)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal(rows(f, 'connections').length, 1);
});
regression('wrong account, unverified identity, insufficient scopes and provider denial never link', async f => {
  for (const mode of ['account', 'identity', 'scope', 'denial']) {
    const p = mockProvider(url => url.endsWith('/token') ? Response.json(mode === 'denial' ? { error: 'access_denied', secret: 'never-expose' } : tokenReply(mode === 'scope' ? { scope: 'openid email' } : {}), { status: mode === 'denial' ? 400 : 200 }) : Response.json(userReply(mode === 'identity' ? { email_verified: false } : {})));
    try {
      const s = await begin(f, mode === 'account' ? 'other@example.com' : undefined);
      const r = await finish(f, s); assert.equal(r.status, 400); assert.ok(!(await r.text()).includes('never-expose'));
      assert.equal((await redeem(f, s)).status, 403); assert.equal(rows(f, 'connections').length, 0);
    } finally { p.restore(); }
  }
});
regression('AES-GCM randomized IV, authenticated context, tamper rejection and read-old/write-new keys', async f => {
  const cfg = { keyId: 'k1', keys: { k1: f.env.TOKEN_ENCRYPTION_KEY } };
  const a = await seal(cfg, { secret: 1 }, 'one'), b = await seal(cfg, { secret: 1 }, 'one');
  assert.notEqual(a, b); assert.deepEqual(await open(cfg, a, 'one'), { secret: 1 });
  await assert.rejects(open(cfg, a, 'two'));
  const box = JSON.parse(a); box.data = (box.data[0] === 'A' ? 'B' : 'A') + box.data.slice(1);
  await assert.rejects(open(cfg, JSON.stringify(box), 'one'));
  const rotated = { keyId: 'k2', keys: { ...cfg.keys, k2: secret() } };
  assert.deepEqual(await open(rotated, a, 'one'), { secret: 1 });
  assert.equal(JSON.parse(await seal(rotated, {}, 'one')).kid, 'k2');
});
regression('access cache and forced refresh preserve omitted refresh token and accept email alias', async (f, p) => {
  const s = await linked(f), calls = p.calls.length;
  assert.equal((await token(f, s)).status, 200); assert.equal(p.calls.length, calls);
  const next = mockProvider(url => url.endsWith('/token') ? Response.json(tokenReply({ access_token: 'new-access', refresh_token: undefined, scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.appdata' })) : normalProvider(url));
  try { const r = await token(f, s, true); assert.equal(r.status, 200); assert.equal((await r.json()).accessToken, 'new-access'); }
  finally { next.restore(); }
  const row = rows(f, 'connections')[0];
  const plain = await open({ keys: { k1: f.env.TOKEN_ENCRYPTION_KEY } }, row.token_cipher, `connection:${row.credential_hash}`);
  assert.equal(plain.refreshToken, 'google-refresh-secret');
});
regression('refresh lease prevents competing refresh; invalid grant blocks but never requests revoke', async f => {
  const s = await linked(f);
  f.env.DB.db.exec(`UPDATE connections SET lease_until=${Date.now() + 60000}`);
  assert.equal((await token(f, s, true)).status, 503);
  f.env.DB.db.exec('UPDATE connections SET lease_until=0');
  const p = mockProvider(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
  try { assert.equal((await token(f, s, true)).status, 401); await cron(f); assert.equal(p.calls.length, 1); }
  finally { p.restore(); }
  const row = rows(f, 'connections')[0]; assert.equal(row.blocked, 1); assert.equal(row.revoking, 0);
  assert.equal((await token(f, s)).status, 401);
});
regression('refresh identity mismatch permanently blocks the credential without revoking the grant', async f => {
  const s = await linked(f), p = mockProvider(url => url.endsWith('/userinfo') ? Response.json(userReply({ sub: 'attacker' })) : normalProvider(url));
  try { assert.equal((await token(f, s, true)).status, 403); }
  finally { p.restore(); }
  assert.equal(rows(f, 'connections')[0].blocked, 1); assert.equal(rows(f, 'connections')[0].revoking, 0);
});
regression('failed grant revocation retains encrypted tokens and denies all devices; cron retries account-wide delete', async f => {
  const a = await linked(f), b = await linked(f);
  const p = mockProvider(() => Response.json({ error: 'server_error' }, { status: 500 }));
  try { assert.equal((await disconnect(f, a)).status, 503); assert.equal((await token(f, b)).status, 401); }
  finally { p.restore(); }
  assert.equal(rows(f, 'connections').length, 2); assert.ok(rows(f, 'connections').every(r => r.revoking === 1 && r.token_cipher));
  await cron(f); assert.equal(rows(f, 'connections').length, 0); assert.equal(rows(f, 'sessions').length, 0); assert.equal(rows(f, 'grant_revocations').length, 0);
});
regression('arbitrary revoke 400 is retryable; only invalid_token is terminal success', async f => {
  const s = await linked(f);
  for (const error of ['invalid_request', 'invalid_token']) {
    const p = mockProvider(() => Response.json({ error }, { status: 400 }));
    try { assert.equal((await disconnect(f, s)).status, error === 'invalid_token' ? 204 : 503); }
    finally { p.restore(); }
  }
  assert.equal(rows(f, 'connections').length, 0);
});
regression('cancel validates proof, removes pending session, revokes ready tokens, and retries failures', async f => {
  const pending = await begin(f);
  assert.equal((await cancel(f, pending, secret())).status, 401);
  assert.equal((await cancel(f, pending)).status, 204); assert.equal((await finish(f, pending)).status, 400);
  const ready = await begin(f); await finish(f, ready);
  const p = mockProvider(() => Response.json({ error: 'unavailable' }, { status: 500 }));
  try { assert.equal((await cancel(f, ready)).status, 503); assert.equal((await redeem(f, ready)).status, 401); }
  finally { p.restore(); }
  assert.equal(rows(f, 'sessions')[0].cancel_requested, 1);
  await cron(f); assert.equal(rows(f, 'sessions').length, 0);
  const s = await linked(f); assert.equal((await cancel(f, s)).status, 409);
});
regression('reauthorization binds verified account, replaces old credential transactionally without grant revoke', async (f, p) => {
  const old = await linked(f), s = await begin(f, undefined, old.credential);
  assert.equal((await finish(f, s)).status, 200); assert.equal((await redeem(f, s)).status, 200);
  assert.equal(rows(f, 'connections').length, 1); assert.equal((await token(f, old)).status, 401); assert.equal((await token(f, s)).status, 200);
  assert.ok(!p.calls.some(c => c.url.endsWith('/revoke')));
  const r = await f.request('/v1/start', { headers: auth(s.credential), body: { challenge: await hash(secret()), account: 'other@example.com' } });
  assert.equal(r.status, 403);
});
regression('CORS exact allowlist, missing Origin rejected, constrained preflight and rate limits', async f => {
  for (const value of ['', 'https://evil.test', `${origin}.evil`]) {
    const r = await f.request('/v1/start', { headers: { Origin: value }, body: { challenge: await hash(secret()) } });
    assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  }
  const options = { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } };
  assert.equal((await f.request('/v1/start', options)).status, 204);
  assert.equal((await f.request('/v1/start', { ...options, headers: { ...options.headers, 'Access-Control-Request-Headers': 'x-evil' } })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/v1/start', { body: { challenge: await hash(secret()) } })).status, 200);
  const limited = await f.request('/v1/start', { body: { challenge: await hash(secret()) } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
});
regression('strict request types, size, field, origin and HTTPS configuration boundaries', async f => {
  assert.equal((await f.request('/v1/start', { body: { challenge: 'bad' } })).status, 400);
  assert.equal((await f.request('/v1/start', { body: { challenge: await hash(secret()), extra: 1 } })).status, 400);
  assert.equal((await f.request('/v1/start', { body: { challenge: 'x'.repeat(3000) } })).status, 413);
  assert.equal((await f.request('/v1/start?token=secret', { body: {} })).status, 400);
  assert.equal((await f.request('/v1/token', { body: {} })).status, 401);
  assert.equal((await f.request('/introspect')).status, 404);
  f.env.PUBLIC_ORIGIN = 'http://oauth.publisher.test';
  assert.equal((await f.request('/v1/start', { body: {} })).status, 503);
});
regression('scheduled expiry deletes sensitive transient sessions and expired rate buckets without revoking grants', async (f, p) => {
  const s = await begin(f); await finish(f, s);
  f.env.DB.db.exec('UPDATE sessions SET expires_at=0; UPDATE rate_limits SET expires_at=0');
  await cron(f); assert.equal(rows(f, 'sessions').length, 0); assert.equal(rows(f, 'rate_limits').length, 0);
  assert.ok(!p.calls.some(c => c.url.endsWith('/revoke')));
});
