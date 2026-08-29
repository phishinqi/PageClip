// 浏览器书签导入：只读取并复制到 PageClip，不修改 Chrome 原生书签。
import { genId, isCollectableUrl, mutate, UNCATEGORIZED_ID } from './store.js';

function flattenTree(tree) {
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
    const folder = { sourceId: String(node.id || genId('source')), name, path, children: [] };
    folders.push(folder);
    for (const child of node.children || []) walk(child, path);
  };
  roots.forEach((root) => walk(root));
  return { folders, items };
}

function importFlatData(flat, mode = 'merge') {
  return mutate((data) => {
    if (mode === 'replace') {
      data.folders = data.folders.filter((folder) => folder.system);
      data.items = [];
    }
    const folderMap = new Map();
    const existingByPath = new Map();
    for (const folder of data.folders) {
      const path = folderPath(data.folders, folder.id);
      existingByPath.set(path, folder.id);
    }
    let foldersAdded = 0;
    for (const folder of flat.folders) {
      const pathKey = folder.path.join(' / ');
      if (existingByPath.has(pathKey)) {
        folderMap.set(pathKey, existingByPath.get(pathKey));
        continue;
      }
      const parentPath = folder.path.slice(0, -1).join(' / ');
      const parentId = parentPath ? folderMap.get(parentPath) || UNCATEGORIZED_ID : null;
      const created = { id: genId('f'), name: folder.name, parentId, order: data.folders.filter((item) => item.parentId === parentId).length, createdAt: Date.now(), imported: true };
      data.folders.push(created);
      folderMap.set(pathKey, created.id);
      existingByPath.set(pathKey, created.id);
      foldersAdded++;
    }
    const existingUrls = new Set(data.items.map((item) => item.url));
    let itemsAdded = 0;
    let duplicatesSkipped = 0;
    let invalidSkipped = 0;
    for (const source of flat.items) {
      if (!source.url || !isCollectableUrl(source.url)) { invalidSkipped++; continue; }
      if (existingUrls.has(source.url)) { duplicatesSkipped++; continue; }
      const folderId = source.folderPath.length ? folderMap.get(source.folderPath.join(' / ')) || UNCATEGORIZED_ID : UNCATEGORIZED_ID;
      data.items.push({ id: genId('i'), url: source.url.slice(0, 2048), title: source.title.slice(0, 500), folderId, tags: [], note: '', createdAt: source.createdAt, updatedAt: source.createdAt, pinned: false, order: data.items.length });
      existingUrls.add(source.url);
      itemsAdded++;
    }
    return { foldersAdded, itemsAdded, duplicatesSkipped, invalidSkipped, mode };
  });
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
  return parts.join(' / ');
}

export async function importBrowserBookmarks(tree, mode = 'merge') {
  return importFlatData(flattenTree(tree), mode);
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
