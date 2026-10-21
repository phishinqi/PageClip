import assert from 'node:assert/strict';
import { createStatusRefresh } from '../js/settings-status-refresh.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function clock() {
  let id = 0;
  const work = new Map();
  return { setTimer: fn => { work.set(++id, fn); return id; }, clearTimer: id => work.delete(id), flush() { const tasks = [...work.values()]; work.clear(); tasks.forEach(fn => fn()); }, get size() { return work.size; } };
}
{
  const c = clock(), applied = []; let reads = 0;
  const refresh = createStatusRefresh({ ...c, read: async () => ++reads, apply: s => applied.push(s) });
  for (let n = 0; n < 50; n++) refresh.request();
  assert.equal(c.size, 1); c.flush(); await tick();
  assert.equal(reads, 1); assert.deepEqual(applied, [1]);
}
{
  const c = clock(), first = deferred(), applied = []; let reads = 0;
  const refresh = createStatusRefresh({ ...c, read: () => ++reads === 1 ? first.promise : Promise.resolve('new'), apply: s => applied.push(s) });
  refresh.request(); c.flush();
  refresh.request(); refresh.request(); first.resolve('stale'); await tick();
  assert.equal(reads, 2); assert.deepEqual(applied, ['new'], 'an in-flight older state must not flash over a newer authorization/backup');
}
{
  const c = clock(), applied = []; let visible = false, reads = 0;
  const refresh = createStatusRefresh({ ...c, visible: () => visible, read: async () => ++reads, apply: s => applied.push(s) });
  refresh.request(); assert.equal(c.size, 0); assert.equal(reads, 0);
  visible = true; refresh.request({ immediate: true }); c.flush(); await tick();
  assert.deepEqual(applied, [1]);
  const pending = deferred();
  const hiding = createStatusRefresh({ ...c, visible: () => visible, read: () => pending.promise, apply: s => applied.push(s) });
  hiding.request(); c.flush(); visible = false; pending.resolve('hidden'); await tick();
  assert.deepEqual(applied, [1], 'hidden pages must not publish an in-flight state');
}
{
  const c = clock(), errors = [], applied = []; let failed = true;
  const refresh = createStatusRefresh({ ...c, read: async () => { if (failed) throw Error('unavailable'); return 'recovered'; }, apply: s => applied.push(s), onError: e => errors.push(e.message) });
  refresh.request(); c.flush(); await tick(); assert.deepEqual(errors, ['unavailable']);
  assert.equal(c.size, 0, 'status errors must not spin in a retry loop');
  failed = false; refresh.request(); c.flush(); await tick(); assert.deepEqual(applied, ['recovered']);
  refresh.request(); refresh.stop(); c.flush(); await tick(); assert.deepEqual(applied, ['recovered']);
}
console.log('Settings live status tests passed: burst coalescing, stale read suppression, hidden/focus resume, error recovery, cancellation');
