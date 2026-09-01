import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/bookmark-pagination.js', import.meta.url), 'utf8');
const executable = source.replace(/^export\s+/gm, '')
  + '\n globalThis.__bookmarkPaging = { BOOKMARK_PAGE_SIZE, initialBookmarkPageSize, clampBookmarkPageSize, nextBookmarkPageSize, reconcileBookmarkPageSizes };';
const context = {};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'bookmark-pagination.js' });
const paging = context.__bookmarkPaging;

assert.equal(paging.BOOKMARK_PAGE_SIZE, 100);
assert.equal(paging.initialBookmarkPageSize(250), 100);
assert.equal(paging.initialBookmarkPageSize(1000), 100);
assert.equal(paging.initialBookmarkPageSize(40), 40);
assert.equal(paging.nextBookmarkPageSize(100, 250), 200);
assert.equal(paging.nextBookmarkPageSize(200, 250), 250);
assert.equal(paging.nextBookmarkPageSize(900, 1000), 1000);
assert.equal(paging.clampBookmarkPageSize(700, 250), 250);

// 每个文件夹分别记录进度：父级和嵌套目录不会相互影响。
const sessionCounts = new Map([
  ['root-folder', 200],
  ['nested-folder', 100],
]);
assert.equal(paging.nextBookmarkPageSize(sessionCounts.get('root-folder'), 250), 250);
assert.equal(paging.nextBookmarkPageSize(sessionCounts.get('nested-folder'), 1000), 200);
assert.equal(sessionCounts.get('root-folder'), 200); // 折叠 / 重新展开前保留原进度。

// 刷新时删除不存在的文件夹，并把保留目录的数量截断到新的子项总数。
const reconciled = paging.reconcileBookmarkPageSizes(sessionCounts, new Map([
  ['root-folder', 120],
  ['nested-folder', 1300],
  ['new-folder', 500],
]));
assert.equal(JSON.stringify([...reconciled]), JSON.stringify([
  ['root-folder', 120],
  ['nested-folder', 100],
]));

console.log('Bookmark pagination tests passed: paging, nested independence, session retention, and refresh reconciliation');
