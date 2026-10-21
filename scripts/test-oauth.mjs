import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/google-auth.js', import.meta.url), 'utf8');
const executable = source.replace(/^import[^;]+;\s*/gm, '').replace(/^export\s*\{[^}]+\}\s*from[^;]+;\s*/gm, '').replace(/^export\s+/gm, '')
  + '\n globalThis.__authTest = { getToken, clearToken, getAuthenticatedAccount, authenticationStatus, disconnectAuthentication, createSyncSession };';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function loadAuth({ native, brave = false, brands = [], userAgent = '', includeNative = true, storageState = {}, userInfo, boundAccount, fetchHandler, abortSignal = AbortSignal } = {}) {
  const calls = { native: [], removed: [], web: [], fetch: [], profile: 0, storage: [] };
  const identity = {
    async getAuthToken(options) {
      calls.native.push(options);
      return native ? native(options, calls.native.length) : { token: 'native-token' };
    },
    async removeCachedAuthToken(details) { calls.removed.push(details.token); },
    async clearAllCachedAuthTokens() { calls.clearAll = (calls.clearAll || 0) + 1; },
    async getProfileUserInfo() { calls.profile += 1; return { email: 'wrong-browser-profile@example.com' }; },
    async launchWebAuthFlow(details) { calls.web.push(details); throw new Error('Web OAuth must never run'); },
    getRedirectURL() { throw new Error('Web OAuth redirects must never run'); },
  };
  if (!includeNative) delete identity.getAuthToken;
  const context = {
    workerAuthConfigured: () => false,
    pkceConfiguration: async () => null,
    getPkceToken: async () => { throw Object.assign(new Error('Desktop client required'), { kind: 'auth', code: 'native_unavailable', name: 'GoogleAuthError' }); },
    clearPkceToken: async () => {}, disconnectPkce: async () => {},
    chrome: { identity, storage: { local: {
      async setAccessLevel(options) { calls.storage.push(['access', options.accessLevel]); },
      async get(keys) {
        calls.storage.push(['get', keys]);
        if (keys == null) return { ...storageState };
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storageState[key]]));
      },
      async set(values) { calls.storage.push(['set', values]); Object.assign(storageState, values); },
      async remove(keys) { calls.storage.push(['remove', keys]); for (const key of [keys].flat()) delete storageState[key]; },
    } }, runtime: { id: 'test-extension' } },
    navigator: { userAgent, userAgentData: { brands }, ...(brave ? { brave: { async isBrave() { return true; } } } : {}) },
    loadData: async () => ({ _sync: { account: boundAccount }, settings: { cloudBackup: {} } }),
    fetch: async (url, init = {}) => {
      calls.fetch.push([url, init]);
      if (fetchHandler) return fetchHandler(url, init, calls.fetch.length);
      return new Response(JSON.stringify(userInfo || { email: 'actual@example.com', sub: 'actual-user' }), { status: 200 });
    },
    AbortSignal: abortSignal, AbortController, setTimeout, clearTimeout, Date, URL, URLSearchParams, Headers, Response, console,
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: 'google-auth.js' });
  return { test: context.__authTest, calls, storageState };
}

// Native identity owns token caching: every sequential call consults it, including after a worker restart.
{
  const storageState = { pageclipBraveAccessToken: { token: 'legacy-brave-secret' }, pageclipWebAccessToken: { token: 'legacy-web-secret' } };
  const first = await loadAuth({ storageState });
  assert.equal(await first.test.getToken(), 'native-token');
  assert.equal(await first.test.getToken(true), 'native-token');
  assert.equal(first.calls.native.length, 2);
  assert.equal(first.calls.native[0].interactive, false);
  assert.equal(first.calls.native[1].interactive, true);
  assert.equal(storageState.pageclipBraveAccessToken, undefined);
  assert.equal(storageState.pageclipWebAccessToken, undefined);
  const restarted = await loadAuth({ storageState });
  await restarted.test.authenticationStatus();
  assert.equal(await restarted.test.getToken(), 'native-token');
  assert.equal(restarted.calls.native.length, 1);
  assert.equal(restarted.calls.web.length, 0);
  assert.equal(JSON.stringify(storageState).includes('native-token'), false);
}

for (const options of [
  { brave: true }, { brands: [{ brand: 'Brave', version: '1' }] },
  { userAgent: 'Mozilla/5.0 Firefox/128.0' }, { userAgent: 'Mozilla/5.0 Chrome/130.0 Edg/130.0' },
  { includeNative: false },
]) {
  const { test, calls } = await loadAuth(options);
  await assert.rejects(test.getToken(true), (error) => Boolean(error.code));
  assert.equal(calls.native.length, 0);
  assert.equal(calls.web.length, 0);
}

{
  const pending = deferred();
  const { test, calls } = await loadAuth({ native: () => pending.promise });
  const requests = [test.getToken(), test.getToken(), test.getToken(true)];
  await tick();
  assert.equal(calls.native.length, 1);
  pending.resolve({ token: 'shared-token' });
  assert.deepEqual(await Promise.all(requests), ['shared-token', 'shared-token', 'shared-token']);
  assert.equal(calls.native.length, 1);
}

{
  const pending = deferred();
  const { test, calls } = await loadAuth({ native: (_, count) => count === 1 ? pending.promise : { token: 'upgraded-token' } });
  const silent = test.getToken();
  const silentRejected = assert.rejects(silent, (error) => Boolean(error.code));
  const interactive = test.getToken(true);
  const secondInteractive = test.getToken(true);
  await tick();
  assert.equal(calls.native.length, 1);
  pending.reject(new Error('OAuth2 not granted or revoked.'));
  await silentRejected;
  assert.deepEqual(await Promise.all([interactive, secondInteractive]), ['upgraded-token', 'upgraded-token']);
  assert.equal(calls.native.length, 2);
  assert.equal(calls.native[1].interactive, true);
}

// Transient failures must not turn a concurrent silent request into an interactive prompt.
for (const message of ['OAuth2 request failed: network error', 'Rate limit exceeded']) {
  const pending = deferred();
  const { test, calls } = await loadAuth({ native: () => pending.promise });
  const results = Promise.allSettled([test.getToken(), test.getToken(true)]);
  await tick();
  pending.reject(new Error(message));
  const settled = await results;
  assert.equal(settled.every((result) => result.status === 'rejected' && result.reason.code), true);
  assert.equal(calls.native.length, 1);
  assert.equal(calls.web.length, 0);
}

// Evict the exact rejected token, not a newer concurrent token.
{
  const { test, calls } = await loadAuth({ native: (_, count) => ({ token: 'token-' + count }) });
  await test.getToken();
  await test.getToken();
  await test.clearToken('token-1');
  assert.equal(calls.removed.includes('token-1'), true);
  assert.equal(calls.removed.includes('token-2'), false);
  await test.clearToken();
  assert.equal(calls.removed.includes('token-2'), true);
}

{
  const { test, calls } = await loadAuth();
  const account = await test.getAuthenticatedAccount('explicit-token');
  assert.equal(account.email, 'actual@example.com');
  assert.equal(calls.native.length, 0);
  assert.equal(calls.profile, 0);
  assert.equal(new Headers(calls.fetch[0][1].headers).get('Authorization'), 'Bearer explicit-token');
  assert.ok(calls.fetch[0][1].signal, 'userinfo must have a timeout signal');
}

{
  const { test } = await loadAuth({ boundAccount: 'bound@example.com' });
  await assert.rejects(test.getAuthenticatedAccount('token'), (error) => error.kind === 'auth' && error.code === 'account_mismatch');
  const matching = await loadAuth({ boundAccount: 'actual@example.com' });
  assert.equal((await matching.test.getAuthenticatedAccount('token')).email, 'actual@example.com');
}

{
  const { test, calls } = await loadAuth({ native: () => ({ token: 'under-scoped-token', grantedScopes: ['openid'] }) });
  await assert.rejects(test.getToken(true), (error) => error.kind === 'permission' && error.code === 'scope');
  assert.deepEqual(calls.removed, ['under-scoped-token']);
}

{
  const pending = deferred();
  const { test, calls, storageState } = await loadAuth({ native: () => pending.promise });
  const result = assert.rejects(test.getToken(), (error) => error.kind === 'auth' && error.code === 'disconnected');
  await tick();
  await test.disconnectAuthentication();
  pending.resolve({ token: 'late-token' });
  await result;
  assert.equal(calls.removed.includes('late-token'), true);
  assert.equal(storageState.pageclipGoogleAuth.status, 'disconnected');
}

for (const [message, kind, code] of [
  ['OAuth2 request failed: network error', 'retry', 'transport'],
  ['Rate limit exceeded', 'retry', 'rate_limited'],
  ['OAuth2 not granted or revoked.', 'auth', 'reauthorize'],
  ['Insufficient permission', 'permission', 'scope'],
  ['The user turned off browser signin', 'auth', 'native_unavailable'],
]) {
  const { test, calls, storageState } = await loadAuth({ native: () => { throw new Error(message + ' secret-provider-detail'); } });
  await assert.rejects(test.getToken(true), (error) => error.kind === kind && error.code === code && !error.message.includes('secret-provider-detail'));
  assert.equal(calls.web.length, 0);
  assert.equal(JSON.stringify(storageState).includes('secret-provider-detail'), false);
}

for (const [status, kind, code] of [[401, 'auth', 'userinfo_unauthorized'], [403, 'permission', 'userinfo_permission'], [429, 'retry', 'userinfo_transport'], [503, 'retry', 'userinfo_transport']]) {
  const { test, calls, storageState } = await loadAuth({ fetchHandler: () => new Response('{}', { status, headers: { 'Retry-After': '12' } }) });
  await assert.rejects(test.getAuthenticatedAccount('rejected-token'), (error) => error.kind === kind && error.code === code && (status !== 429 || error.retryAfter === 12000));
  assert.equal(calls.removed.includes('rejected-token'), status === 401);
  assert.equal(storageState.pageclipGoogleAuth.status, kind === 'auth' ? 'reauthorize' : kind);
}

for (const fetchHandler of [
  () => { throw new TypeError('fetch failed secret'); },
  (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
]) {
  const { test } = await loadAuth({ fetchHandler, abortSignal: { timeout: () => AbortSignal.timeout(5) } });
  // Keep the process alive while the deliberately shortened timeout fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(test.getAuthenticatedAccount('token'), (error) => error.kind === 'retry' && error.code === 'userinfo_transport'); }
  finally { clearTimeout(keepAlive); }
}

{
  const storageState = {};
  const first = await loadAuth({ storageState });
  await first.test.getToken();
  assert.equal(storageState.pageclipGoogleAuth.status, 'ready');
  assert.equal(storageState.pageclipGoogleAuth.expiryManagedBy, 'browser');
  assert.equal(storageState.pageclipGoogleAuth.expiresAt, null);
  await first.test.disconnectAuthentication();
  assert.equal(first.calls.removed.includes('native-token'), true);
  const restarted = await loadAuth({ storageState });
  assert.equal((await restarted.test.authenticationStatus()).status, 'disconnected');
  await assert.rejects(restarted.test.getToken(), (error) => error.kind === 'auth');
  assert.equal(restarted.calls.native.length, 0);
  assert.equal(await restarted.test.getToken(true), 'native-token');
  assert.equal(JSON.stringify(storageState).includes('native-token'), false);
}

{
  const gate=deferred();
  const {test,calls}=await loadAuth({native:()=>gate.promise});
  const silent=test.getToken(); const interactive=test.getToken(true);
  const results=Promise.allSettled([silent,interactive]); await tick();
  await test.disconnectAuthentication(); gate.resolve({token:'late'});
  assert.ok((await results).every(r=>r.status==='rejected'));
  assert.equal(calls.native.length,1);
  assert.equal((await test.authenticationStatus()).status,'disconnected');
}
{
  const {test,calls}=await loadAuth({native:(_opts,n)=>({token:'token-'+n}),fetchHandler:(_url,init)=>
    init.headers.Authorization==='Bearer token-1' ? new Response('{}',{status:401}) : new Response(JSON.stringify({email:'actual@example.com'}))});
  const session=test.createSyncSession('actual@example.com');
  assert.equal(await session.getToken(),'token-2');
  assert.deepEqual(calls.removed,['token-1']);
  assert.equal((await test.authenticationStatus()).status,'ready');
}
{
  const {test}=await loadAuth({native:()=>{throw new Error('server_error');}});
  await assert.rejects(test.getToken(),e=>e.kind==='retry');
}

console.log('Native OAuth tests passed: restart, typed errors, timeout, legacy cleanup, unsupported browsers, singleflight, interactive upgrade, rejected-token eviction, and actual account identity');
