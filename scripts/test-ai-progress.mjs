import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { progressOf, beginProgressRun, beginProgressBatch, finishProgressBatch } from '../js/ai-progress.js';

const items = (size, offset = 0) => Array.from({ length: size }, (_, i) => ({ itemId: `item-${i + offset}` }));
const fresh = size => ({ pending: items(size), suggestions: [], failed: [], started: true, phase: 'analyzing' });
function complete(task, size, now, fail = false) {
  const batch = task.pending.splice(0, size);
  if (fail) task.failed.push({ items: batch, code: 'NETWORK' });
  else task.suggestions.push(...batch);
  finishProgressBatch(task, batch.length, now);
}
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

// Empty and legacy records need neither migrations nor persisted derived counters.
assert.deepEqual(progressOf(undefined, 0), {
  total: 0, processed: 0, succeeded: 0, failed: 0, pending: 0,
  percent: 0, batchIndex: 0, batchSize: 0, waitSeconds: 0, remainingSeconds: null, state: 'idle',
});
assert.deepEqual(progressOf(null, 0), progressOf({}, 0));
const old = frozen({
  started: true,
  pending: [{ itemId: 'p' }, { itemId: 'p' }, { id: 'raw' }, { itemId: 'ok' }, { itemId: 'bad' }, null, {}],
  suggestions: [{ itemId: 'ok' }, { itemId: 'ok' }],
  failed: [{ items: [{ itemId: 'bad' }, { itemId: 'bad' }, { itemId: 'ok' }] }, { items: [{ itemId: 'bad' }] }],
  before: { excludedLocalItem: {} },
});
assert.deepEqual(progressOf(old, 100000), {
  total: 4, processed: 2, succeeded: 1, failed: 1, pending: 2,
  percent: 50, batchIndex: 0, batchSize: 0, waitSeconds: 0, remainingSeconds: null, state: 'paused',
});
assert.equal(progressOf({ ...old, total: 10 }).pending, 8);
assert.equal(progressOf({ ...old, total: 1 }).total, 4);
assert.equal(progressOf({ ...old, pending: 'bad', failed: [null, {}] }).total, 1);
assert.equal(progressOf({ ...old, total: Infinity }).total, 4);
assert.equal(progressOf({ total: 3, started: true }).pending, 3);
assert.equal(progressOf({ total: -1 }).percent, 0);

// 1,367 items must not report a simulated batch count derived from total / 20.
const large = fresh(1367);
assert.strictEqual(beginProgressRun(large, 0), large);
assert.equal(large.sampleStartedAt, 0);
assert.equal(large.sampleProcessed, 0);
assert.equal(progressOf(large, 0).remainingSeconds, null);
assert.strictEqual(beginProgressBatch(large, 20, 0), large);
assert.equal(progressOf(large, 1001).waitSeconds, 2);
assert.equal(progressOf(large, 600000).remainingSeconds, null);
complete(large, 20, 10000);
let p = progressOf(large, 10000);
assert.equal(p.total, 1367);
assert.equal(p.processed, 20);
assert.equal(p.pending, 1347);
assert.equal(p.percent, 20 / 1367 * 100);
assert.equal(p.batchIndex, 1);
assert.equal(p.batchSize, 20);
assert.equal(p.remainingSeconds, 674);
assert.equal(p.waitSeconds, 0);
assert.equal(large.sampleDuration, 10000);
assert.equal(large.sampleProcessed, 20);

// Exercise the complete large task, including its final seven-item request.
const full = fresh(1367);
beginProgressRun(full, 0);
let fullNow = 0;
while (full.pending.length) {
  const size = Math.min(20, full.pending.length);
  beginProgressBatch(full, size, fullNow);
  fullNow += 1000;
  complete(full, size, fullNow);
}
full.phase = 'review';
assert.equal(progressOf(full, fullNow).processed, 1367);
assert.equal(progressOf(full, fullNow).pending, 0);
assert.equal(progressOf(full, fullNow).percent, 100);
assert.equal(progressOf(full, fullNow).batchIndex, 69);
assert.equal(progressOf(full, fullNow).batchSize, 7);
assert.equal(progressOf(full, fullNow).remainingSeconds, 0);

// A long second request increases wait only: it earns no speculative progress.
beginProgressBatch(large, 20, 12000);
const beforeWait = progressOf(large, 12000);
const afterWait = progressOf(large, 612000);
assert.equal(afterWait.waitSeconds, 600);
for (const key of ['processed', 'pending', 'percent', 'remainingSeconds']) assert.equal(afterWait[key], beforeWait[key]);
complete(large, 20, 612000, true);
p = progressOf(large, 612000);
assert.equal(p.processed, 40);
assert.equal(p.succeeded, 20);
assert.equal(p.failed, 20);
assert.equal(p.remainingSeconds, Math.ceil(1327 * 610000 / 40 / 1000));
assert.equal(large.sampleDuration, 610000);

// Actual byte-constrained batches may be much smaller than the 20-item ceiling.
const small = fresh(9);
beginProgressRun(small, 1000);
let now = 1000;
for (const [index, size] of [3, 1, 2, 3].entries()) {
  beginProgressBatch(small, size, now);
  p = progressOf(small, now);
  assert.equal(p.batchIndex, index + 1);
  assert.equal(p.batchSize, size);
  complete(small, size, now + size * 1000, index === 1);
  now += size * 1000 + 20000; // UI/persistence time between batches is not sampled.
  assert.equal(small.sampleDuration, small.sampleProcessed * 1000);
  assert.equal(progressOf(small, now).remainingSeconds, 9 - small.sampleProcessed);
}
assert.equal(progressOf(small).processed, 9);
assert.equal(progressOf(small).percent, 100);
assert.equal(progressOf(small).failed, 1);
assert.equal(progressOf(small).batchIndex, 4);

// Moving failures back to pending reduces processed immediately, without overlap.
large.pending.push(...large.failed.flatMap(f => f.items));
large.failed = [];
p = progressOf(large, 700000);
assert.equal(p.total, 1367);
assert.equal(p.processed, 20);
assert.equal(p.failed, 0);
assert.equal(p.pending, 1347);
large.phase = 'paused';
assert.equal(progressOf(large, 10000000).waitSeconds, 0);
beginProgressRun(large, 10000000);
assert.equal(large.sampleStartedAt, 10000000);
assert.equal(large.sampleBaselineProcessed, 20);
assert.equal(large.sampleDuration, 0);
assert.equal(large.sampleProcessed, 0);
assert.equal(progressOf(large, 10000000).remainingSeconds, null);
assert.equal(large.batchIndex, 2);
large.phase = 'analyzing';
beginProgressBatch(large, 5, 10001000);
complete(large, 5, 10002000);
assert.equal(large.sampleProcessed, 5);
assert.equal(large.sampleDuration, 1000);
assert.equal(progressOf(large, 10002000).remainingSeconds, 269);
assert.equal(progressOf(large, 10002000).batchIndex, 3);

// A discarded in-flight request, restored after a long pause, contributes no time.
const resumed = fresh(10);
beginProgressRun(resumed, 0);
beginProgressBatch(resumed, 2, 0);
resumed.phase = 'cancelled';
assert.equal(progressOf(resumed, 9999999).waitSeconds, 0);
beginProgressRun(resumed, 10000000);
resumed.phase = 'analyzing';
beginProgressBatch(resumed, 2, 10000100);
complete(resumed, 2, 10002100, true);
assert.equal(resumed.sampleDuration, 2000);
assert.equal(resumed.sampleProcessed, 2);
assert.equal(progressOf(resumed).remainingSeconds, 8);
const snapshot = structuredClone(resumed);
finishProgressBatch(resumed, 2, 20000000); // Repeated finish is harmless.
assert.deepEqual(resumed, snapshot);

// Duplicate completed IDs and overstated caller counts cannot inflate speed.
const duplicate = fresh(3);
beginProgressRun(duplicate, 0);
beginProgressBatch(duplicate, 1, 0);
duplicate.suggestions.push({ itemId: 'item-0' }, { itemId: 'item-0' });
finishProgressBatch(duplicate, 999, 1000);
assert.equal(duplicate.sampleProcessed, 1);
assert.equal(progressOf(duplicate).processed, 1);
beginProgressBatch(duplicate, 1, 2000);
duplicate.suggestions.push({ itemId: 'item-0' });
finishProgressBatch(duplicate, 1, 3000);
assert.equal(duplicate.sampleProcessed, 1);
assert.equal(duplicate.sampleDuration, 1000);
assert.equal(progressOf(duplicate).total, 3);

// Clock adjustments cannot create negative waits, durations, or infinite ETAs.
const clock = fresh(2);
beginProgressBatch(clock, 1, 1000); // Helpers reconstruct missing timing fields.
assert.equal(clock.sampleStartedAt, 1000);
assert.equal(progressOf(clock, 0).waitSeconds, 0);
complete(clock, 1, 500);
assert.equal(clock.sampleDuration, 0);
assert.equal(progressOf(clock, 500).remainingSeconds, null);

// Explicit phases belong to the UI, and always win over inferred legacy state.
for (const state of ['idle', 'analyzing', 'paused', 'cancelled', 'review', 'failed', 'confirmed']) {
  assert.equal(progressOf({ ...old, phase: state, applied: true }, 123).state, state);
}
for (const [task, state] of [
  [{}, 'idle'],
  [{ started: true, pending: items(1) }, 'paused'],
  [{ pending: items(1), requestStartedAt: 0 }, 'analyzing'],
  [{ paused: true, requestStartedAt: 0 }, 'paused'],
  [{ cancelled: true }, 'cancelled'],
  [{ suggestions: items(1) }, 'review'],
  [{ suggestions: items(1), failed: [{ items: items(1, 1) }] }, 'failed'],
  [{ applied: true }, 'confirmed'],
  [{ confirmed: true }, 'confirmed'],
]) assert.equal(progressOf(task, 1000).state, state);

// Read calls are repeatable, read-only, and the module has no scheduling/storage API.
const serialized = JSON.stringify(large);
assert.deepEqual(progressOf(frozen(structuredClone(large)), 10003000), progressOf(large, 10003000));
assert.equal(JSON.stringify(large), serialized);
const source = await readFile(new URL('../js/ai-progress.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|requestAnimationFrame|addEventListener|chrome|document|window|fetch)\b/);
console.log('AI progress tests passed: 1367 items, unique counts, actual batches, wait/ETA, retry, resume, legacy tasks and purity');
