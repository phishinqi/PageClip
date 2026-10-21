// No logging: provider responses and all secrets stay out of errors/logs.
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.appdata'];
const TTL = 10 * 60_000;
const LEASE = 60_000; // Longer than all three bounded upstream calls together.
const encoder = new TextEncoder();
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{32}$/;

class Fault extends Error {
  constructor(status, code, kind = 'auth', retryAfter) {
    super(code);
    Object.assign(this, { status, code, kind, retryAfter });
  }
}
const fail = (status, code, kind, retryAfter) => { throw new Fault(status, code, kind, retryAfter); };
export function b64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
const random = (length = 32) => b64(crypto.getRandomValues(new Uint8Array(length)));
export async function hash(value) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
function opaque(value) {
  return typeof value === 'string' && OPAQUE.test(value) && b64(unb64(value)) === value;
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function config(env) {
  let origin, origins, old;
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.PUBLIC_ORIGIN || url.hostname.endsWith('.example') || url.hostname === 'example.com') throw 0;
    origin = url.origin;
    origins = JSON.parse(env.ALLOWED_EXTENSION_ORIGINS);
    if (!Array.isArray(origins) || !origins.length || !origins.every(o => typeof o === 'string' && /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-zA-Z0-9-]{16,64})$/.test(o))) throw 0;
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 32) throw 0;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(env.TOKEN_ENCRYPTION_KEY_ID)) throw 0;
    old = JSON.parse(env.TOKEN_ENCRYPTION_PREVIOUS_KEYS || '{}');
    if (!old || typeof old !== 'object' || Array.isArray(old)) throw 0;
    for (const value of [env.TOKEN_ENCRYPTION_KEY, ...Object.values(old)]) if (typeof value !== 'string' || unb64(value).length !== 32) throw 0;
  } catch { fail(503, 'configuration_unavailable', 'retry', 60_000); }
  return { origin, origins, keys: { ...old, [env.TOKEN_ENCRYPTION_KEY_ID]: env.TOKEN_ENCRYPTION_KEY }, keyId: env.TOKEN_ENCRYPTION_KEY_ID };
}
export async function seal(cfg, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', unb64(cfg.keys[cfg.keyId]), 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`pageclip:v1:${context}`) }, key, encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, kid: cfg.keyId, iv: b64(iv), data: b64(new Uint8Array(ciphertext)) });
}
export async function open(cfg, value, context) {
  const box = JSON.parse(value);
  if (box.v !== 1 || !Object.hasOwn(cfg.keys, box.kid)) throw new Error('encryption_unavailable');
  const key = await crypto.subtle.importKey('raw', unb64(cfg.keys[box.kid]), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: encoder.encode(`pageclip:v1:${context}`) }, key, unb64(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const one = (env, sql, ...args) => stmt(env, sql, ...args).first();
const run = (env, sql, ...args) => stmt(env, sql, ...args).run();
const changed = result => result.meta.changes > 0;
const headers = () => new Headers({
  'Cache-Control': 'no-store', 'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Resource-Policy': 'same-origin',
});
function json(value, status = 200) {
  const h = headers(); h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers: h });
}
function completion(ok) {
  const h = headers(); h.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(`<!doctype html><meta charset="utf-8"><title>PageClip</title><p>${ok ? 'Authorization complete. Please return to PageClip.' : 'Authorization could not be completed. Please return to PageClip and try again.'}</p>`, { status: ok ? 200 : 400, headers: h });
}
async function body(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) fail(415, 'json_required', 'permission');
  if (Number(request.headers.get('content-length')) > 2048) fail(413, 'body_too_large', 'permission');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_request', 'permission');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) { await reader.cancel(); fail(413, 'body_too_large', 'permission'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
    return parsed;
  } catch (error) { if (error instanceof Fault) throw error; fail(400, 'invalid_request', 'permission'); }
}
function fields(value, allowed) { if (Object.keys(value).some(k => !allowed.includes(k))) fail(400, 'invalid_request', 'permission'); }
async function rate(request, env, group, limit) {
  const now = Date.now(), window = Math.floor(now / 60_000);
  // CF-Connecting-IP is set by Cloudflare, not taken from forwarded user headers.
  const ip = request.headers.get('CF-Connecting-IP') || 'local-unknown';
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.RATE_LIMIT_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bucket = b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${group}:${window}:${ip}`))));
  if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: bucket })).success) fail(429, 'rate_limited', 'retry', 60_000);
  const row = await one(env, `INSERT INTO rate_limits(bucket,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`, bucket, (window + 2) * 60_000);
  if (row.count > limit) fail(429, 'rate_limited', 'retry', 60_000);
}
async function provider(url, options) {
  try {
    // Timeout covers response body, not just receipt of headers; cap provider bodies too.
    return await Promise.race([
      (async () => {
        // workerd supports manual/follow, not redirect:error. Never follow a provider redirect.
        const res = await fetch(url, { ...options, redirect: 'manual', signal: options.signal });
        if (res.status >= 300 && res.status < 400) fail(503, 'provider_redirect', 'retry', 60_000);
        const reader = res.body?.getReader(); const decoder = new TextDecoder(); let data = '', size = 0;
        if (reader) while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > 65_536) { await reader.cancel(); throw 0; }
          data += decoder.decode(value, { stream: true });
        }
        let value; try { value = JSON.parse(data); } catch { value = {}; }
        return { ok: res.ok, status: res.status, value };
      })(),
      new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })),
    ]);
  } catch (error) {
    if (error instanceof Fault) throw error;
    fail(503, error?.name === 'TimeoutError' || error?.message === 'timeout' ? 'provider_timeout' : 'provider_transport', 'retry', 5_000);
  }
}
function upstream(url, options = {}) { return provider(url, { ...options, signal: AbortSignal.timeout(8_000) }); }
function tokenFailure(response) {
  const code = response.value?.error;
  if (code === 'invalid_grant' || code === 'invalid_token') fail(401, 'reauthorization_required');
  if (code === 'invalid_client' || code === 'unauthorized_client') fail(503, 'provider_configuration', 'retry', 60_000);
  if (code === 'access_denied' || code === 'insufficient_scope') fail(403, 'permission_required', 'permission');
  if (code === 'invalid_request') fail(503, 'provider_invalid_request', 'retry', 60_000);
  if (code === 'invalid_scope') fail(503, 'provider_invalid_scope', 'retry', 60_000);
  fail(503, 'provider_unavailable', 'retry', 5_000);
}
function scopesValid(scope) {
  if (typeof scope !== 'string') return false;
  const scopes = new Set(scope.split(/\s+/));
  return scopes.has('openid') && (scopes.has('email') || scopes.has('https://www.googleapis.com/auth/userinfo.email')) && scopes.has(SCOPES[2]);
}
function tokenData(value, previous) {
  if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 16384 ||
      typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' ||
      !Number.isFinite(value.expires_in) || value.expires_in < 1 || value.expires_in > 86400) fail(503, 'provider_token_format', 'retry', 5_000);
  const scope = value.scope ?? previous?.scope;
  if (!scopesValid(scope)) fail(403, 'permission_required', 'permission');
  const refresh = value.refresh_token ?? previous?.refreshToken;
  if (typeof refresh !== 'string' || !refresh || refresh.length > 16384) fail(401, 'reauthorization_required');
  return { accessToken: value.access_token, refreshToken: refresh, scope, expiresAt: Date.now() + value.expires_in * 1000 };
}
async function identity(accessToken) {
  const res = await upstream(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { if (res.status === 401) fail(401, 'reauthorization_required'); if (res.status === 403) fail(403, 'permission_required', 'permission'); fail(503, 'provider_unavailable', 'retry', 5_000); }
  const user = res.value;
  if (typeof user.sub !== 'string' || !user.sub || user.sub.length > 255 || user.email_verified !== true ||
      typeof user.email !== 'string' || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) fail(403, 'identity_unverified', 'permission');
  return { subject: user.sub, email: user.email.toLowerCase() };
}
function publicToken(row, tokens) { return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, email: row.email, subject: row.subject }; }
async function start(request, env, cfg) {
  const input = await body(request); fields(input, ['challenge', 'account']);
  if (!opaque(input.challenge) || (input.account !== undefined && (typeof input.account !== 'string' || input.account.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.account)))) fail(400, 'invalid_request', 'permission');
  let previous;
  if (request.headers.has('Authorization')) {
    previous = await one(env, 'SELECT * FROM connections WHERE credential_hash=?', await authenticate(request));
    if (!previous || previous.revoking) fail(401, 'invalid_credential');
    if (input.account && input.account.toLowerCase() !== previous.email) fail(403, 'account_mismatch', 'permission');
  }
  const id = random(24), state = random(), verifier = random(), now = Date.now();
  await run(env, `INSERT INTO sessions(id,challenge,expected_email,expected_subject,previous_credential_hash,state_hash,status,pkce_cipher,expires_at,created_at)
    VALUES (?,?,?,?,?,?,'created',?,?,?)`, id, input.challenge, previous?.email || input.account?.toLowerCase() || null, previous?.subject || null, previous?.credential_hash || null, await hash(state), await seal(cfg, { state, verifier }, `session:${id}:pkce`), now + TTL, now);
  return json({ id, authorizeUrl: `${cfg.origin}/authorize?id=${id}`, expiresAt: now + TTL });
}
async function authorize(url, env, cfg) {
  const id = url.searchParams.get('id');
  if (!ID.test(id || '') || url.searchParams.size !== 1) return completion(false);
  const row = await one(env, 'SELECT * FROM sessions WHERE id=? AND expires_at>? AND status=\'created\'', id, Date.now());
  if (!row) return completion(false);
  const proof = random();
  const claimed = await run(env, `UPDATE sessions SET status='authorizing',browser_hash=? WHERE id=? AND status='created' AND cancel_requested=0 AND expires_at>?`, await hash(proof), id, Date.now());
  if (!changed(claimed)) return completion(false);
  const pkce = await open(cfg, row.pkce_cipher, `session:${id}:pkce`);
  const target = new URL(GOOGLE_AUTH);
  target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${cfg.origin}/oauth/callback`, response_type: 'code', scope: SCOPES.join(' '), state: pkce.state, code_challenge: await hash(pkce.verifier), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', ...(row.expected_email ? { login_hint: row.expected_email } : {}) }).toString();
  const h = headers(); h.set('Location', target.toString());
  h.set('Set-Cookie', `__Host-pageclip-${id}=${proof}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  return new Response(null, { status: 302, headers: h });
}
async function callback(request, url, env, cfg) {
  const state = url.searchParams.get('state');
  if (!opaque(state) || url.searchParams.getAll('state').length !== 1) return completion(false);
  const row = await one(env, 'SELECT * FROM sessions WHERE state_hash=? AND expires_at>?', await hash(state), Date.now());
  if (!row || row.status !== 'authorizing') return completion(false);
  const cookies = (request.headers.get('Cookie') || '').split(';').map(s => s.trim());
  const prefix = `__Host-pageclip-${row.id}=`;
  const proof = cookies.find(s => s.startsWith(prefix))?.slice(prefix.length);
  if (!opaque(proof) || !same(await hash(proof), row.browser_hash)) return completion(false);
  const claim = await run(env, `UPDATE sessions SET status='processing' WHERE id=? AND status='authorizing' AND cancel_requested=0 AND expires_at>?`, row.id, Date.now());
  if (!changed(claim)) return completion(false);
  let ok = false;
  try {
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || typeof code !== 'string' || !code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) fail(403, 'authorization_denied', 'permission');
    const pkce = await open(cfg, row.pkce_cipher, `session:${row.id}:pkce`);
    const res = await upstream(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${cfg.origin}/oauth/callback`, code_verifier: pkce.verifier }) });
    if (!res.ok) tokenFailure(res);
    const tokens = tokenData(res.value);
    // Persist encrypted tokens before the next network operation, so cleanup/revocation can recover them.
    await run(env, 'UPDATE sessions SET token_cipher=?,pkce_cipher=NULL WHERE id=? AND status=\'processing\'', await seal(cfg, tokens, `session:${row.id}:tokens`), row.id);
    const user = await identity(tokens.accessToken);
    if ((row.expected_email && !same(row.expected_email, user.email)) || (row.expected_subject && !same(row.expected_subject, user.subject))) fail(403, 'account_mismatch', 'permission');
    const result = await run(env, `UPDATE sessions SET status='ready',subject=?,email=?,access_expires_at=? WHERE id=? AND status='processing' AND cancel_requested=0 AND expires_at>?
      AND NOT EXISTS (SELECT 1 FROM grant_revocations WHERE subject=?)`, user.subject, user.email, tokens.expiresAt, row.id, Date.now(), user.subject);
    ok = changed(result);
    if (!ok) await run(env, `UPDATE sessions SET status='failed',error_code='authorization_cancelled',pkce_cipher=NULL WHERE id=? AND status='processing'`, row.id);
  } catch (error) {
    const safe = error instanceof Fault ? error.code : 'authorization_failed';
    await run(env, `UPDATE sessions SET status='failed',error_code=?,pkce_cipher=NULL WHERE id=? AND status='processing'`, safe, row.id);
  }
  const response = completion(ok);
  response.headers.set('Set-Cookie', `${prefix}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return response;
}
async function redeem(request, env, cfg) {
  const input = await body(request); fields(input, ['id', 'verifier', 'credential']);
  if (!ID.test(input.id || '') || !opaque(input.verifier) || !opaque(input.credential)) fail(400, 'invalid_request', 'permission');
  const row = await one(env, 'SELECT * FROM sessions WHERE id=? AND expires_at>?', input.id, Date.now());
  // Verify proof BEFORE any state mutation or pending/error disclosure.
  if (!row || !same(row.challenge, await hash(input.verifier))) fail(401, 'invalid_redemption');
  if (row.cancel_requested) fail(401, 'authorization_cancelled');
  if (['created', 'authorizing', 'processing'].includes(row.status)) fail(409, 'pending', 'retry', 2_000);
  if (row.status === 'failed') fail(403, row.error_code || 'authorization_failed', 'permission');
  const credentialHash = await hash(input.credential);
  if (row.status === 'redeemed') {
    if (!same(row.credential_hash, credentialHash)) fail(401, 'invalid_redemption');
    // Only the original proof+credential may recover a lost response; never create a second connection.
    return json(await connectionToken(env, cfg, credentialHash, false));
  }
  if (row.status !== 'ready') fail(401, 'invalid_redemption');
  const tokens = await open(cfg, row.token_cipher, `session:${row.id}:tokens`);
  const encrypted = await seal(cfg, tokens, `connection:${credentialHash}`);
  // D1 batch executes transactionally. INSERT SELECT performs the state/challenge CAS;
  // UPDATE only follows a matching successful insert (no consume-before-proof race).
  await env.DB.batch([
    stmt(env, `INSERT INTO connections(credential_hash,source_session,subject,email,token_cipher,access_expires_at,created_at)
      SELECT ?,id,subject,email,?,?,? FROM sessions WHERE id=? AND status='ready' AND cancel_requested=0 AND challenge=? AND expires_at>?
      AND NOT EXISTS (SELECT 1 FROM grant_revocations WHERE subject=sessions.subject)
      AND (previous_credential_hash IS NULL OR EXISTS (SELECT 1 FROM connections WHERE credential_hash=sessions.previous_credential_hash AND subject=sessions.subject AND email=sessions.email AND revoking=0))
      ON CONFLICT DO NOTHING`, credentialHash, encrypted, tokens.expiresAt, Date.now(), row.id, row.challenge, Date.now()),
    stmt(env, `DELETE FROM sessions WHERE credential_hash=? AND id!=? AND EXISTS (SELECT 1 FROM connections WHERE source_session=? AND credential_hash=?)`, row.previous_credential_hash, row.id, row.id, credentialHash),
    stmt(env, `DELETE FROM connections WHERE credential_hash=? AND subject=? AND email=? AND EXISTS (SELECT 1 FROM connections WHERE source_session=? AND credential_hash=?)`, row.previous_credential_hash, row.subject, row.email, row.id, credentialHash),
    stmt(env, `UPDATE sessions SET status='redeemed',credential_hash=?,token_cipher=NULL,pkce_cipher=NULL,browser_hash=NULL,expected_email=NULL,expected_subject=NULL,previous_credential_hash=NULL,subject=NULL,email=NULL
      WHERE id=? AND status='ready' AND EXISTS (SELECT 1 FROM connections WHERE source_session=? AND credential_hash=?)`, credentialHash, row.id, row.id, credentialHash),
  ]);
  const result = await one(env, 'SELECT status,credential_hash FROM sessions WHERE id=?', row.id);
  if (result?.status !== 'redeemed' || !same(result.credential_hash, credentialHash)) fail(401, 'invalid_redemption');
  return json(await connectionToken(env, cfg, credentialHash, false));
}
async function authenticate(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') || '');
  if (!match || !opaque(match[1])) fail(401, 'invalid_credential');
  return hash(match[1]);
}
async function connectionToken(env, cfg, credentialHash, force) {
  let row = await one(env, 'SELECT * FROM connections WHERE credential_hash=?', credentialHash);
  if (!row) fail(401, 'invalid_credential');
  if (row.revoking) fail(401, 'connection_revoking');
  if (row.blocked) fail(401, 'reauthorization_required');
  if (row.lease_until > Date.now()) fail(503, 'refresh_busy', 'retry', 2_000);
  let tokens = await open(cfg, row.token_cipher, `connection:${credentialHash}`);
  if (!force && row.access_expires_at > Date.now() + 60_000) return publicToken(row, tokens);
  const owner = random();
  const lock = await run(env, `UPDATE connections SET lease_owner=?,lease_until=? WHERE credential_hash=? AND version=? AND revoking=0 AND blocked=0 AND lease_until<=?`, owner, Date.now() + LEASE, credentialHash, row.version, Date.now());
  if (!changed(lock)) fail(503, 'refresh_busy', 'retry', 2_000);
  try {
    const res = await upstream(GOOGLE_TOKEN, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }) });
    if (!res.ok) tokenFailure(res);
    tokens = tokenData(res.value, tokens);
    // Keep rotation even if identity verification has a transient failure. A zero
    // access_expires_at prevents returning this not-yet-verified access token.
    const saved = await run(env, `UPDATE connections SET token_cipher=?,access_expires_at=0 WHERE credential_hash=? AND lease_owner=?`, await seal(cfg, tokens, `connection:${credentialHash}`), credentialHash, owner);
    if (!changed(saved)) fail(401, 'connection_revoking');
    const user = await identity(tokens.accessToken);
    if (!same(user.subject, row.subject) || !same(user.email, row.email)) fail(403, 'account_mismatch', 'permission');
    const done = await run(env, `UPDATE connections SET access_expires_at=?,version=version+1,lease_owner=NULL,lease_until=0 WHERE credential_hash=? AND lease_owner=? AND revoking=0`, tokens.expiresAt, credentialHash, owner);
    if (!changed(done)) fail(401, 'connection_revoking');
    return publicToken(row, tokens);
  } catch (error) {
    // Permanent auth/identity errors deny access but preserve encrypted material
    // for explicit DELETE and revoke. Transient errors permit refresh retry.
    if (error instanceof Fault && (error.kind === 'auth' || error.kind === 'permission')) {
      await run(env, 'UPDATE connections SET blocked=1 WHERE credential_hash=? AND lease_owner=?', credentialHash, owner);
    }
    throw error;
  } finally {
    await run(env, 'UPDATE connections SET lease_owner=NULL,lease_until=0 WHERE credential_hash=? AND lease_owner=?', credentialHash, owner);
  }
}
async function cancelSession(env, cfg, id, challenge) {
  let row = await one(env, 'SELECT * FROM sessions WHERE id=?', id);
  if (!row || !same(row.challenge, challenge)) fail(401, 'invalid_redemption');
  if (row.status === 'redeemed') fail(409, 'already_redeemed', 'permission');
  await run(env, `UPDATE sessions SET cancel_requested=1 WHERE id=? AND status!='redeemed'`, id);
  row = await one(env, 'SELECT * FROM sessions WHERE id=?', id);
  if (row.status === 'redeemed') fail(409, 'already_redeemed', 'permission');
  if (row.status === 'processing' && row.expires_at + LEASE > Date.now()) fail(503, 'cancellation_pending', 'retry', 2_000);
  const owner = random();
  if (!changed(await run(env, `UPDATE sessions SET cancel_lease_owner=?,cancel_lease_until=? WHERE id=? AND cancel_requested=1 AND cancel_lease_until<=?`, owner, Date.now() + LEASE, id, Date.now()))) fail(503, 'cancellation_pending', 'retry', 2_000);
  try {
    row = await one(env, 'SELECT * FROM sessions WHERE id=?', id);
    if (row.token_cipher) {
      const tokens = await open(cfg, row.token_cipher, `session:${id}:tokens`);
      await revokeToken(tokens.refreshToken);
    }
    await run(env, 'DELETE FROM sessions WHERE id=? AND cancel_lease_owner=?', id, owner);
  } finally {
    await run(env, 'UPDATE sessions SET cancel_lease_owner=NULL,cancel_lease_until=0 WHERE id=? AND cancel_lease_owner=?', id, owner);
  }
}
async function cancel(request, env, cfg) {
  const input = await body(request); fields(input, ['id', 'verifier']);
  if (!ID.test(input.id || '') || !opaque(input.verifier)) fail(400, 'invalid_request', 'permission');
  await cancelSession(env, cfg, input.id, await hash(input.verifier));
  return new Response(null, { status: 204, headers: headers() });
}
async function revokeToken(token) {
  const res = await upstream(GOOGLE_REVOKE, { method: 'POST', body: new URLSearchParams({ token }) });
  if (res.ok) return;
  // Only this exact documented terminal response means the token is already invalid.
  if (res.status === 400 && res.value?.error === 'invalid_token') return;
  fail(503, 'revocation_pending', 'retry', 5_000);
}
async function revokeAccount(env, cfg, row) {
  row = await one(env, 'SELECT * FROM connections WHERE credential_hash=?', row.credential_hash);
  if (!row) return;
  const owner = random();
  await env.DB.batch([
    stmt(env, 'UPDATE connections SET revoking=1 WHERE subject=?', row.subject),
    stmt(env, `INSERT INTO grant_revocations(subject,lease_owner,lease_until) VALUES (?,?,0) ON CONFLICT(subject) DO NOTHING`, row.subject, owner),
  ]);
  // Account-level lock plus all per-connection refresh leases serializes Google
  // grant-wide revocation against token rotation across every known device.
  const lock = await run(env, `UPDATE grant_revocations SET lease_owner=?,lease_until=? WHERE subject=? AND lease_until<=?
    AND NOT EXISTS (SELECT 1 FROM connections WHERE subject=? AND lease_until>?)`, owner, Date.now() + LEASE, row.subject, Date.now(), row.subject, Date.now());
  if (!changed(lock)) fail(503, 'revocation_pending', 'retry', 2_000);
  try {
    row = await one(env, 'SELECT * FROM connections WHERE credential_hash=?', row.credential_hash);
    if (!row) {
      await run(env, 'DELETE FROM grant_revocations WHERE lease_owner=?', owner);
      return;
    }
    if (!row.provider_revoked) {
      const tokens = await open(cfg, row.token_cipher, `connection:${row.credential_hash}`);
      await revokeToken(tokens.refreshToken);
      await run(env, 'UPDATE connections SET provider_revoked=1 WHERE subject=?', row.subject);
    }
    await env.DB.batch([
      stmt(env, `DELETE FROM sessions WHERE subject=? OR expected_subject=? OR email=? OR expected_email=?
        OR credential_hash IN (SELECT credential_hash FROM connections WHERE subject=?)
        OR previous_credential_hash IN (SELECT credential_hash FROM connections WHERE subject=?)
        OR id IN (SELECT source_session FROM connections WHERE subject=?)`, row.subject, row.subject, row.email, row.email, row.subject, row.subject, row.subject),
      stmt(env, 'DELETE FROM connections WHERE subject=?', row.subject),
      stmt(env, 'DELETE FROM grant_revocations WHERE subject=? AND lease_owner=?', row.subject, owner),
    ]);
  } finally {
    await run(env, 'UPDATE grant_revocations SET lease_until=0 WHERE subject=? AND lease_owner=?', row.subject, owner);
  }
}
async function disconnect(request, env, cfg) {
  if (request.body) { const input = await body(request); fields(input, []); }
  const credentialHash = await authenticate(request);
  const row = await one(env, 'SELECT * FROM connections WHERE credential_hash=?', credentialHash);
  if (!row) fail(401, 'invalid_credential');
  await revokeAccount(env, cfg, row);
  return new Response(null, { status: 204, headers: headers() });
}
async function dispatch(request, env, cfg) {
  const url = new URL(request.url);
  if (url.origin !== cfg.origin || url.protocol !== 'https:') fail(400, 'invalid_origin', 'permission');
  const path = url.pathname;
  if (path === '/authorize' && request.method === 'GET') { await rate(request, env, 'navigate', 30); return authorize(url, env, cfg); }
  if (path === '/oauth/callback' && request.method === 'GET') { await rate(request, env, 'callback', 30); return callback(request, url, env, cfg); }
  const methods = { '/v1/start': 'POST', '/v1/redeem': 'POST', '/v1/cancel': 'POST', '/v1/token': 'POST', '/v1/connection': 'DELETE' };
  if (!Object.hasOwn(methods, path)) fail(404, 'not_found', 'permission');
  if (!cfg.origins.includes(request.headers.get('Origin'))) fail(403, 'origin_denied', 'permission');
  if (url.search) fail(400, 'query_not_allowed', 'permission');
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Access-Control-Request-Method') !== methods[path]) fail(405, 'method_not_allowed', 'permission');
    const requested = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (requested.some(h => !['authorization', 'content-type'].includes(h))) fail(403, 'headers_denied', 'permission');
    return new Response(null, { status: 204, headers: headers() });
  }
  if (request.method !== methods[path]) fail(405, 'method_not_allowed', 'permission');
  await rate(request, env, path, path === '/v1/start' ? 10 : 120);
  if (path === '/v1/start') return start(request, env, cfg);
  if (path === '/v1/redeem') return redeem(request, env, cfg);
  if (path === '/v1/cancel') return cancel(request, env, cfg);
  if (path === '/v1/connection') return disconnect(request, env, cfg);
  const credentialHash = await authenticate(request);
  const input = await body(request); fields(input, ['force']);
  if (input.force !== undefined && typeof input.force !== 'boolean') fail(400, 'invalid_request', 'permission');
  return json(await connectionToken(env, cfg, credentialHash, input.force === true));
}
async function cleanup(env) {
  const cfg = config(env), now = Date.now();
  // Never revoke unredeemed session grants here: Google revocation is grant-wide
  // and could disconnect an existing device. Delete these encrypted transients.
  await env.DB.batch([
    stmt(env, 'DELETE FROM sessions WHERE expires_at<=? AND cancel_requested=0', now),
    stmt(env, 'DELETE FROM rate_limits WHERE expires_at<=?', now),
  ]);
  const cancelled = await stmt(env, 'SELECT id,challenge FROM sessions WHERE cancel_requested=1 AND cancel_lease_until<=? LIMIT 10', now).all();
  for (const row of cancelled.results) {
    try { await cancelSession(env, cfg, row.id, row.challenge); } catch { /* Retain encrypted cancellation material for a later retry. */ }
  }
  // Best-effort retry of previously requested revocations, bounded per cron tick.
  const pending = await stmt(env, 'SELECT * FROM connections WHERE revoking=1 AND lease_until<=? LIMIT 10', now).all();
  for (const row of pending.results) {
    try { await revokeAccount(env, cfg, row); }
    catch { /* Retain encrypted tokens and deny access until a later retry. */ }
  }
}
export default {
  async fetch(request, env) {
    let cfg, response;
    try { cfg = config(env); response = await dispatch(request, env, cfg); }
    catch (error) {
      const fault = error instanceof Fault ? error : new Fault(503, 'service_unavailable', 'retry', 5_000);
      response = json({ error: fault.code, kind: fault.kind, ...(fault.retryAfter ? { retryAfter: fault.retryAfter } : {}) }, fault.status);
      if (fault.retryAfter) response.headers.set('Retry-After', String(Math.ceil(fault.retryAfter / 1000)));
      if (fault.status === 401) response.headers.set('WWW-Authenticate', 'Bearer');
    }
    const origin = request.headers.get('Origin');
    if (cfg?.origins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    return response;
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env)); },
};
