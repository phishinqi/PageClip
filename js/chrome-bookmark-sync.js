function normalizedUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try { return new URL(value).href; } catch { return value; }
}

// Resolve against this browser, not IDs copied from an old import or another device.
// Read the tree once per batch and match complete URLs (including query/fragment).
export async function removeChromeBookmarksForItems(items, bookmarksApi = globalThis.chrome?.bookmarks) {
  const urls = new Set((items || []).map((item) => normalizedUrl(item?.url)).filter(Boolean));
  if (!urls.size) return { removed: 0, failed: 0 };
  if (typeof bookmarksApi?.getTree !== 'function' || typeof bookmarksApi?.get !== 'function' || typeof bookmarksApi?.remove !== 'function') {
    throw new Error('Chrome 书签 API 不可用');
  }
  const matches = new Map();
  const walk = (node) => {
    if (node.url && urls.has(normalizedUrl(node.url))) matches.set(node.id, normalizedUrl(node.url));
    for (const child of node.children || []) walk(child);
  };
  (await bookmarksApi.getTree()).forEach(walk);

  let removed = 0;
  let failed = 0;
  for (const [id, url] of matches) {
    try {
      // Do not delete a bookmark edited since the snapshot was read.
      const [node] = await bookmarksApi.get(id);
      if (normalizedUrl(node?.url) !== url) continue;
      await bookmarksApi.remove(id);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
