import assert from 'node:assert/strict';
import {
  addTags, editTags, renameInTags, normalizeDomain, normalizeTagRules, ruleTagsFor, folderTagName,
  collectionFolderName, bookmarkRuleEntries, countTags,
} from '../js/tag-model.js';
import {
  defaultData, ensureDataInitialized, loadData, collectIntoStorage, editTagsForUrls, restoreTagSnapshot,
  renameTag, deleteTag, updateTagRules, applyTagRulesToExisting, applyTagRulesToBookmarks, pruneUrlTags,
  setBookmarkTags, updateItem, exportPayload, importPayload, getStats,
} from '../js/store.js';

let saved = null;
globalThis.chrome = {
  storage: { local: {
    async get() { return saved ? { bc_data: structuredClone(saved) } : {}; },
    async set(value) { saved = structuredClone(value.bc_data); },
  } },
};
function reset(prepare) {
  const data = defaultData();
  prepare?.(data);
  saved = structuredClone(data);
}
const item = (data, id) => data.items.find((entry) => entry.id === id);
const twelve = Array.from({ length: 12 }, (_, i) => `f${i}`);

// ———— 纯函数 ————

const eleven = twelve.slice(0, 11);
assert.deepEqual(addTags(eleven, ['F0', 'new', 'extra']), { tags: [...eleven, 'new'], skipped: 1 });
assert.deepEqual(editTags(['a', 'b'], { add: ['c'], remove: ['A'] }), { tags: ['b', 'c'], skipped: 0, changed: true });
assert.deepEqual(editTags(['a', 'b'], { replace: true, add: ['x'] }).tags, ['x']);
assert.equal(editTags(['a'], { add: ['A'] }).changed, false);
assert.deepEqual(renameInTags(['react', 'js', 'React.js'], 'REACT', 'js'), { tags: ['js', 'React.js'], changed: true });
assert.deepEqual(renameInTags(['react'], 'react', 'React'), { tags: ['React'], changed: true });

assert.equal(normalizeDomain('https://www.GitHub.com/path'), 'github.com');
assert.equal(normalizeDomain('*.example.org'), 'example.org');
assert.equal(normalizeDomain('gist.github.com'), 'gist.github.com');
assert.equal(normalizeDomain('not a domain'), '');
assert.equal(normalizeDomain('例子.中国'), new URL('http://例子.中国').hostname);

const rules = normalizeTagRules({
  folder: true,
  domains: [{ domain: 'github.com', tags: ['GitHub'] }, { domain: '', tags: ['dropped'] }, { domain: 'a.example', tags: [] }],
  keywords: [{ keyword: 'react', tags: ['React', 'GitHub'] }],
});
assert.equal(rules.autoApply, true);
assert.equal(rules.domains.length, 1);
assert.deepEqual(ruleTagsFor({ url: 'https://gist.github.com/x', title: 'Learn React hooks', folderName: '前端' }, rules), ['GitHub', 'React', '前端']);
assert.deepEqual(ruleTagsFor({ url: 'https://notgithub.com/', title: 'Other', folderName: '' }, rules), []);

assert.equal(folderTagName('书签栏'), '');
assert.equal(folderTagName('Bookmarks Bar'), '');
assert.equal(folderTagName('#工作'), '工作');
const folderData = { folders: [
  { id: 'f_uncategorized', name: '未分类', parentId: null, system: true },
  { id: 'root', name: 'Imported root', parentId: null, imported: true },
  { id: 'work', name: '工作', parentId: 'root', imported: true },
  { id: 'mine', name: '我的', parentId: null },
] };
assert.equal(collectionFolderName(folderData, 'f_uncategorized'), '');
assert.equal(collectionFolderName(folderData, 'root'), '');
assert.equal(collectionFolderName(folderData, 'work'), '工作');
assert.equal(collectionFolderName(folderData, 'mine'), '我的');
const tree = [{ id: '0', children: [{ id: '1', parentId: '0', title: 'My toolbar', children: [
  { id: '10', parentId: '1', title: 'Top', url: 'https://top.example/' },
  { id: '11', parentId: '1', title: '工作', children: [{ id: '110', parentId: '11', title: 'Deep', url: 'https://deep.example/' }] },
] }] }];
assert.deepEqual(bookmarkRuleEntries(tree).map((entry) => entry.folderName), ['', '工作']);

const countData = {
  items: [{ url: 'https://a.example/', tags: ['React'] }, { url: 'https://b.example/', tags: ['react', 'js'] }],
  urlTags: { 'https://c.example/': ['React'], 'https://gone.example/': ['js'] },
};
assert.deepEqual(countTags(countData), [{ name: 'React', count: 3 }, { name: 'js', count: 2 }]);
assert.deepEqual(countTags(countData, { liveUrls: new Set(['https://c.example/']) }), [{ name: 'React', count: 3 }, { name: 'js', count: 1 }]);

// ———— 初始化：规范化 urlTags，同网址已在收藏里时并入条目 ————

reset((data) => {
  data.items.push({ id: 'i1', url: 'https://shared.example/', title: 'Shared', folderId: 'f_uncategorized', tags: ['a'] });
  data.urlTags = { 'https://shared.example': ['b'], 'https://chrome-only.example/': ['c', 'C', '#d'], 'https://empty.example/': [] };
});
await ensureDataInitialized();
let data = await loadData();
assert.deepEqual(item(data, 'i1').tags, ['a', 'b']);
assert.deepEqual(data.urlTags, { 'https://chrome-only.example/': ['c', 'd'] });

// ———— 新收藏：继承 Chrome 书签上的标签，并按规则加标签 ————

await updateTagRules({ domains: [{ domain: 'chrome-only.example', tags: ['rule'] }] });
const collected = await collectIntoStorage({ url: 'https://chrome-only.example/', title: 'Chrome only' });
assert.deepEqual(collected.item.tags, ['c', 'd', 'rule']);
data = await loadData();
assert.equal(data.urlTags['https://chrome-only.example/'], undefined);
await updateTagRules({ autoApply: false, domains: [{ domain: 'manual.example', tags: ['rule'] }] });
assert.deepEqual((await collectIntoStorage({ url: 'https://manual.example/', title: 'Manual' })).item.tags, []);

// ———— 批量编辑：收藏和 Chrome 书签按网址共享，12 个上限，撤销 ————

reset((data) => {
  data.items.push({ id: 'full', url: 'https://full.example/', title: 'Full', folderId: 'f_uncategorized', tags: twelve });
  data.items.push({ id: 'one', url: 'https://one.example/', title: 'One', folderId: 'f_uncategorized', tags: ['keep', 'old'] });
  data.urlTags = { 'https://chrome.example/': ['old'] };
});
const edit = await editTagsForUrls(['https://full.example/', 'https://one.example', 'https://chrome.example/', 'https://new-chrome.example/'], { add: ['new'], remove: ['OLD'] });
assert.equal(edit.changed, 3);
assert.equal(edit.limited, 1);
data = await loadData();
assert.deepEqual(item(data, 'one').tags, ['keep', 'new']);
assert.deepEqual(item(data, 'full').tags, twelve);
assert.deepEqual(data.urlTags, { 'https://chrome.example/': ['new'], 'https://new-chrome.example/': ['new'] });
await restoreTagSnapshot(edit.snapshot);
data = await loadData();
assert.deepEqual(item(data, 'one').tags, ['keep', 'old']);
assert.deepEqual(data.urlTags, { 'https://chrome.example/': ['old'] });
await editTagsForUrls(['https://one.example/'], { replace: true, add: ['x', 'y'] });
assert.deepEqual(item(await loadData(), 'one').tags, ['x', 'y']);

// ———— 全局改名（合并）/ 删除：同步规则，可以撤销 ————

reset((data) => {
  data.items.push({ id: 'a', url: 'https://a.example/', title: 'A', folderId: 'f_uncategorized', tags: ['frontend', '前端'] });
  data.items.push({ id: 'b', url: 'https://b.example/', title: 'B', folderId: 'f_uncategorized', tags: ['Frontend'] });
  data.urlTags = { 'https://c.example/': ['frontend', 'x'] };
  data.settings.tagRules = { domains: [{ domain: 'a.example', tags: ['frontend'] }], keywords: [{ keyword: 'vue', tags: ['frontend', 'vue'] }] };
});
const merged = await renameTag('frontend', '前端');
assert.equal(merged.changed, 3);
assert.equal(merged.rulesChanged, 2);
data = await loadData();
assert.deepEqual(item(data, 'a').tags, ['前端']);
assert.deepEqual(item(data, 'b').tags, ['前端']);
assert.deepEqual(data.urlTags['https://c.example/'], ['前端', 'x']);
assert.deepEqual(data.settings.tagRules.domains[0].tags, ['前端']);
assert.deepEqual(data.settings.tagRules.keywords[0].tags, ['前端', 'vue']);
await restoreTagSnapshot(merged.snapshot);
data = await loadData();
assert.deepEqual(item(data, 'a').tags, ['frontend', '前端']);
assert.deepEqual(data.settings.tagRules.domains[0].tags, ['frontend']);

const removed = await deleteTag('FRONTEND');
assert.equal(removed.changed, 3);
data = await loadData();
assert.deepEqual(item(data, 'a').tags, ['前端']);
assert.deepEqual(item(data, 'b').tags, []);
assert.deepEqual(data.urlTags, { 'https://c.example/': ['x'] });
assert.equal(data.settings.tagRules.domains.length, 0);
assert.deepEqual(data.settings.tagRules.keywords[0].tags, ['vue']);
await restoreTagSnapshot(removed.snapshot);
data = await loadData();
assert.deepEqual(item(data, 'b').tags, ['Frontend']);
assert.equal(data.settings.tagRules.domains.length, 1);
await assert.rejects(() => renameTag('frontend', '  '), /标签名不能为空/);

// ———— 手动执行规则：预览不写入，同一网址合并收藏和 Chrome 两处的文件夹名 ————

reset((data) => {
  data.folders.push({ id: 'work', name: '工作', parentId: null, order: 1 });
  data.items.push({ id: 'w', url: 'https://docs.example/', title: 'Docs', folderId: 'work', tags: [] });
  data.items.push({ id: 'full', url: 'https://full.example/', title: 'Full', folderId: 'f_uncategorized', tags: twelve });
  data.settings.tagRules = { folder: true, keywords: [{ keyword: 'example', tags: ['ex'] }] };
});
const bookmarkEntries = [
  { url: 'https://docs.example/', title: 'Docs', folderName: '资料' },
  { url: 'https://chrome.example/', title: 'Chrome', folderName: '' },
];
assert.deepEqual(await applyTagRulesToExisting({ bookmarkEntries, dryRun: true }), { changed: 2, limited: 1 });
assert.deepEqual(item(await loadData(), 'w').tags, []);
const applied = await applyTagRulesToExisting({ bookmarkEntries });
data = await loadData();
assert.deepEqual(item(data, 'w').tags, ['ex', '工作', '资料']);
assert.deepEqual(data.urlTags['https://chrome.example/'], ['ex']);
await restoreTagSnapshot(applied.snapshot);
data = await loadData();
assert.deepEqual(item(data, 'w').tags, []);
assert.equal(data.urlTags['https://chrome.example/'], undefined);

// ———— 新建 Chrome 书签：关闭自动执行时不写入存储 ————

reset((data) => { data.settings.tagRules = { autoApply: false, domains: [{ domain: 'auto.example', tags: ['auto'] }] }; });
const untouched = JSON.stringify(saved);
assert.deepEqual(await applyTagRulesToBookmarks([{ url: 'https://auto.example/', title: '', folderName: '' }]), { changed: 0 });
assert.equal(JSON.stringify(saved), untouched);
await updateTagRules({ domains: [{ domain: 'auto.example', tags: ['auto'] }] });
assert.deepEqual(await applyTagRulesToBookmarks([{ url: 'https://auto.example/', title: '', folderName: '工作' }]), { changed: 1 });
assert.deepEqual((await loadData()).urlTags['https://auto.example/'], ['auto']);

// ———— 删除书签后的清理：仍有书签或已在收藏里的网址保留 ————

reset((data) => {
  data.items.push({ id: 'kept', url: 'https://collected.example/', title: 'Kept', folderId: 'f_uncategorized', tags: ['x'] });
  data.urlTags = { 'https://gone.example/': ['x'], 'https://still.example/': ['y'] };
});
const stillBookmarked = new Set(['https://still.example/']);
const pruned = await pruneUrlTags(['https://gone.example/', 'https://still.example/', 'https://collected.example/'], async (url) => stillBookmarked.has(url));
assert.equal(pruned.changed, 1);
assert.deepEqual((await loadData()).urlTags, { 'https://still.example/': ['y'] });

// ———— 单条 Chrome 书签编辑：改网址时标签跟过去并与新网址原有标签合并 ————

reset((data) => {
  data.items.push({ id: 'target', url: 'https://target.example/', title: 'T', folderId: 'f_uncategorized', tags: ['existing'] });
  data.urlTags = { 'https://old.example/': ['old'] };
});
await setBookmarkTags({ url: 'https://target.example/', tags: ['old', 'edited'], previousUrl: 'https://old.example/', previousUrlInUse: false });
data = await loadData();
assert.deepEqual(item(data, 'target').tags, ['old', 'edited', 'existing']);
assert.equal(data.urlTags['https://old.example/'], undefined);
await setBookmarkTags({ url: 'https://target.example/', tags: ['only'] });
assert.deepEqual(item(await loadData(), 'target').tags, ['only']);
reset((data) => { data.urlTags = { 'https://old.example/': ['old'] }; });
await setBookmarkTags({ url: 'https://moved.example/', tags: ['old'], previousUrl: 'https://old.example/', previousUrlInUse: true });
assert.deepEqual((await loadData()).urlTags, { 'https://old.example/': ['old'], 'https://moved.example/': ['old'] });

// ———— 编辑收藏网址：旧网址仍有 Chrome 书签时保留标签，新网址的 Chrome 标签并入条目 ————

reset((data) => {
  data.items.push({ id: 'edit', url: 'https://before.example/', title: 'Before', folderId: 'f_uncategorized', tags: ['mine'] });
  data.urlTags = { 'https://after.example/': ['chrome'] };
});
await updateItem('edit', { url: 'https://after.example/', tags: ['mine', 'typed'] }, { keepOldUrlTags: true });
data = await loadData();
assert.deepEqual(item(data, 'edit').tags, ['mine', 'typed', 'chrome']);
assert.deepEqual(data.urlTags, { 'https://before.example/': ['mine'] });

// ———— 导出 / 导入：本机已有记录优先；合并导入执行规则，替换导入不执行 ————

reset((data) => { data.urlTags = { 'https://local.example/': ['local'] }; });
assert.deepEqual(exportPayload(await loadData()).urlTags, { 'https://local.example/': ['local'] });
await updateTagRules({ keywords: [{ keyword: 'incoming', tags: ['rule'] }] });
await importPayload({
  items: [{ url: 'https://incoming.example/', title: 'In', tags: ['t'] }],
  urlTags: { 'https://local.example/': ['remote'], 'https://remote-only.example/': ['r'] },
}, 'merge');
data = await loadData();
assert.deepEqual(data.items.find((entry) => entry.url === 'https://incoming.example/').tags, ['t', 'rule']);
assert.deepEqual(data.urlTags, { 'https://local.example/': ['local'], 'https://remote-only.example/': ['r'] });
await importPayload({
  items: [{ url: 'https://incoming.example/', title: 'In', tags: ['t'] }],
  urlTags: { 'https://x.example/': ['x'] },
  settings: { tagRules: { keywords: [{ keyword: 'incoming', tags: ['rule'] }] } },
}, 'replace');
data = await loadData();
assert.deepEqual(data.items.map((entry) => entry.tags), [['t']]);
assert.deepEqual(data.urlTags, { 'https://x.example/': ['x'] });
assert.equal(getStats(data).tags, 2);

console.log('Tag tests passed: batch edits, shared URL tags, global rename/merge/delete, rules, pruning, and import/export');
