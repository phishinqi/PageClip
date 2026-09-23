function normalizedUrl(url) {
  return String(url || '').trim();
}

function normalizedBookmarkIds(item) {
  return [...new Set((Array.isArray(item?.chromeBookmarkIds) ? item.chromeBookmarkIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
}

export async function removeChromeBookmarksForItems(items, bookmarksApi = globalThis.chrome?.bookmarks) {
  const associations = new Map();
  for (const item of items || []) {
    const url = normalizedUrl(item?.url);
    if (!url) continue;
    for (const id of normalizedBookmarkIds(item)) associations.set(id, url);
  }
  if (!associations.size) return { removed: 0, failed: 0 };
  if (typeof bookmarksApi?.get !== 'function' || typeof bookmarksApi?.remove !== 'function') {
    throw new Error('Chrome 书签 API 不可用');
  }

  let removed = 0;
  let failed = 0;
  for (const [id, url] of associations) {
    try {
      const result = await bookmarksApi.get(id);
      const node = Array.isArray(result) ? result[0] : result;
      if (normalizedUrl(node?.url) !== url) continue;
      await bookmarksApi.remove(id);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
