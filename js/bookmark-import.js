// 浏览器书签导入：只读取并复制到 PageClip，不修改 Chrome 原生书签。
import { genId, isCollectableUrl, mutate, UNCATEGORIZED_ID } from './store.js';

function pathKey(path) {
  // JSON 编码保留数组边界，避免标题包含 " / " 时与其他层级碰撞。
  return JSON.stringify(path);
}

export function flattenBrowserBookmarkTree(tree) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const folders = [];
  const items = [];
  const walk = (node, parentPath = []) => {
    if (!node || node.id === '0') {
      for (const child of node?.children || []) walk(child, parentPath);
      return;
    }
    const name = String(node.title || '未命名').trim() || '未命名';
    const path = [...parentPath, name];
    if (node.url) {
      items.push({
        url: String(node.url).trim(),
        title: String(node.title || node.url).trim() || node.url,
        createdAt: Number(node.dateAdded) || Date.now(),
        folderPath: parentPath,
      });
      return;
    }
    folders.push({ sourceId: String(node.id || genId('source')), name, path });
    for (const child of node.children || []) walk(child, path);
  };
  roots.forEach((root) => walk(root));
  return { folders, items };
}

function folderPath(folders, id) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts = [];
  let current = byId.get(id);
  while (current) {
    if (current.system) break;
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return parts;
}

async function assertStorageCapacity(data) {
  const storage = globalThis.chrome?.storage?.local;
  const quota = Number(storage?.QUOTA_BYTES);
  if (!Number.isFinite(quota) || quota <= 0) return;
  const encoded = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  let current = 0;
  try { current = Number(await storage.getBytesInUse?.()) || 0; } catch {}
  // bc_data is normally the only sizable value. Preserve a small buffer for other keys.
  if (Math.max(encoded, current) > quota) {
    throw new Error('PageClip 本地存储空间不足，无法导入更多 Chrome 书签。请导出或删除部分数据后重试。');
  }
}

async function importFlatData(flat, mode = 'merge') {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('不支持的书签导入模式');
  return mutate(async (data) => {
    if (mode === 'replace') {
      data.folders = data.folders.filter((folder) => folder.system);
      data.items = [];
    }
    const folderMap = new Map();
    const existingByPath = new Map();
    for (const folder of data.folders) existingByPath.set(pathKey(folderPath(data.folders, folder.id)), folder.id);

    let foldersAdded = 0;
    for (const folder of flat.folders) {
      const key = pathKey(folder.path);
      if (existingByPath.has(key)) {
        folderMap.set(key, existingByPath.get(key));
        continue;
      }
      const parentPath = folder.path.slice(0, -1);
      const parentId = parentPath.length ? folderMap.get(pathKey(parentPath)) || UNCATEGORIZED_ID : null;
      const created = {
        id: genId('f'), name: folder.name, parentId,
        order: data.folders.filter((item) => item.parentId === parentId).length,
        createdAt: Date.now(), imported: true,
      };
      data.folders.push(created);
      folderMap.set(key, created.id);
      existingByPath.set(key, created.id);
      foldersAdded++;
    }

    const existingUrls = new Set(data.items.map((item) => item.url));
    let itemsAdded = 0;
    let duplicatesSkipped = 0;
    let invalidSkipped = 0;
    for (const source of flat.items) {
      if (!source.url || !isCollectableUrl(source.url)) { invalidSkipped++; continue; }
      if (existingUrls.has(source.url)) { duplicatesSkipped++; continue; }
      const folderId = source.folderPath.length ? folderMap.get(pathKey(source.folderPath)) || UNCATEGORIZED_ID : UNCATEGORIZED_ID;
      data.items.push({
        id: genId('i'), url: source.url.slice(0, 2048), title: source.title.slice(0, 500), folderId,
        tags: [], note: '', createdAt: source.createdAt, updatedAt: source.createdAt,
        pinned: false, order: data.items.length,
      });
      existingUrls.add(source.url);
      itemsAdded++;
    }
    await assertStorageCapacity(data);
    return { foldersAdded, itemsAdded, duplicatesSkipped, invalidSkipped, mode };
  });
}

export async function importBrowserBookmarks(tree, mode = 'merge') {
  return importFlatData(flattenBrowserBookmarkTree(tree), mode);
}

// 自动导入只能走合并路径，避免任何 PageClip 数据被 Chrome 来源覆盖。
export async function mergeBrowserBookmarks(tree) {
  return importFlatData(flattenBrowserBookmarkTree(tree), 'merge');
}

export function parseBookmarksHtml(html) {
  if (typeof DOMParser === 'undefined') throw new Error('当前环境不支持 HTML 解析');
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const root = { id: 'html-root', title: '浏览器书签', children: [] };
  const parseList = (dl, parent) => {
    for (const child of dl.children) {
      if (child.tagName !== 'DT') continue;
      const folderTitle = child.querySelector(':scope > H3');
      if (folderTitle) {
        const folder = { id: genId('html-f'), title: folderTitle.textContent.trim(), children: [] };
        parent.children.push(folder);
        const nested = child.querySelector(':scope > DL');
        if (nested) parseList(nested, folder);
        continue;
      }
      const link = child.querySelector(':scope > A');
      if (link) parent.children.push({ id: genId('html-a'), title: link.textContent.trim(), url: link.getAttribute('HREF') || '', dateAdded: Number(link.getAttribute('ADD_DATE')) * 1000 || Date.now() });
    }
  };
  const firstDl = doc.querySelector('DL');
  if (firstDl) parseList(firstDl, root);
  return root;
}

export async function importBookmarksHtml(html, mode = 'merge') {
  return importBrowserBookmarks(parseBookmarksHtml(html), mode);
}
