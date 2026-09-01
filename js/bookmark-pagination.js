// Chrome 书签树的大文件夹分页：每层独立、仅在当前面板会话内保存进度。

export const BOOKMARK_PAGE_SIZE = 100;

function normalizeTotal(total) {
  return Math.max(0, Math.floor(Number(total) || 0));
}

export function initialBookmarkPageSize(total) {
  return Math.min(BOOKMARK_PAGE_SIZE, normalizeTotal(total));
}

export function clampBookmarkPageSize(count, total) {
  return Math.min(normalizeTotal(total), Math.max(0, Math.floor(Number(count) || 0)));
}

export function nextBookmarkPageSize(count, total) {
  return Math.min(normalizeTotal(total), clampBookmarkPageSize(count, total) + BOOKMARK_PAGE_SIZE);
}

export function reconcileBookmarkPageSizes(pageSizes, folderTotals) {
  const reconciled = new Map();
  for (const [folderId, total] of folderTotals) {
    if (!pageSizes.has(folderId)) continue;
    reconciled.set(folderId, clampBookmarkPageSize(pageSizes.get(folderId), total));
  }
  return reconciled;
}
