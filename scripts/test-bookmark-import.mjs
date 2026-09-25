import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { folderTagName, tagsForNewItem } from '../js/tag-model.js';

const source = await readFile(new URL('../js/bookmark-import.js', import.meta.url), 'utf8');
const executable = source.replace(/^import[^;]+;\s*/gm, '').replace(/^export\s+/gm, '')
  + '\n globalThis.__bookmarkImport = { flattenBrowserBookmarkTree, importBrowserBookmarks, mergeBrowserBookmarks };';

const data = {
  folders: [{ id: 'f_uncategorized', name: '未分类', parentId: null, system: true, order: 0 }],
  items: [{ id: 'existing', url: 'https://existing.example', title: 'Keep this title', folderId: 'f_uncategorized', tags: ['keep'], note: 'owned', pinned: true, order: 0, createdAt: 1, updatedAt: 2 }],
};
let failSave = false;
const context = {
  TextEncoder,
  chrome: { storage: { local: { QUOTA_BYTES: 10_000_000, async getBytesInUse() { return 0; } } } },
  genId: (() => { let id = 0; return (prefix) => `${prefix}_${++id}`; })(),
  UNCATEGORIZED_ID: 'f_uncategorized',
  isCollectableUrl: (url) => /^(https?:\/\/|file:\/\/)/.test(String(url)),
  folderTagName,
  tagsForNewItem,
  mutate: async (fn) => {
    const copy = structuredClone(data);
    const result = await fn(copy);
    if (failSave) throw new Error('storage write failed');
    Object.assign(data, copy);
    return result;
  },
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'bookmark-import.js' });

const tree = [{ id: '0', children: [{ id: '1', title: 'A / B', children: [{ id: '2', title: 'C', children: [{ id: '3', title: 'New', url: 'https://new.example', dateAdded: 1234 }] }] }, { id: '4', title: 'A', children: [{ id: '5', title: 'B / C', children: [{ id: '6', title: 'Duplicate', url: 'https://new.example' }, { id: '7', title: 'Existing', url: 'https://existing.example' }, { id: '8', title: 'Invalid', url: 'chrome://settings' }] }] }] }];
const flat = context.__bookmarkImport.flattenBrowserBookmarkTree(tree);
assert.equal(flat.folders.length, 4);
assert.equal(flat.items.length, 4);

const first = await context.__bookmarkImport.mergeBrowserBookmarks(tree);
assert.deepEqual(structuredClone(first), { foldersAdded: 4, itemsAdded: 1, duplicatesSkipped: 2, invalidSkipped: 1, mode: 'merge' });
const imported = data.items.find((item) => item.url === 'https://new.example');
assert.equal(imported.createdAt, 1234);
assert.deepEqual(structuredClone(imported.chromeBookmarkIds), ['3', '6']);
assert.equal(data.items.find((item) => item.id === 'existing').title, 'Keep this title');
assert.deepEqual(data.items.find((item) => item.id === 'existing').tags, ['keep']);
assert.deepEqual(structuredClone(data.items.find((item) => item.id === 'existing').chromeBookmarkIds), ['7']);
assert.equal(data.folders.filter((folder) => folder.name === 'A / B').length, 1);
assert.equal(data.folders.filter((folder) => folder.name === 'A').length, 1);

const second = await context.__bookmarkImport.mergeBrowserBookmarks(tree);
assert.deepEqual(structuredClone(second), { foldersAdded: 0, itemsAdded: 0, duplicatesSkipped: 3, invalidSkipped: 1, mode: 'merge' });

const beforeFailure = structuredClone(data);
failSave = true;
await assert.rejects(() => context.__bookmarkImport.mergeBrowserBookmarks([{ id: '0', children: [{ id: 'new-folder', title: 'Will fail', children: [{ id: 'new-item', title: 'Fail', url: 'https://fail.example' }] }] }]), /storage write failed/);
assert.deepEqual(data, beforeFailure);
failSave = false;

// 导入的新条目：并入同网址 Chrome 书签上已有的标签，并按规则加标签；根目录（书签栏）不产生文件夹标签。
data.urlTags = { 'https://tagged.example/': ['旧标签'] };
data.settings = { tagRules: { folder: true, domains: [{ domain: 'tagged.example', tags: ['域名'] }] } };
await context.__bookmarkImport.mergeBrowserBookmarks([{ id: '0', children: [{ id: 'bar', title: '书签栏', children: [
  { id: 'work', title: '工作', children: [{ id: 't1', title: 'Tagged', url: 'https://tagged.example/' }] },
  { id: 't2', title: 'Top', url: 'https://top.tagged.example/' },
] }] }]);
assert.deepEqual(structuredClone(data.items.find((item) => item.url === 'https://tagged.example/').tags), ['旧标签', '域名', '工作']);
assert.deepEqual(structuredClone(data.items.find((item) => item.url === 'https://top.tagged.example/').tags), ['域名']);
assert.equal(data.urlTags['https://tagged.example/'], undefined);
assert.deepEqual(data.items.find((item) => item.id === 'existing').tags, ['keep']);

console.log('Bookmark import tests passed: idempotent additive merge, safe paths, owned metadata, failed-save atomicity, and imported tags');
