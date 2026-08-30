import assert from 'node:assert/strict';
import { buildFolderStats, folderScope } from '../js/collection-model.js';

const data = {
  folders: [
    { id: 'f_uncategorized', name: '未分类', parentId: null, order: 0, system: true },
    { id: 'root', name: '根目录', parentId: null, order: 0 },
    { id: 'child', name: '子目录', parentId: 'root', order: 0 },
    { id: 'grandchild', name: '孙目录', parentId: 'child', order: 0 },
    { id: 'empty', name: '空目录', parentId: null, order: 1 },
  ],
  items: [
    { id: 'root-item', folderId: 'root' },
    { id: 'child-item-1', folderId: 'child' },
    { id: 'child-item-2', folderId: 'child' },
    { id: 'grandchild-item', folderId: 'grandchild' },
    { id: 'uncategorized-item', folderId: 'f_uncategorized' },
  ],
};

const stats = buildFolderStats(data);
assert.equal(stats.counts.get('root'), 4);
assert.equal(stats.counts.get('child'), 3);
assert.equal(stats.counts.get('grandchild'), 1);
assert.equal(stats.counts.get('empty'), 0);
assert.equal(stats.counts.get('f_uncategorized'), 1);
assert.deepEqual([...folderScope('root', stats)].sort(), ['child', 'grandchild', 'root']);
assert.deepEqual([...folderScope('child', stats)].sort(), ['child', 'grandchild']);
assert.deepEqual([...folderScope('f_uncategorized', stats)], ['f_uncategorized']);
assert.equal(folderScope('all', stats), null);

console.log('Collection model tests passed: recursive counts and scopes');
