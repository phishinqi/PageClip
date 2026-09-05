import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud-backup.js', import.meta.url), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*/gm, '')
  .replace(/^export\s+/gm, '')
  + '\n globalThis.__oauthTest = { getToken, clearToken, driveRequest, parseOAuthCallback, isBraveBrowser };';

async function loadAuth({ brave = false, brands = [], nativeToken, nativeError, webCallback, webFlow, includeWebApi = true, storageState = {}, fetchHandler } = {}) {
  const calls = { native: 0, web: [], storage: [], fetch: [] };
  const storage = {
    async get(key) {
      calls.storage.push(['get', key]);
      return { [key]: storageState[key] };
    },
    async set(values) {
      calls.storage.push(['set', values]);
      Object.assign(storageState, values);
    },
    async remove(key) {
      calls.storage.push(['remove', key]);
      delete storageState[key];
    },
  };
  const identity = {
    async getAuthToken() {
      calls.native += 1;
      if (nativeError) throw nativeError;
      return nativeToken ?? { token: 'native-token' };
    },
    getRedirectURL() {
      calls.redirect = true;
      return 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/';
    },
  };
  if (includeWebApi) {
    identity.launchWebAuthFlow = async (details) => {
      calls.web.push(details);
      return webFlow ? webFlow(details, calls.web.length) : (webCallback ?? 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=web-token');
    };
  }
  const context = {
    chrome: { identity, storage: { local: storage }, runtime: { id: 'mnapcpmijebakicgdflohgnjmndhlneg' } },
    navigator: brave ? { brave: { async isBrave() { return true; } }, userAgentData: { brands } } : { userAgentData: { brands }, userAgent: '' },
    URL,
    URLSearchParams,
    Headers,
    Response,
    fetch: async (input, init = {}) => {
      calls.fetch.push([input, init]);
      if (fetchHandler) return fetchHandler(input, init, calls.fetch.length);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    TextEncoder,
    console,
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: 'cloud-backup.js' });
  return { test: context.__oauthTest, calls, storageState };
}

{
  const { test, calls } = await loadAuth({ nativeToken: { token: 'chrome-token' } });
  assert.equal(await test.getToken(true), 'chrome-token');
  assert.equal(calls.native, 1);
  assert.equal(calls.web.length, 0);
}

{
  const { test, calls } = await loadAuth({ brave: true, nativeError: new Error('must not call native') });
  assert.equal(await test.getToken(true), 'web-token');
  assert.equal(calls.native, 0);
  assert.equal(calls.web.length, 1);
  const authUrl = new URL(calls.web[0].url);
  assert.equal(authUrl.searchParams.get('response_type'), 'token');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/');
  assert.match(authUrl.searchParams.get('client_id'), /^996608683771-[a-z0-9]+\.apps\.googleusercontent\.com$/);
}

{
  const { test, calls } = await loadAuth({ brands: [{ brand: 'Brave', version: '1' }], nativeError: new Error('must not call native') });
  assert.equal(await test.getToken(true), 'web-token');
  assert.equal(calls.native, 0);
  assert.equal(calls.web.length, 1);
}

{
  const { test, calls } = await loadAuth({ nativeError: new Error('opaque native failure'), webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/callback?access_token=query-token' });
  await assert.rejects(() => test.getToken(true), /opaque native failure/);
  assert.equal(calls.native, 1);
  assert.equal(calls.web.length, 0);
}

{
  const { test, calls } = await loadAuth({ nativeError: new Error('Custom URI scheme is not supported on Chrome apps'), webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/callback?access_token=query-token' });
  assert.equal(await test.getToken(true), 'query-token');
  assert.equal(calls.native, 1);
  assert.equal(calls.web.length, 1);
}

{
  const { test } = await loadAuth();
  assert.throws(() => test.parseOAuthCallback('https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#error=access_denied&error_description=User%20denied'), /User denied/);
}

{
  const { test, calls } = await loadAuth({
    brave: true,
    webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#error=interaction_required&error_description=Login%20needed',
  });
  await assert.rejects(() => test.getToken(false), /interaction_required/);
  assert.equal(calls.web.length, 1);
  const authUrl = new URL(calls.web[0].url);
  assert.equal(authUrl.searchParams.get('prompt'), 'none');
  assert.equal(calls.web[0].interactive, false);
}

{
  const { test } = await loadAuth({ brave: true, includeWebApi: false });
  await assert.rejects(() => test.getToken(true), /Brave Web OAuth API 不可用/);
}

{
  let resolveWebFlow;
  const pendingWebFlow = new Promise((resolve) => { resolveWebFlow = resolve; });
  const { test, calls } = await loadAuth({ brave: true, webCallback: pendingWebFlow });
  const first = test.getToken(true);
  const second = test.getToken(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.web.length, 1);
  resolveWebFlow('https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=shared-token');
  assert.equal(await first, 'shared-token');
  assert.equal(await second, 'shared-token');
}

{
  let rejectSilentFlow;
  const silentWebFlow = new Promise((_, reject) => { rejectSilentFlow = reject; });
  const { test, calls } = await loadAuth({
    brave: true,
    webFlow: (_, count) => count === 1
      ? silentWebFlow
      : 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=interactive-token',
  });
  const silent = test.getToken(false);
  const interactive = test.getToken(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.web.length, 1);
  rejectSilentFlow(new Error('silent authorization unavailable'));
  await assert.rejects(silent, /silent authorization unavailable/);
  assert.equal(await interactive, 'interactive-token');
  assert.equal(calls.web.length, 2);
  const interactiveAuthUrl = new URL(calls.web[1].url);
  assert.equal(interactiveAuthUrl.searchParams.get('prompt'), 'select_account');
}

{
  const { test, calls, storageState } = await loadAuth({
    brave: true,
    webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=stored-token&expires_in=3600',
  });
  assert.equal(await test.getToken(true), 'stored-token');
  assert.equal(storageState.pageclipBraveAccessToken.token, 'stored-token');
  assert.equal(storageState.pageclipBraveAccessToken.expiresAt > Date.now(), true);
  assert.equal(calls.native, 0);
  assert.equal(calls.web.length, 1);
}

{
  const { test, calls, storageState } = await loadAuth({
    brave: true,
    webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=memory-only-token',
  });
  assert.equal(await test.getToken(true), 'memory-only-token');
  assert.equal(storageState.pageclipBraveAccessToken, undefined);
  assert.equal(calls.storage.some(([kind]) => kind === 'set'), false);
}

{
  const { test, calls, storageState } = await loadAuth({ nativeToken: { token: 'chrome-token' } });
  assert.equal(await test.getToken(true), 'chrome-token');
  assert.equal(storageState.pageclipBraveAccessToken, undefined);
  assert.equal(calls.storage.some(([kind]) => kind === 'set'), false);
}

{
  const { test, calls, storageState } = await loadAuth({
    nativeError: new Error('Custom URI scheme is not supported on Chrome apps'),
    webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=fallback-token&expires_in=3600',
  });
  assert.equal(await test.getToken(true), 'fallback-token');
  assert.equal(calls.web.length, 1);
  assert.equal(storageState.pageclipBraveAccessToken, undefined);
  assert.equal(calls.storage.some(([kind]) => kind === 'set'), false);
}

{
  const storageState = { pageclipBraveAccessToken: { token: 'warm-token', expiresAt: Date.now() + 60 * 60 * 1000 } };
  const { test, calls } = await loadAuth({ brave: true, storageState });
  assert.equal(await test.getToken(false), 'warm-token');
  assert.equal(calls.web.length, 0);
  assert.equal(calls.native, 0);
}

{
  const storageState = { pageclipBraveAccessToken: { token: 'expired-token', expiresAt: Date.now() - 1 } };
  const { test, calls } = await loadAuth({ brave: true, storageState, webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=fresh-token&expires_in=3600' });
  assert.equal(await test.getToken(false), 'fresh-token');
  assert.equal(calls.storage.some(([kind, key]) => kind === 'remove' && key === 'pageclipBraveAccessToken'), true);
  assert.equal(calls.web.length, 1);
}

{
  const storageState = { pageclipBraveAccessToken: { token: 'warm-token', expiresAt: Date.now() + 60 * 60 * 1000 } };
  const { test, calls } = await loadAuth({
    brave: true,
    storageState,
    webCallback: 'https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#access_token=replacement-token&expires_in=3600',
    fetchHandler: (_, __, count) => new Response(JSON.stringify({ error: { message: 'Expired token' } }), { status: count === 1 ? 401 : 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await test.driveRequest('https://www.googleapis.com/drive/v3/files', { interactive: false });
  assert.equal(calls.web.length, 1);
  assert.equal(calls.storage.some(([kind, key]) => kind === 'remove' && key === 'pageclipBraveAccessToken'), true);
  assert.equal(storageState.pageclipBraveAccessToken.token, 'replacement-token');
}

{
  const storageState = { pageclipBraveAccessToken: { token: 'warm-token', expiresAt: Date.now() + 60 * 60 * 1000 } };
  const { test } = await loadAuth({ brave: true, storageState });
  assert.equal(await test.getToken(false), 'warm-token');
  await test.clearToken();
  assert.equal(storageState.pageclipBraveAccessToken, undefined);
}

console.log('OAuth behavior tests passed: token cache, silent flow, fallback, and concurrency');
