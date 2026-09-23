import assert from 'node:assert/strict';
import { removeChromeBookmarksForItems } from '../js/chrome-bookmark-sync.js';

function fakeBookmarks(nodes, { failing = [], changed = [] } = {}) {
  const bookmarks = new Map(nodes.map((node) => [node.id, node]));
  const removed = [];
  let treeReads = 0;
  return {
    removed,
    get treeReads() { return treeReads; },
    async getTree() {
      treeReads++;
      return [{ id: '0', children: [{ id: '1', children: [...bookmarks.values()] }] }];
    },
    async get(id) {
      const node = bookmarks.get(id);
      if (!node) return [];
      return [{ ...node, url: changed.includes(id) ? 'https://edited.example' : node.url }];
    },
    async remove(id) {
      if (failing.includes(id)) throw new Error('Chrome rejected deletion');
      removed.push(id);
      bookmarks.delete(id);
    },
  };
}

const api = fakeBookmarks([
  { id: '101', url: 'https://example.com/' },
  { id: '102', url: 'https://example.com/' },
  { id: '201', url: 'https://other.example/' },
  { id: '301', url: 'https://different.example/' },
]);
const result = await removeChromeBookmarksForItems([
  { url: 'https://example.com', chromeBookmarkIds: ['stale', '201'] },
  { url: 'https://example.com/' }, // Legacy PageClip entry without any IDs.
  { url: 'https://other.example' },
], api);
assert.deepEqual(result, { removed: 3, failed: 0 });
assert.deepEqual(api.removed, ['101', '102', '201']);
assert.equal(api.treeReads, 1);

const mismatch = fakeBookmarks([
  { id: '401', url: 'https://example.com/?q=2' },
  { id: '402', url: 'https://example.com/?q=1' },
], { changed: ['402'] });
assert.deepEqual(await removeChromeBookmarksForItems([{ url: 'https://example.com/?q=1' }], mismatch), { removed: 0, failed: 0 });
assert.deepEqual(mismatch.removed, []);

const failed = fakeBookmarks([{ id: '501', url: 'https://failure.example/' }], { failing: ['501'] });
assert.deepEqual(await removeChromeBookmarksForItems([{ url: 'https://failure.example' }], failed), { removed: 0, failed: 1 });
assert.deepEqual(await removeChromeBookmarksForItems([], failed), { removed: 0, failed: 0 });
assert.equal(failed.treeReads, 1);
await assert.rejects(() => removeChromeBookmarksForItems([{ url: 'https://x.example' }], {
  async getTree() { throw new Error('unavailable'); }, async get() {}, async remove() {},
}), /unavailable/);
console.log('Chrome bookmark deletion tests passed: URL fallback, duplicates, exact matching, and failures');
