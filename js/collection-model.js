// Pure collection tree calculations shared by the UI and tests.

import { UNCATEGORIZED_ID } from './store.js';

export function buildFolderStats(data) {
  const childrenByParent = new Map();
  for (const folder of data.folders) {
    const parent = folder.parentId || null;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(folder);
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.order - b.order);
  }

  const directCounts = new Map();
  for (const item of data.items) {
    directCounts.set(item.folderId, (directCounts.get(item.folderId) || 0) + 1);
  }
  const counts = new Map(directCounts);
  const descendants = new Map();
  const visiting = new Set();

  function visit(folderId) {
    if (descendants.has(folderId)) return descendants.get(folderId);
    if (visiting.has(folderId)) return new Set([folderId]);
    visiting.add(folderId);
    const ids = new Set([folderId]);
    let total = directCounts.get(folderId) || 0;
    for (const child of childrenByParent.get(folderId) || []) {
      if (child.system) continue;
      const childIds = visit(child.id);
      childIds.forEach((id) => ids.add(id));
      total += counts.get(child.id) || 0;
    }
    counts.set(folderId, total);
    descendants.set(folderId, ids);
    visiting.delete(folderId);
    return ids;
  }

  for (const folder of data.folders) {
    if (!folder.system) visit(folder.id);
  }
  descendants.set(UNCATEGORIZED_ID, new Set([UNCATEGORIZED_ID]));
  counts.set(UNCATEGORIZED_ID, directCounts.get(UNCATEGORIZED_ID) || 0);
  return { childrenByParent, counts, descendants };
}

export function folderScope(folderId, folderStats) {
  if (folderId === 'all') return null;
  return folderStats.descendants.get(folderId) || new Set([folderId]);
}
