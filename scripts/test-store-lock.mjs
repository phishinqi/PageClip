import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/store.js', import.meta.url), 'utf8');
const executable = source.replace(/^export\s+/gm, '') + '\n globalThis.__storeTest = { mutate, withDataLock, STORAGE_KEY };';
const saved = { bc_data: { n: 0, changes: [] } };
const context = {
  URL,
  crypto: { randomUUID: () => 'id' },
  chrome: { storage: { local: {
    async get(key) { await new Promise((resolve) => setTimeout(resolve, 1)); return { [key]: structuredClone(saved[key]) }; },
    async set(value) { await new Promise((resolve) => setTimeout(resolve, 1)); Object.assign(saved, structuredClone(value)); },
  } } },
  setTimeout,
  structuredClone,
  Promise,
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'store.js' });
const store = context.__storeTest;
await Promise.all([
  store.mutate((data) => { data.n++; data.changes.push('first'); }),
  store.mutate((data) => { data.n++; data.changes.push('second'); }),
]);
assert.equal(saved.bc_data.n, 2);
assert.deepEqual([...saved.bc_data.changes].sort(), ['first', 'second']);
await assert.rejects(() => store.withDataLock(() => { throw new Error('expected'); }), /expected/);
await store.mutate((data) => { data.changes.push('after-error'); });
assert.equal(saved.bc_data.changes.includes('after-error'), true);
console.log('Store lock tests passed: serialized mutations and error release');
