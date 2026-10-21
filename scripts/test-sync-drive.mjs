import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Match existing repository VM tests: no extension APIs or real credentials.
const source = (await readFile(new URL('../js/sync-drive.js', import.meta.url), 'utf8'))
  .replace(/^import[^;]+;\s*/gm, '').replace(/^export\s+/gm, '');
let timeoutCallback;
let fakeTimeout = false;
const context = vm.createContext({
  URLSearchParams, AbortController,
  cloudGetToken: async () => 'mock-default', cloudClearToken: async () => {},
  setTimeout: (fn, ms) => {
    assert.equal(ms, 20000);
    if (fakeTimeout) { timeoutCallback = fn; return 1; }
    return setTimeout(fn, ms);
  },
  clearTimeout: (id) => { if (!fakeTimeout) clearTimeout(id); },
});
vm.runInContext(source + '\nglobalThis.api = { DriveSyncAdapter, SyncError, SYNC_FILE_PREFIX };', context);
const { DriveSyncAdapter, SyncError, SYNC_FILE_PREFIX: prefix } = context.api;
const response = (body, status = 200, retryAfter = null) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => retryAfter },
  text: async () => JSON.stringify(body),
});
const name = prefix + 'op-1.json';
const entry = { id: 'drive-1', name };
const operation = { id: 'op-1', type: 'delete', target: 'clip-1' };
let scenarios = 0;
const plain = (value) => JSON.parse(JSON.stringify(value));

{
  const tokens = [];
  const adapter = new DriveSyncAdapter({ getToken: async (interactive) => { tokens.push(interactive); return 'token'; } });
  await adapter.initialize();
  await adapter.initialize({ interactive: true });
  assert.deepEqual(tokens, [false, true]);
  scenarios++;
}
{
  const calls = [];
  const adapter = new DriveSyncAdapter({ fetchImpl: async (url) => {
    const params = new URL(url).searchParams;
    calls.push(params);
    return params.has('pageToken') ? response({ files: [entry] }) : response({
      files: [{ id: 'zero', name, size: '0' }, { id: 'other', name: 'other-' + name },
        { id: 'valid', name: prefix + 'second.json', size: '42' }], nextPageToken: 'next',
    });
  } });
  assert.deepEqual(plain(await adapter.list()), [{ id: 'valid', name: prefix + 'second.json' }, entry]);
  assert.equal(calls[0].get('spaces'), 'appDataFolder');
  assert.equal(calls[0].get('fields'), 'nextPageToken,files(id,name,size)');
  assert.equal(calls[1].get('pageToken'), 'next');
  scenarios++;
}
{
  const calls = [];
  let published = false;
  let encoded = 0;
  const adapter = new DriveSyncAdapter({
    encode: async (op) => { encoded++; return { sealed: op }; },
    decode: async (envelope) => envelope.sealed,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        assert.match(url, /uploadType=multipart/);
        assert.match(options.body, /"parents":\["appDataFolder"\]/);
        assert.match(options.body, /"sealed":/);
        assert.match(options.headers['Content-Type'], /^multipart\/related; boundary=/);
        published = true;
        return response(entry);
      }
      if (url.includes('alt=media')) return response({ sealed: operation });
      return response({ files: published ? [entry] : [] });
    },
  });
  assert.deepEqual(plain(await adapter.append(operation)), entry);
  assert.deepEqual(plain(await adapter.append(operation)), entry);
  assert.equal(encoded, 1);
  const before = calls.length;
  assert.deepEqual(plain(await adapter.append(operation, { entries: [entry] })), entry);
  assert.equal(calls.length, before + 1); // Read only; no redundant list.
  await assert.rejects(adapter.append({ ...operation, target: 'different' }, { entries: [entry] }),
    (e) => e.kind === 'format');
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
  assert.ok(calls.every((call) => !['PATCH', 'DELETE'].includes(call.options.method)));
  scenarios++;
}
{
  let tokens = 0, clears = 0, requests = 0;
  const adapter = new DriveSyncAdapter({
    getToken: async (interactive) => { assert.equal(interactive, false); return 'token-' + ++tokens; },
    clearToken: async () => { clears++; },
    fetchImpl: async (_, options) => {
      requests++;
      assert.equal(options.headers.Authorization, 'Bearer token-' + tokens);
      return requests === 1 ? response({}, 401) : response({ files: [] });
    },
  });
  await adapter.list();
  assert.equal(clears, 1);
  assert.equal(tokens, 2);
  requests = 0; clears = 0;
  adapter.fetchImpl = async () => { requests++; return response({}, 401); };
  await assert.rejects(adapter.list(), (e) => e instanceof SyncError && e.kind === 'auth');
  assert.equal(requests, 2);
  assert.equal(clears, 1);
  scenarios++;
}
for (const [status, kind, delay] of [[429, 'retry', '2'], [503, 'retry', null], [403, 'permission', null], [404, 'format', null]]) {
  const adapter = new DriveSyncAdapter({ fetchImpl: async () => response({ secret: 'never expose' }, status, delay) });
  await assert.rejects(adapter.list(), (error) => {
    assert.equal(error.kind, kind);
    assert.equal(error.retryAfter, delay ? 2000 : null);
    assert.ok(!error.message.includes('never expose'));
    return true;
  });
  scenarios++;
}
{
  const adapter = new DriveSyncAdapter({ fetchImpl: async () => response({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403) });
  await assert.rejects(adapter.list(), (e) => e.kind === 'retry');
  adapter.fetchImpl = async () => { throw new Error('sensitive transport detail'); };
  await assert.rejects(adapter.list(), (e) => e.kind === 'retry' && !e.message.includes('sensitive'));
  adapter.getToken = async () => { throw new Error('sensitive auth detail'); };
  await assert.rejects(adapter.initialize(), (e) => e.kind === 'auth' && !e.message.includes('sensitive'));
  scenarios++;
}
{
  const adapter = new DriveSyncAdapter({ fetchImpl: async () => response({ id: 'wrong' }) });
  await assert.rejects(adapter.read(entry), (e) => e.kind === 'format');
  await assert.rejects(adapter.append({}), (e) => e.kind === 'format');
  adapter.fetchImpl = async () => ({ ok: true, text: async () => 'not JSON' });
  await assert.rejects(adapter.list(), (e) => e.kind === 'format');
  adapter.fetchImpl = async () => response({ files: [], nextPageToken: 'repeat' });
  await assert.rejects(adapter.list(), (e) => e.kind === 'format');
  scenarios++;
}
{
  fakeTimeout = true;
  let signal;
  const adapter = new DriveSyncAdapter({ fetchImpl: async (_, options) => {
    signal = options.signal;
    return { ok: true, text: () => new Promise(() => {}) };
  } });
  const pending = adapter.list();
  // Token acquisition and response headers each introduce a microtask.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  timeoutCallback();
  await assert.rejects(pending, (e) => e.kind === 'retry');
  assert.equal(signal.aborted, true);
  fakeTimeout = false;
  scenarios++;
}
console.log('Drive sync adapter tests passed: ' + scenarios + ' scenarios');
