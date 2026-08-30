import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud-backup.js', import.meta.url), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*/m, '')
  .replace(/^export\s+/gm, '')
  + '\n globalThis.__oauthTest = { connectGoogle, getConnectedAccount, getCloudBackupStatus, resolveAccountInfo };';

function makeResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

async function loadAuth({ brave = false, profile = {}, userInfo = null, nativeToken = { token: 'native-token' }, webCallback = 'https://fimhgjmocneioennilphfkdejdebkmfe.chromiumapp.org/#access_token=web-token' } = {}) {
  const calls = { native: 0, web: [], userInfo: 0, saves: [] };
  const data = { schema: 3, settings: { cloudBackup: {} } };
  const identity = {
    async getAuthToken() { calls.native += 1; return nativeToken; },
    async getProfileUserInfo() { return profile; },
    getRedirectURL() { return 'https://fimhgjmocneioennilphfkdejdebkmfe.chromiumapp.org/'; },
    async launchWebAuthFlow(details) { calls.web.push(details); return webCallback; },
  };
  const context = {
    chrome: { identity, runtime: { id: 'fimhgjmocneioennilphfkdejdebkmfe' } },
    navigator: brave ? { brave: { async isBrave() { return true; } }, userAgentData: { brands: [] } } : { userAgentData: { brands: [] }, userAgent: '' },
    URL,
    URLSearchParams,
    TextEncoder,
    console,
    loadData: async () => structuredClone(data),
    updateSettings: async (patch) => {
      calls.saves.push(patch);
      data.settings = { ...data.settings, ...patch };
    },
    fetch: async (input) => {
      const url = String(input);
      if (url.includes('/oauth2/v3/userinfo')) {
        calls.userInfo += 1;
        if (userInfo?.status) return makeResponse(userInfo.body || {}, userInfo.status);
        return makeResponse(userInfo || {});
      }
      if (url.includes('drive/v3')) return makeResponse({ files: [] });
      throw new Error('Unexpected fetch: ' + url);
    },
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: 'cloud-backup.js' });
  return { test: context.__oauthTest, calls, data };
}

{
  const { test, calls, data } = await loadAuth({ brave: true, profile: {}, userInfo: { email: 'abczhaozhe1@gmail.com' } });
  const result = await test.connectGoogle();
  assert.equal(result.email, 'abczhaozhe1@gmail.com');
  assert.equal(calls.native, 0);
  assert.equal(calls.web.length, 1);
  const authUrl = new URL(calls.web[0].url);
  assert.match(authUrl.searchParams.get('scope'), /drive\.appdata/);
  assert.match(authUrl.searchParams.get('scope'), /userinfo\.email/);
  assert.match(authUrl.searchParams.get('scope'), /openid/);
  assert.equal(data.settings.cloudBackup.googleAccountEmail, 'abczhaozhe1@gmail.com');
  assert.equal(calls.userInfo, 1);
}

{
  const { test, calls } = await loadAuth({ brave: true, profile: {}, userInfo: { status: 403, body: { error: 'insufficient_scope' } } });
  const result = await test.connectGoogle();
  assert.equal(result.email, null);
  assert.match(result.accountError, /邮箱读取失败/);
  const status = await test.getCloudBackupStatus();
  assert.equal(status.connected, true);
  assert.equal(status.account, null);
  assert.equal(status.file, null);
  assert.equal(calls.native, 0);
}

{
  const { test } = await loadAuth({ profile: { email: 'chrome@example.com' }, userInfo: null });
  const result = await test.connectGoogle();
  assert.equal(result.email, 'chrome@example.com');
}

console.log('Cloud backup account tests passed: 3 scenarios');
