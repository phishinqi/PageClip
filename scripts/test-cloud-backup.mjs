import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud-backup.js', import.meta.url), 'utf8');
// Imports/re-exports are injected, so manager and backup module declarations never collide.
const executable = source.replace(/^import[^;]+;\s*/gm, '').replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*/gm, '').replace(/^export\s+/gm, '')
  + '\n globalThis.__backupTest = { connectGoogle, getConnectedAccount, getCloudBackupStatus, signOutGoogle, driveRequest, downloadBackupFile };';

async function loadBackup({ account = { email: 'actual-token-owner@example.com', error: null }, accountError, tokenError, settings = {}, fetchHandler } = {}) {
  const calls = { tokens: [], clear: [], accounts: [], saves: [], fetch: [], disconnect: 0 };
  const data = { schema: 3, settings: { cloudBackup: settings } };
  const context = {
    getToken: async (interactive = false) => {
      calls.tokens.push(interactive);
      if (tokenError) throw tokenError;
      return 'token-' + calls.tokens.length;
    },
    clearToken: async (token) => { calls.clear.push(token); },
    getAuthenticatedAccount: async (token) => {
      calls.accounts.push(token);
      if (accountError) throw accountError;
      return account;
    },
    disconnectAuthentication: async () => { calls.disconnect += 1; },
    authenticationStatus: async () => ({ status: 'ready', method: 'native' }),
    chrome: { identity: { async launchWebAuthFlow() { throw new Error('Forbidden web fallback'); } } },
    loadData: async () => structuredClone(data),
    updateSettings: async (patch) => { calls.saves.push(patch); data.settings = { ...data.settings, ...patch }; },
    fetch: async (url, init = {}) => {
      calls.fetch.push([url, init]);
      return fetchHandler ? fetchHandler(url, init, calls.fetch.length) : new Response('{"files":[]}', { status: 200 });
    },
    Headers, Response, URL, URLSearchParams, TextEncoder, Date, console,
  };
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: 'cloud-backup.js' });
  return { test: context.__backupTest, calls, data };
}

{
  const { test, calls, data } = await loadBackup();
  const result = await test.connectGoogle();
  assert.equal(result.email, 'actual-token-owner@example.com');
  assert.deepEqual(calls.tokens, [true]);
  assert.deepEqual(calls.accounts, ['token-1']);
  assert.equal(data.settings.cloudBackup.googleAccountEmail, 'actual-token-owner@example.com');
  assert.equal((await test.getConnectedAccount()).email, 'actual-token-owner@example.com');
}

// A userinfo denial, revocation, mismatch, or transient error is never converted into a connected account.
for (const [kind, code] of [['auth', 'account_mismatch'], ['auth', 'userinfo_unauthorized'], ['permission', 'userinfo_permission'], ['retry', 'userinfo_transport']]) {
  const error = Object.assign(new Error('safe manager error'), { kind, code });
  const { test, calls, data } = await loadBackup({ accountError: error });
  await assert.rejects(test.connectGoogle(), (actual) => actual === error);
  assert.equal(calls.saves.length, 0);
  assert.equal(data.settings.cloudBackup.googleAccountEmail, undefined);
}

{
  const error = Object.assign(new Error('Native auth unavailable'), { kind: 'auth', code: 'native_unavailable' });
  const { test, calls } = await loadBackup({ tokenError: error });
  await assert.rejects(test.connectGoogle(), (actual) => actual === error);
  assert.equal(calls.accounts.length, 0);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.saves.length, 0);
}

{
  const { test } = await loadBackup();
  assert.equal(await test.getConnectedAccount(), null);
  const status = await test.getCloudBackupStatus();
  assert.equal(status.connected, false);
  assert.equal(status.account, null);
}

{
  const { test, calls } = await loadBackup({ fetchHandler: (_, __, count) => new Response(count === 1 ? '{}' : '{"files":[]}', { status: count === 1 ? 401 : 200 }) });
  await test.driveRequest('https://www.googleapis.com/drive/v3/files', { interactive: true });
  assert.deepEqual(calls.clear, ['token-1']);
  assert.deepEqual(calls.tokens, [true, false]);
  assert.equal(calls.fetch.length, 2);
  assert.equal(new Headers(calls.fetch[1][1].headers).get('Authorization'), 'Bearer token-2');
}

{
  const { test, calls } = await loadBackup({ fetchHandler: () => new Response('{}', { status: 401 }) });
  await assert.rejects(test.driveRequest('https://www.googleapis.com/drive/v3/files'));
  assert.equal(calls.fetch.length, 2, '401 retry must be bounded');
  assert.deepEqual(calls.clear, ['token-1']);
}

{
  const { test, calls } = await loadBackup({ fetchHandler: (_, __, count) => new Response('{}', { status: count === 1 ? 401 : 200 }) });
  await test.downloadBackupFile({ id: 'file-id' }, false);
  assert.deepEqual(calls.clear, ['token-1']);
  assert.deepEqual(calls.tokens, [false, false]);
}

{
  const { test, calls, data } = await loadBackup({ settings: { googleAccountEmail: 'old@example.com', autoBackupEnabled: true, driveFileId: 'old-file' } });
  await test.signOutGoogle();
  assert.equal(calls.disconnect, 1);
  assert.equal(data.settings.cloudBackup.googleAccountEmail, null);
  assert.equal(data.settings.cloudBackup.autoBackupEnabled, false);
  assert.equal(data.settings.cloudBackup.driveFileId, null);
}

console.log('Cloud backup tests passed: injected native manager, strict verified account, typed failures, bounded 401 retry, exact rejected-token eviction, and disconnect');
