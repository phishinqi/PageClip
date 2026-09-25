import assert from 'node:assert/strict';
import { defaultData, loadData, moveItems } from '../js/store.js';

let saved = defaultData();
saved.folders.push({ id: 'target', name: 'Target', parentId: null, order: 1 });
saved.items.push(
  { id: 'existing', url: 'https://existing.example/', title: 'Existing', folderId: 'target', order: 0 },
  { id: 'a', url: 'https://a.example/', title: 'A', folderId: 'f_uncategorized', order: 0 },
  { id: 'b', url: 'https://b.example/', title: 'B', folderId: 'f_uncategorized', order: 1 },
  { id: 'c', url: 'https://c.example/', title: 'C', folderId: 'f_uncategorized', order: 2 },
);
globalThis.chrome = { storage: { local: {
  async get() { return { bc_data: structuredClone(saved) }; },
  async set(value) { saved = structuredClone(value.bc_data); },
} } };

// 多选拖到文件夹：所有选中项按选择顺序追加到目标文件夹末尾，重复和不存在的 id 忽略。
const result = await moveItems(['c', 'a', 'missing', 'a'], { folderId: 'target' });
assert.deepEqual(result, { count: 2, folderId: 'target' });
const data = await loadData();
const inTarget = data.items.filter((item) => item.folderId === 'target').sort((x, y) => x.order - y.order).map((item) => item.id);
assert.deepEqual(inTarget, ['existing', 'c', 'a']);
assert.equal(data.items.find((item) => item.id === 'b').folderId, 'f_uncategorized');
assert.equal((await moveItems(['b'], { folderId: 'missing-folder' })).folderId, 'f_uncategorized');

console.log('Collection move tests passed: dropping a multi-selection moves every selected item in order');
