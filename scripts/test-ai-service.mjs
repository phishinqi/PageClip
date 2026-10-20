import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const storage = {};
globalThis.chrome = {
  runtime: { id: 'unit-test', getURL: (path) => `chrome-extension://unit-test/${path}` },
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(data) { Object.assign(storage, data); },
    async remove(key) { delete storage[key]; },
  } },
};
const source = await readFile(new URL('../js/ai-service.js', import.meta.url), 'utf8');
const { handleAiMessage: handle } = await import('../js/ai-service.js');
const options = { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') };
const organizer = { id: chrome.runtime.id, url: chrome.runtime.getURL('ai-organizer.html') };
let sequence = 0;
const call = (type, fields = {}, sender = options) => handle({ type, requestId: `test-${++sequence}`, ...fields }, sender);
const analyze = (fields = {}) => call('ai-analyze', { messages: [{ role: 'user', content: 'Unit test input' }], ...fields }, organizer);
const response = (content = 'OK') => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response(); };
assert.equal(await handle({ type: 'other' }, options), null);
assert.equal((await call('ai-config-status')).result.hasKey, false);
assert.equal((await call('ai-config-status')).result.baseUrl, 'http://127.0.0.1:3425/v1');
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'http://127.0.0.1:3425/v1/models');
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
  return new Response(JSON.stringify({ data: [{id:'model-b'}, {id:'model-a'}, {id:'model-a'}, {id:'bad\nmodel'}] }));
};
assert.deepEqual((await call('ai-models', {baseUrl:'http://127.0.0.1:3425/v1'})).result.models, ['model-a','model-b']);
assert.equal((await call('ai-models', {}, organizer)).code, 'FORBIDDEN');
assert.equal((await call('ai-config-save', {config:{baseUrl:'http://127.0.0.1:3425/v1',model:'model-a'}})).ok,true);
assert.equal(storage.pageclip_ai_config.apiKey, 'magpie');
delete storage.pageclip_ai_config;
globalThis.fetch = async (url, init) => { calls.push({url,init}); return response(); };
for (const sender of [{ ...options, id: 'other' }, { ...options, url: options.url + '?x' }, { ...options, url: 'https://example.test/options.html' }, organizer]) {
  assert.equal((await call('ai-config-save', {}, sender)).code, 'FORBIDDEN');
}
for (const baseUrl of ['http://example.test/v1', 'https://user:pass@example.test', 'https://example.test/?x', 'https://example.test/#x', 'file:///test']) {
  assert.equal((await call('ai-config-save', { config: { baseUrl, model: 'test', apiKey: 'mock-secret-value' } })).code, 'INVALID_CONFIG');
}
for (const baseUrl of ['http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1', 'https://example.test/v1/']) {
  const result = await call('ai-config-save', { config: { baseUrl, model: 'test', apiKey: 'mock-secret-value' } });
  assert.equal(result.ok, true);
  assert.equal(result.result.hasKey, true);
  assert.ok(!JSON.stringify(result).includes('mock-secret-value'));
}
assert.equal((await call('ai-config-status', {}, organizer)).result.baseUrl, 'https://example.test/v1');
assert.equal((await call('ai-config-save', { config: { baseUrl: 'https://example.test/v1', model: 'test', apiKey: '' } })).result.hasKey, true);
assert.equal((await call('ai-test', { messages: [{ role: 'user', content: 'BOOKMARK SHOULD NOT LEAK' }] })).ok, true);
assert.ok(!calls.at(-1).init.body.includes('BOOKMARK'));
assert.equal(calls.at(-1).init.redirect, 'error');
assert.equal((await analyze()).result.content, 'OK');
assert.equal(calls.at(-1).url, 'https://example.test/v1/chat/completions');
assert.equal(JSON.parse(calls.at(-1).init.body).stream, false);
assert.equal((await analyze({ messages: [{ role: 'user', content: 'a'.repeat(49 * 1024) }] })).code, 'REQUEST_TOO_LARGE');
assert.equal((await analyze({ messages: [{ role: 'tool', content: 'x' }] })).code, 'INVALID_REQUEST');
// Unsupported response_format is the only 400 compatibility fallback.
let count = 0;
globalThis.fetch = async (_url, init) => {
  count++;
  if (count === 1) return new Response(JSON.stringify({ error: { param: 'response_format', message: 'Unsupported parameter' } }), { status: 400 });
  assert.equal(JSON.parse(init.body).response_format, undefined);
  return response();
};
assert.equal((await analyze({ body: { messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_object' } } })).ok, true);
assert.equal(count, 2);
count = 0;
globalThis.fetch = async (url, init) => {
  count++;
  const body = JSON.parse(init.body);
  assert.ok(body.messages.some(m => m.content.includes('json')));
  if (count === 1) return new Response(JSON.stringify({error:{message:"Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'."}}),{status:400});
  assert.equal(body.response_format, undefined);
  return response();
};
assert.equal((await analyze({body:{messages:[{role:'user',content:'JSON please'}],response_format:{type:'json_object'}}})).ok,true);
assert.equal(count,2);
globalThis.fetch = async () => new Response(JSON.stringify({error:{message:'invalid parameters'}}),{status:400});
assert.equal((await analyze()).code,'BAD_REQUEST');
globalThis.fetch = async () => new Response('private provider text', { status: 401 });
const rejected = await analyze();
assert.equal(rejected.code, 'AUTH');
assert.ok(!JSON.stringify(rejected).includes('private'));
globalThis.fetch = async () => new Response('x'.repeat(128 * 1024 + 1));
assert.equal((await analyze()).code, 'RESPONSE_TOO_LARGE');
globalThis.fetch = async () => response('mock-secret-value');
assert.equal((await analyze()).code, 'INVALID_RESPONSE');
globalThis.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } });
assert.equal((await analyze()).code, 'RATE_LIMIT');
// Exercise retry timing without a real wait or network.
const realTimeout = globalThis.setTimeout;
const delays = [];
globalThis.setTimeout = (fn, ms, ...args) => { if (ms === 2000 || ms === 5000) { delays.push(ms); return realTimeout(fn, 0, ...args); } return realTimeout(fn, ms, ...args); };
count = 0;
globalThis.fetch = async () => { count++; if (count === 1) throw new TypeError('private network error'); if (count === 2) return new Response('{}', { status: 503 }); return response(); };
assert.equal((await analyze()).ok, true);
assert.equal(count, 3);
assert.deepEqual(delays, [2000, 5000]);
globalThis.setTimeout = realTimeout;
// In-flight and completed deduplication, global exclusion, cancellation.
count = 0;
globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => { count++; init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
const pending = analyze({ requestId: 'cancel-me' });
const duplicate = analyze({ requestId: 'cancel-me' });
await new Promise((resolve) => realTimeout(resolve, 0));
assert.equal(count, 1);
assert.equal((await analyze()).code, 'BUSY');
assert.equal((await call('ai-cancel', { targetRequestId: 'cancel-me' }, options)).code, 'FORBIDDEN');
assert.equal((await call('ai-cancel', { targetRequestId: 'cancel-me' }, organizer)).result.cancelled, true);
assert.equal((await pending).code, 'CANCELLED');
assert.deepEqual(await duplicate, await pending);
assert.deepEqual(await analyze({ requestId: 'cancel-me' }), await pending);
assert.equal(count, 1);
// Timeout returns fixed text.
globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 25000 ? 0 : ms, ...args);
assert.equal((await analyze()).code, 'TIMEOUT');
globalThis.setTimeout = realTimeout;
assert.equal((await call('ai-config-clear-key')).result.hasKey, false);
assert.equal((await call('ai-config-status')).result.baseUrl, 'https://example.test/v1');
assert.equal((await analyze()).code, 'NOT_CONFIGURED');
console.log('AI service mock tests passed (no network or real credentials).');
