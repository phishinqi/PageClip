import assert from 'node:assert/strict';
import {
  defaultData, loadData, removeItems, removeFolder, restoreRecycleEntry,
} from '../js/store.js';
import { removeChromeBookmarksForItems } from '../js/chrome-bookmark-sync.js';

const data = defaultData();
data.folders.push({ id: 'parent', name: 'Parent', parentId: null }, { id: 'child', name: 'Child', parentId: 'parent' });
data.items.push(
  { id: 'first', title: 'First', url: 'https://first.example', folderId: 'parent' },
  { id: 'keep', title: 'Keep', url: 'https://keep.example', folderId: 'f_uncategorized' },
  { id: 'last', title: 'Last', url: 'https://last.example', folderId: 'child' },
);
let saved = structuredClone(data);
let failStorage = false;
const bookmarks = new Map([
  ['a', 'https://first.example/'], ['b', 'https://last.example/'],
  ['c', 'https://keep.example/'],
]);
let failBookmark = null;
globalThis.chrome = {
  storage: { local: {
    async get() { return { bc_data: structuredClone(saved) }; },
    async set(value) {
      if (failStorage) throw new Error('storage full');
      saved = structuredClone(value.bc_data);
    },
  } },
  bookmarks: {
    async getTree() { return [{ id: '0', children: [...bookmarks].map(([id, url]) => ({ id, url })) }]; },
    async get(id) { return bookmarks.has(id) ? [{ id, url: bookmarks.get(id) }] : []; },
    async remove(id) {
      if (id === failBookmark) throw new Error('cannot delete');
      bookmarks.delete(id);
    },
  },
};
const cleanup = async (items) => {
  const result = await removeChromeBookmarksForItems(items);
  if (result.failed) throw new Error('Chrome deletion failed');
};
failBookmark = 'b';
await assert.rejects(() => removeItems(['first', 'last'], { beforeRemove: cleanup }), /Chrome deletion failed/);
assert.deepEqual((await loadData()).items.map((item) => item.id), ['first', 'keep', 'last']);
assert.equal(bookmarks.has('a'), false); // Partial Chrome cleanup is retryable.
assert.equal(bookmarks.has('b'), true);
failBookmark = null;
const removed = await removeItems(['first', 'last'], { beforeRemove: cleanup });
assert.equal(removed.count, 2);
assert.deepEqual((await loadData()).items.map((item) => item.id), ['keep']);
assert.equal(bookmarks.has('b'), false);
assert.equal(bookmarks.has('c'), true);
await restoreRecycleEntry(removed.recycle.id);
assert.deepEqual((await loadData()).items.map((item) => item.id), ['first', 'keep', 'last']);

bookmarks.set('d', 'https://last.example/');
failBookmark = 'd';
await assert.rejects(() => removeFolder('parent', { beforeRemove: cleanup }), /Chrome deletion failed/);
assert.equal((await loadData()).folders.some((folder) => folder.id === 'child'), true);
assert.equal((await loadData()).items.length, 3);
failBookmark = null;
const folderResult = await removeFolder('parent', { beforeRemove: cleanup });
assert.equal(folderResult.movedItems, 2);
assert.deepEqual((await loadData()).items.map((item) => item.id), ['keep']);
assert.equal(bookmarks.has('c'), true);

// Storage failure leaves PageClip entries intact, so a retry is still possible.
failStorage = true;
await assert.rejects(() => removeItems(['keep'], { beforeRemove: cleanup }), /storage full/);
failStorage = false;
assert.deepEqual((await loadData()).items.map((item) => item.id), ['keep']);
assert.equal(bookmarks.has('c'), false);
console.log('Collection deletion tests passed: batch, recovery, folder cleanup, partial failure, storage failure');
