import assert from 'node:assert/strict';
import { removeChromeBookmarksForItems } from '../js/chrome-bookmark-sync.js';

const removed = [];
const result = await removeChromeBookmarksForItems([
  { url: 'https://example.com', chromeBookmarkIds: ['101', '102'] },
  { url: 'https://example.com', chromeBookmarkIds: ['102'] },
  { url: 'https://other.example', chromeBookmarkIds: ['201'] },
], {
  async get(id) {
    return [{ id, url: id === '201' ? 'https://other.example' : 'https://example.com' }];
  },
  async remove(id) { removed.push(id); },
});
assert.deepEqual(result, { removed: 3, failed: 0 });
assert.deepEqual(removed, ['101', '102', '201']);

const wrongUrl = await removeChromeBookmarksForItems([{ url: 'https://expected.example', chromeBookmarkIds: ['301'] }], {
  async get() { return [{ id: '301', url: 'https://different.example' }]; },
  async remove() { throw new Error('must not remove a mismatched URL'); },
});
assert.deepEqual(wrongUrl, { removed: 0, failed: 0 });

const legacy = await removeChromeBookmarksForItems([{ url: 'https://legacy.example' }], {
  async get() { throw new Error('must not query without a bookmark ID'); },
  async remove() { throw new Error('must not remove without a bookmark ID'); },
});
assert.deepEqual(legacy, { removed: 0, failed: 0 });

const failed = await removeChromeBookmarksForItems([{ url: 'https://failure.example', chromeBookmarkIds: ['401'] }], {
  async get() { throw new Error('bookmark disappeared'); },
  async remove() {},
});
assert.deepEqual(failed, { removed: 0, failed: 1 });

console.log('Chrome bookmark ID deletion tests passed: ID matching, URL validation, and failures');
