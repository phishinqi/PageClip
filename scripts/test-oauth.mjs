import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud-backup.js', import.meta.url), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*/gm, '')
  .replace(/^export\s+/gm, '')
  + '\n globalThis.__oauthTest = { getToken, parseOAuthCallback, isBraveBrowser };';

async function loadAuth({ brave = false, brands = [], nativeToken, nativeError, webCallback, webFlow, includeWebApi = true } = {}) {
  const calls = { native: 0, web: [] };
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
    chrome: { identity, runtime: { id: 'mnapcpmijebakicgdflohgnjmndhlneg' } },
    navigator: brave ? { brave: { async isBrave() { return true; } }, userAgentData: { brands } } : { userAgentData: { brands }, userAgent: '' },
    URL,
    URLSearchParams,
    TextEncoder,
    console,
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: 'cloud-backup.js' });
  return { test: context.__oauthTest, calls };
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
  assert.equal(await test.getToken(true), 'query-token');
  assert.equal(calls.native, 1);
  assert.equal(calls.web.length, 1);
}

{
  const { test } = await loadAuth();
  assert.throws(() => test.parseOAuthCallback('https://mnapcpmijebakicgdflohgnjmndhlneg.chromiumapp.org/#error=access_denied&error_description=User%20denied'), /User denied/);
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

console.log('OAuth behavior tests passed: 8 scenarios');
