import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mutate, loadData, removeItems } from '../js/store.js';
import { removeChromeBookmarksForItems } from '../js/chrome-bookmark-sync.js';

// Exercise the same mock APIs used by the local preview, without opening a browser.
const source = await readFile(new URL('../dev/mock.js', import.meta.url), 'utf8');
const storage = new Map();
const window = { fetch: async () => new Response('{}') };
vm.runInNewContext(source, {
  window, localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  },
  URL, Response, TextEncoder, Date, setTimeout, console,
});
globalThis.chrome = window.chrome;
const url = 'https://pageclip-preview-delete.example/';
const first = await chrome.bookmarks.create({ parentId: '1', url, title: 'First copy' });
const second = await chrome.bookmarks.create({ parentId: '1', url, title: 'Second copy' });
await mutate((data) => {
  data.items.push({ id: 'preview-delete', url, title: 'Preview delete', folderId: 'f_uncategorized' });
});
const result = await removeItems(['preview-delete'], { beforeRemove: async (items) => {
  const cleaned = await removeChromeBookmarksForItems(items);
  assert.equal(cleaned.failed, 0);
  assert.equal(cleaned.removed, 2);
} });
assert.equal(result.count, 1);
assert.equal((await loadData()).items.some((item) => item.id === 'preview-delete'), false);
const ids = (await chrome.bookmarks.getTree())[0].children.flatMap((node) => node.children || []).map((node) => node.id);
assert.equal(ids.includes(first.id), false);
assert.equal(ids.includes(second.id), false);
console.log('Preview integration passed: PageClip deletion removes every matching Chrome bookmark');
