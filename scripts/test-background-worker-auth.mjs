import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const stripImports = source => source.replace(/^import[^;]+;\s*/gm, '').replace(/^export\s+/gm, '');
const [background, adapter] = await Promise.all([
  readFile(new URL('../background.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/google-worker-auth.js', import.meta.url), 'utf8'),
]);
const origin = 'https://oauth.publisher.test';
const callback = origin + '/oauth/callback';
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const event = () => ({
  listeners: [],
  addListener(listener) { this.listeners.push(listener); },
  emit(...args) { return this.listeners.map(listener => listener(...args)); },
});

async function harness(configuredOrigin = origin, legacyEnabled = false) {
  const storage = {};
  const alarms = new Map();
  const calls = [];
  const onUpdated = event(), onAlarm = event(), onMessage = event(), onChanged = event();
  const data = {
    items: [{ id: 'local-item', url: 'https://example.com/' }],
    _sync: { enabled: legacyEnabled, account: 'a@example.com', keyFingerprint: 'bound-key', keyVerified: true, outbox: ['local-op'] },
    settings: { cloudBackup: { autoBackupEnabled: false } },
  };
  const controls = { ready: true, email: 'a@example.com', redemptionGate: null, activationGate: null, activationOk: true, backupFails: false };
  const context = {
    GOOGLE_WORKER_ORIGIN: configuredOrigin,
    crypto: webcrypto, Uint8Array, TextEncoder, URL, Date, Math, AbortSignal, btoa,
    setTimeout, clearTimeout,
    console: { log() { assert.fail('OAuth flow must not log'); }, error() { assert.fail('OAuth flow must not log'); } },
    chrome: {
      tabs: { onUpdated, onRemoved: event() },
      runtime: { id: 'extension-id', getURL: path => 'chrome-extension://extension-id/' + path, onMessage, onInstalled: event(), onStartup: event() },
      alarms: { onAlarm, create: async (name, info) => alarms.set(name, info), clear: async name => alarms.delete(name) },
      storage: {
        onChanged,
        local: {
          setAccessLevel: async () => {},
          get: async key => ({ [key]: structuredClone(storage[key]) }),
          set: async patch => {
            const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: structuredClone(storage[key]), newValue: structuredClone(value) }]));
            Object.assign(storage, structuredClone(patch));
            onChanged.emit(changes, 'local');
          },
          remove: async key => { delete storage[key]; },
        },
      },
      action: { onClicked: event() }, commands: { onCommand: event() },
    },
    loadData: async () => structuredClone(data),
    mutate: async fn => fn(data),
    recoverPkceCallback: async () => false,
    SYNC_ALARM: 'sync', SYNC_RETRY_ALARM: 'sync-retry', AUTO_BACKUP_ALARM: 'backup',
    hasBackupRelevantChange: () => false,
    completeWorkerAuthorization: async () => {
      calls.push('complete');
      if (controls.activationGate) await controls.activationGate.promise;
      if (!controls.activationOk) throw Error('activation unavailable');
      await context.chrome.storage.local.set({ pageclipGoogleAuth: { status: 'ready' } });
    },
    connectGoogle: async () => {
      calls.push('backup');
      if (controls.backupFails) throw Error('backup settings unavailable');
      data.settings.cloudBackup.googleAccountEmail = controls.email;
    },
    handleSyncMessage: async message => {
      calls.push(message.action);
      if (message.action === 'status') {
        // Status reads can cause auth metadata writes. They must not resume auth.
        await context.chrome.storage.local.set({ pageclipGoogleAuth: { status: 'ready', updatedAt: Date.now() } });
      }
      if (message.action === 'complete') {
        if (controls.activationGate) await controls.activationGate.promise;
        if (controls.activationOk) data._sync.enabled = true;
      }
      return { ok: controls.activationOk };
    },
    fetch: async url => {
      assert.equal(url, origin + '/v1/redeem');
      calls.push('redeem');
      if (controls.redemptionGate) await controls.redemptionGate.promise;
      return controls.ready
        ? new Response(JSON.stringify({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, email: controls.email, subject: 'bound-subject' }))
        : new Response(JSON.stringify({ error: 'pending' }), { status: 409 });
    },
  };
  vm.createContext(context);
  vm.runInContext(stripImports(adapter) + '\n' + stripImports(background), context, { filename: 'background-worker-auth.js' });
  await settle(); // Initial worker wakeup has no pending handoff.
  const sender = { id: 'extension-id', url: context.chrome.runtime.getURL('options.html') + '?cloud=1#backup' };
  const message = (action, from = sender) => {
    let accepted;
    const response = new Promise(resolve => {
      [accepted] = onMessage.emit({ type: 'cloud-sync', action }, from, resolve);
      if (!accepted) resolve(undefined);
    });
    return { accepted, response };
  };
  const pending = (enableSync = true) => {
    storage.pageclipWorkerAuth = {
      brokerOrigin: origin, enableSync,
      pending: { id: 'session', verifier: 'local-proof', credential: 'local-credential', expiresAt: Date.now() + 600000 },
    };
    alarms.set('pageclip-worker-auth', { when: Date.now() + 60000 });
  };
  return { context, storage, alarms, calls, controls, data, onUpdated, onAlarm, onChanged, message, pending };
}

// A retired installation is paused on worker wakeup without erasing data or queue.
const retired = await harness(origin, true);
assert.equal(retired.data._sync.enabled, false);
assert.deepEqual(retired.data._sync.outbox, ['local-op']);
assert.equal(retired.data.items[0].id, 'local-item');
assert.equal((await retired.message('run').response).ok, false);
assert.equal((await retired.message('connect').response).ok, false);
retired.onAlarm.emit({ name: 'pageclip-causal-sync' });
retired.onAlarm.emit({ name: 'pageclip-causal-sync-retry' });
await settle();
assert.deepEqual(retired.calls, [], 'legacy alarms must never call the sync engine');

// Navigation completion immediately redeems without an alarm tick and never enables sync.
const immediate = await harness();
immediate.pending();
const before = structuredClone(immediate.data);
immediate.onUpdated.emit(10, { status: 'loading', url: callback + '?code=never-read' }, {});
await settle();
assert.deepEqual(immediate.calls, []);
immediate.onUpdated.emit(10, { status: 'complete' }, { url: callback + '?code=never-read&state=never-read#ignored' });
await settle();
assert.deepEqual(immediate.calls, ['redeem', 'complete', 'backup']);
assert.equal(immediate.data._sync.enabled, false);
assert.equal(immediate.storage.pageclipWorkerAuth.needsActivation, false);
assert.equal(immediate.alarms.has('pageclip-worker-auth'), false);
assert.deepEqual(immediate.data.items, before.items);
assert.deepEqual(immediate.data._sync.outbox, before._sync.outbox);
assert.equal(immediate.data._sync.account, before._sync.account);
assert.equal(immediate.data._sync.keyFingerprint, before._sync.keyFingerprint);
assert.equal(JSON.stringify(immediate.storage).includes('never-read'), false);

// Exact origin/path match: unrelated URLs, lookalikes and URL-only updates do nothing.
const ignored = await harness();
ignored.pending();
for (const url of [
  'https://untrusted.test/oauth/callback', origin + '.evil.test/oauth/callback',
  'http://oauth.publisher.test/oauth/callback', 'https://oauth.publisher.test:444/oauth/callback',
  origin + '/oauth/callback/', origin + '/oauth/callback-extra', origin + '/authorize',
  origin + '/other?next=' + callback, 'https://user:password@oauth.publisher.test/oauth/callback',
  'not a URL', 'chrome-extension://extension-id/options.html',
]) ignored.onUpdated.emit(10, { status: 'complete', url }, { url });
ignored.onUpdated.emit(10, { url: callback }, { url: callback });
await settle();
assert.deepEqual(ignored.calls, []);
assert.equal(ignored.alarms.has('pageclip-worker-auth'), true);

// Callback, alarm and options focus all share redemption AND activation work.
const overlap = await harness();
overlap.pending();
overlap.controls.redemptionGate = deferred();
overlap.controls.activationGate = deferred();
overlap.onUpdated.emit(10, { status: 'complete', url: callback }, {});
for (let i = 0; i < 5; i++) overlap.onUpdated.emit(10, { status: 'complete' }, { url: callback });
overlap.onAlarm.emit({ name: 'pageclip-worker-auth' });
const focus = overlap.message('auth-resume');
assert.equal(focus.accepted, true);
await settle();
assert.deepEqual(overlap.calls, ['redeem']);
overlap.controls.redemptionGate.resolve();
await settle();
assert.deepEqual(overlap.calls, ['redeem', 'complete']);
overlap.onAlarm.emit({ name: 'pageclip-worker-auth' });
const secondFocus = overlap.message('auth-resume');
await settle();
assert.deepEqual(overlap.calls, ['redeem', 'complete']);
overlap.controls.activationGate.resolve();
assert.equal((await focus.response).ok, true);
assert.equal((await secondFocus.response).ok, true);
assert.deepEqual(overlap.calls, ['redeem', 'complete', 'backup']);

// Backup-only auth completes without enabling sync; status/storage writes cannot loop.
const backup = await harness();
backup.pending(false);
assert.equal((await backup.message('auth-resume').response).ok, true);
assert.deepEqual(backup.calls, ['redeem', 'complete', 'backup']);
assert.equal(backup.data._sync.enabled, false);
assert.equal(backup.storage.pageclipWorkerAuth.enableSync, false);
const callsAfterBackup = backup.calls.length;
for (let i = 0; i < 3; i++) await backup.message('status').response;
await settle();
assert.deepEqual(backup.calls.slice(callsAfterBackup), []);
assert.equal((await backup.message('connect').response).ok, false, 'retired sync cannot be enabled via messages');
assert.equal(backup.calls.filter(call => call === 'redeem').length, 1);

// The focus continuation is available only to trusted extension pages.
const untrusted = await harness();
untrusted.pending();
for (const sender of [
  { id: 'other-extension', url: 'chrome-extension://extension-id/options.html' },
  { id: 'extension-id', url: 'https://example.com/options.html' },
  { id: 'extension-id', url: 'chrome-extension://extension-id/options.html.evil' },
  { id: 'extension-id' },
]) {
  const result = untrusted.message('auth-resume', sender);
  assert.equal(result.accepted, false);
  assert.equal(await result.response, undefined);
}
await settle();
assert.deepEqual(untrusted.calls, []);

// A callback URL alone is not success. Pending redemption keeps the alarm fallback.
const retry = await harness();
retry.pending();
retry.controls.ready = false;
retry.onUpdated.emit(10, { status: 'complete', url: callback + '?error=access_denied' }, {});
await settle();
assert.deepEqual(retry.calls, ['redeem']);
assert.equal(retry.data._sync.enabled, false);
assert.ok(retry.storage.pageclipWorkerAuth.pending);
assert.equal(retry.alarms.has('pageclip-worker-auth'), true);
retry.controls.ready = true;
retry.onAlarm.emit({ name: 'pageclip-worker-auth' });
await settle();
assert.deepEqual(retry.calls, ['redeem', 'redeem', 'complete', 'backup']);
assert.equal(retry.alarms.has('pageclip-worker-auth'), false);

// Activation/settings failures retain durable activation and alarm for later retry.
for (const failure of ['activation', 'backup']) {
  const failed = await harness();
  failed.pending();
  failed.controls.activationOk = failure !== 'activation';
  failed.controls.backupFails = failure === 'backup';
  assert.equal((await failed.message('auth-resume').response).ok, false);
  assert.equal(failed.storage.pageclipWorkerAuth.needsActivation, true);
  assert.equal(failed.alarms.has('pageclip-worker-auth'), true);
  failed.controls.activationOk = true;
  failed.controls.backupFails = false;
  failed.onAlarm.emit({ name: 'pageclip-worker-auth' });
  await settle();
  assert.equal(failed.storage.pageclipWorkerAuth.needsActivation, false);
  assert.equal(failed.calls.filter(call => call === 'redeem').length, 1);
}

// Adapter account binding still blocks an otherwise completed callback.
const mismatch = await harness();
mismatch.pending();
mismatch.controls.email = 'different@example.com';
mismatch.onUpdated.emit(10, { status: 'complete', url: callback }, {});
await settle();
assert.deepEqual(mismatch.calls, ['redeem']);
assert.equal(mismatch.storage.pageclipWorkerAuth.error, 'account_mismatch');
assert.equal(mismatch.data._sync.account, 'a@example.com');
assert.equal(mismatch.data._sync.enabled, false);
assert.deepEqual(mismatch.data._sync.outbox, ['local-op']);

for (const configuredOrigin of ['', 'http://oauth.publisher.test', origin + '/unexpected-path']) {
  const invalid = await harness(configuredOrigin);
  invalid.pending();
  invalid.onUpdated.emit(10, { status: 'complete', url: callback }, {});
  await settle();
  assert.deepEqual(invalid.calls, []);
}

console.log('Background Worker auth tests passed: immediate trusted callback, singleflight, focus sender checks, backup-only gating, status-write loop prevention, alarm retries, and account/data preservation.');
