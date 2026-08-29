// 数据层：chrome.storage.local 读写封装，后台 SW 与侧边栏共用。
// 所有修改都经由 mutate()（读-改-写）完成，避免跨上下文竞态丢数据。

export const STORAGE_KEY = 'bc_data';
export const UNCATEGORIZED_ID = 'f_uncategorized';
const SCHEMA_VERSION = 3;
const RECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeQuickItem(raw) {
  const now = Date.now();
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'group' && Array.isArray(raw.tabs)) {
    const seenUrls = new Set();
    const tabs = raw.tabs.filter((tab) => tab && isCollectableUrl(tab.url)).map((tab) => ({
      url: String(tab.url).slice(0, 2048),
      title: String(tab.title || tab.url).slice(0, 500),
      favIconUrl: String(tab.favIconUrl || '').slice(0, 2048),
      groupId: Number.isInteger(tab.groupId) ? tab.groupId : null,
      groupTitle: String(tab.groupTitle || '').slice(0, 100),
      groupColor: String(tab.groupColor || '').slice(0, 30),
    })).filter((tab) => {
      if (seenUrls.has(tab.url)) return false;
      seenUrls.add(tab.url);
      return true;
    });
    return {
      id: String(raw.id || genId('qg')),
      type: 'group',
      title: String(raw.title || '标签集合').slice(0, 100),
      tabs,
      createdAt: Number(raw.createdAt) || now,
      updatedAt: Number(raw.updatedAt) || now,
      pinned: !!raw.pinned,
      order: Number(raw.order) || 0,
    };
  }
  if (!raw.url || !isCollectableUrl(raw.url)) return null;
  return {
    id: String(raw.id || genId('q')),
    type: 'single',
    title: String(raw.title || raw.url).slice(0, 500),
    url: String(raw.url).slice(0, 2048),
    favIconUrl: String(raw.favIconUrl || ''),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    pinned: !!raw.pinned,
    order: Number(raw.order) || 0,
  };
}

function normalizeInboxItem(raw) {
  const now = Date.now();
  if (!raw || !raw.url || !isCollectableUrl(raw.url)) return null;
  return {
    id: String(raw.id || genId('in')),
    url: String(raw.url).slice(0, 2048),
    title: String(raw.title || raw.url).slice(0, 500),
    favIconUrl: String(raw.favIconUrl || ''),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    readAt: raw.readAt ? Number(raw.readAt) : null,
    source: 'pageclip',
  };
}

export function defaultData() {
  return {
    schema: SCHEMA_VERSION,
    folders: [
      { id: UNCATEGORIZED_ID, name: '未分类', parentId: null, order: 0, system: true },
    ],
    items: [],
    quickAccess: [],
    inbox: [],
    recycleBin: [],
    settings: { onboardingDone: false, sortMode: 'time', railExpanded: true, quickAccessExpanded: true, inboxExpanded: true, uiLocale: 'auto' },
  };
}

export async function ensureDataInitialized() {
  const cur = await chrome.storage.local.get(STORAGE_KEY);
  const raw = cur[STORAGE_KEY];
  const base = defaultData();
  if (raw && typeof raw === 'object') {
    // 兼容 schema 1/2：保留旧收藏、文件夹、设置；新字段逐项规范化。
    const sourceFolders = Array.isArray(raw.folders) ? raw.folders : [];
    const pendingFolders = sourceFolders.filter((folder) => folder && folder.id !== UNCATEGORIZED_ID && folder.name).slice();
    const seenFolderIds = new Set([UNCATEGORIZED_ID]);
    while (pendingFolders.length) {
      const before = pendingFolders.length;
      for (let i = pendingFolders.length - 1; i >= 0; i--) {
        const folder = pendingFolders[i];
        const parentId = folder.parentId ? String(folder.parentId) : null;
        if (parentId && !seenFolderIds.has(parentId)) continue;
        const id = String(folder.id);
        if (!seenFolderIds.has(id)) {
          base.folders.push({ ...folder, id, name: String(folder.name).trim().slice(0, 50) || '未命名文件夹', parentId, order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : base.folders.length });
          seenFolderIds.add(id);
        }
        pendingFolders.splice(i, 1);
      }
      if (pendingFolders.length === before) {
        // 父文件夹已损坏或缺失：保留该文件夹，回退到根目录。
        const folder = pendingFolders.pop();
        const id = String(folder.id);
        if (!seenFolderIds.has(id)) {
          base.folders.push({ ...folder, id, name: String(folder.name).trim().slice(0, 50) || '未命名文件夹', parentId: null, order: base.folders.length });
          seenFolderIds.add(id);
        }
      }
    }
    const validFolderIds = new Set(base.folders.map((folder) => folder.id));
    base.items = (Array.isArray(raw.items) ? raw.items : []).map((item) => {
      if (!item || !isCollectableUrl(item.url)) return null;
      return { id: String(item.id || genId('i')), url: String(item.url).trim().slice(0, 2048), title: String(item.title || item.url).slice(0, 500), folderId: validFolderIds.has(item.folderId) ? item.folderId : UNCATEGORIZED_ID, tags: normalizeTags(item.tags), note: String(item.note || '').slice(0, 2000), createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(), pinned: !!item.pinned, order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0 };
    }).filter(Boolean);
    const quickSource = Array.isArray(raw.quickAccess) ? raw.quickAccess : (Array.isArray(raw.quickItems) ? raw.quickItems : []);
    base.quickAccess = quickSource.map(normalizeQuickItem).filter(Boolean);
    base.inbox = (Array.isArray(raw.inbox) ? raw.inbox : []).map(normalizeInboxItem).filter(Boolean);
    base.recycleBin = Array.isArray(raw.recycleBin) ? raw.recycleBin.filter((entry) => entry && entry.id && entry.payload) : [];
    Object.assign(base.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {});
    if (!['auto', 'zh_CN', 'en'].includes(base.settings.uiLocale)) base.settings.uiLocale = 'auto';
  }
  base.schema = SCHEMA_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEY]: base });
  return base;
}
export async function loadData() {
  const cur = await chrome.storage.local.get(STORAGE_KEY);
  return cur[STORAGE_KEY] || defaultData();
}

export async function saveData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// fn(data) 就地修改 data，返回值作为 mutate 的返回值
export async function mutate(fn) {
  const data = await loadData();
  const ret = fn(data);
  await saveData(data);
  return ret;
}

export function isCollectableUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? !!parsed.hostname : parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

export function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，\s]+/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw || '').trim().replace(/^#+/, '').slice(0, 24);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

// ———— 静默收藏（快捷键 / 顶栏 ＋ 按钮共用） ————
// 重复 URL：更新 updatedAt 与标题，不新建条目
export async function collectIntoStorage({ url, title, folderId = UNCATEGORIZED_ID }) {
  if (!isCollectableUrl(url)) throw new Error('网址需以 http://、https:// 或 file:// 开头');
  return mutate((data) => {
    const now = Date.now();
    const existing = data.items.find((it) => it.url === url);
    if (existing) {
      existing.updatedAt = now;
      if (title && title !== existing.title) existing.title = title;
      return { duplicate: true, item: existing };
    }
    const order = data.items.reduce((m, it) => Math.max(m, (it.order || 0) + 1), 0);
    const item = {
      id: genId('i'),
      url,
      title: title || url,
      folderId,
      tags: [],
      note: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order,
    };
    data.items.push(item);
    return { duplicate: false, item };
  });
}

export async function updateItem(id, patch) {
  return mutate((data) => {
    const item = data.items.find((it) => it.id === id);
    if (!item) throw new Error('收藏条目不存在');
    if (patch.title !== undefined) item.title = String(patch.title).trim().slice(0, 500) || item.title;
    if (patch.url !== undefined) {
      const url = String(patch.url).trim().slice(0, 2048);
      if (!url) throw new Error('网址不能为空');
      if (!isCollectableUrl(url)) throw new Error('网址需以 http://、https:// 或 file:// 开头');
      item.url = url;
    }
    if (patch.folderId !== undefined && data.folders.some((f) => f.id === patch.folderId)) {
      item.folderId = patch.folderId;
    }
    if (patch.tags !== undefined) item.tags = normalizeTags(patch.tags);
    if (patch.note !== undefined) item.note = String(patch.note).slice(0, 2000);
    item.updatedAt = Date.now();
    return item;
  });
}

export async function removeItem(id) {
  return mutate((data) => {
    const index = data.items.findIndex((it) => it.id === id);
    if (index < 0) throw new Error('收藏条目不存在');
    const [item] = data.items.splice(index, 1);
    return createRecycleEntry(data, 'collection', item.title, { items: [item], index });
  });
}

export async function setItemPinned(id, pinned) {
  return mutate((data) => {
    const item = data.items.find((it) => it.id === id);
    if (!item) throw new Error('收藏条目不存在');
    item.pinned = !!pinned;
    item.updatedAt = Date.now();
    return item;
  });
}

// 条目移动/排序：目标文件夹内（不含被移动项）按 order 排好后插到
// before/after 指定位置，再统一重编 0..n；未指定位置则追加到末尾。
export async function moveItem(id, { folderId, beforeId, afterId } = {}) {
  return mutate((data) => {
    const item = data.items.find((it) => it.id === id);
    if (!item) throw new Error('收藏条目不存在');
    let targetFolder = folderId || item.folderId;
    if (!data.folders.some((f) => f.id === targetFolder)) targetFolder = UNCATEGORIZED_ID;
    const siblings = data.items
      .filter((it) => it.folderId === targetFolder && it.id !== id)
      .sort((a, b) => a.order - b.order);
    let idx = siblings.length;
    if (beforeId) {
      const i = siblings.findIndex((s) => s.id === beforeId);
      if (i >= 0) idx = i;
    } else if (afterId) {
      const i = siblings.findIndex((s) => s.id === afterId);
      if (i >= 0) idx = i + 1;
    }
    siblings.splice(idx, 0, item);
    siblings.forEach((s, i) => { s.order = i; });
    item.folderId = targetFolder;
    return item;
  });
}

// ———— 快捷收藏夹与临时 Inbox ————

function cleanTab(tab) {
  if (!tab || !isCollectableUrl(tab.url)) return null;
  return {
    url: String(tab.url).slice(0, 2048),
    title: String(tab.title || tab.url).slice(0, 500),
    favIconUrl: String(tab.favIconUrl || '').slice(0, 2048),
    groupId: Number.isInteger(tab.groupId) && tab.groupId >= 0 ? tab.groupId : null,
    groupTitle: String(tab.groupTitle || '').slice(0, 100),
    groupColor: String(tab.groupColor || '').slice(0, 30),
  };
}

export async function addQuickItem({ url, title, favIconUrl = '' }) {
  if (!isCollectableUrl(url)) throw new Error('网页地址不支持快捷收藏');
  return mutate((data) => {
    const existing = data.quickAccess.find((item) => item.type === 'single' && item.url === url);
    const now = Date.now();
    if (existing) {
      existing.title = title || existing.title;
      existing.favIconUrl = favIconUrl || existing.favIconUrl;
      existing.updatedAt = now;
      return { duplicate: true, item: existing };
    }
    const item = normalizeQuickItem({ url, title, favIconUrl, order: data.quickAccess.length, createdAt: now, updatedAt: now });
    if (!item) throw new Error('网页地址不支持快捷收藏');
    data.quickAccess.push(item);
    return { duplicate: false, item };
  });
}

export async function addQuickGroup({ title, tabs }) {
  return mutate((data) => {
    const cleanTabs = [];
    const seenUrls = new Set();
    for (const tab of tabs || []) {
      const clean = cleanTab(tab);
      if (!clean || seenUrls.has(clean.url)) continue;
      seenUrls.add(clean.url);
      cleanTabs.push(clean);
    }
    if (!cleanTabs.length) throw new Error('没有可保存的网页标签');
    const now = Date.now();
    const group = {
      id: genId('qg'),
      type: 'group',
      title: String(title || `标签集合 · ${new Date(now).toLocaleDateString()}`).slice(0, 100),
      tabs: cleanTabs,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      order: data.quickAccess.length,
    };
    data.quickAccess.push(group);
    return group;
  });
}

function createRecycleEntry(data, source, label, payload) {
  const now = Date.now();
  const entry = {
    id: genId('rb'),
    source,
    label: String(label || '已删除项目').slice(0, 200),
    deletedAt: now,
    expiresAt: now + RECYCLE_RETENTION_MS,
    payload: JSON.parse(JSON.stringify(payload)),
  };
  data.recycleBin = Array.isArray(data.recycleBin) ? data.recycleBin : [];
  data.recycleBin.unshift(entry);
  return entry;
}

export async function removeQuickItem(id) {
  return mutate((data) => {
    const index = data.quickAccess.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('快捷收藏不存在');
    const [item] = data.quickAccess.splice(index, 1);
    return createRecycleEntry(data, 'quick', item.title, { item, index });
  });
}

export async function renameQuickGroup(id, title) {
  return mutate((data) => {
    const item = data.quickAccess.find((entry) => entry.id === id && entry.type === 'group');
    if (!item) throw new Error('标签集合不存在');
    item.title = String(title || '').trim().slice(0, 100) || item.title;
    item.updatedAt = Date.now();
    return item;
  });
}

export async function removeQuickGroupTab(id, tabIndex) {
  return mutate((data) => {
    const group = data.quickAccess.find((entry) => entry.id === id && entry.type === 'group');
    if (!group || !Array.isArray(group.tabs)) throw new Error('标签集合不存在');
    const index = Number(tabIndex);
    if (!Number.isInteger(index) || index < 0 || index >= group.tabs.length) throw new Error('标签页不存在');
    const [tab] = group.tabs.splice(index, 1);
    group.updatedAt = Date.now();
    return createRecycleEntry(data, 'quick', tab.title || tab.url, { kind: 'group-tab', groupId: id, tab, index });
  });
}

export async function reorderQuickGroupTabs(id, orderedIndexes) {
  return mutate((data) => {
    const group = data.quickAccess.find((entry) => entry.id === id && entry.type === 'group');
    if (!group || !Array.isArray(group.tabs)) throw new Error('标签集合不存在');
    const indexes = (orderedIndexes || []).map(Number);
    if (indexes.length !== group.tabs.length || new Set(indexes).size !== indexes.length) throw new Error('排序数据无效');
    group.tabs = indexes.map((index) => group.tabs[index]).filter(Boolean);
    if (group.tabs.length !== indexes.length) throw new Error('排序数据无效');
    group.updatedAt = Date.now();
    return group;
  });
}

export async function toggleQuickPinned(id) {
  return mutate((data) => {
    const item = data.quickAccess.find((entry) => entry.id === id);
    if (!item) throw new Error('快捷收藏不存在');
    item.pinned = !item.pinned;
    item.updatedAt = Date.now();
    return item;
  });
}

export async function moveQuickItem(id, targetIndex) {
  return mutate((data) => {
    const index = data.quickAccess.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('快捷收藏不存在');
    const [item] = data.quickAccess.splice(index, 1);
    const next = Math.max(0, Math.min(Number(targetIndex) || 0, data.quickAccess.length));
    data.quickAccess.splice(next, 0, item);
    data.quickAccess.forEach((entry, i) => { entry.order = i; });
    return item;
  });
}

export async function addInboxItem({ url, title, favIconUrl = '' }) {
  if (!isCollectableUrl(url)) throw new Error('网页地址不支持暂存');
  return mutate((data) => {
    const existing = data.inbox.find((item) => item.url === url);
    const now = Date.now();
    if (existing) {
      existing.title = title || existing.title;
      existing.favIconUrl = favIconUrl || existing.favIconUrl;
      existing.updatedAt = now;
      existing.readAt = null;
      return { duplicate: true, item: existing };
    }
    const item = normalizeInboxItem({ url, title, favIconUrl, createdAt: now, updatedAt: now });
    if (!item) throw new Error('网页地址不支持暂存');
    data.inbox.unshift(item);
    return { duplicate: false, item };
  });
}

export async function markInboxRead(id, read = true) {
  return mutate((data) => {
    const item = data.inbox.find((entry) => entry.id === id);
    if (!item) throw new Error('Inbox 条目不存在');
    item.readAt = read ? Date.now() : null;
    item.updatedAt = Date.now();
    return item;
  });
}

export async function completeInboxItem(id) {
  return mutate((data) => {
    const index = data.inbox.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('Inbox 条目不存在');
    const [item] = data.inbox.splice(index, 1);
    return createRecycleEntry(data, 'inbox', item.title, { item, index });
  });
}

export async function removeInboxItem(id) {
  return completeInboxItem(id);
}

export async function removeInboxItems(ids) {
  return mutate((data) => {
    const wanted = new Set(ids || []);
    const removed = data.inbox
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => wanted.has(item.id));
    if (!removed.length) throw new Error('没有可删除的 Inbox 条目');
    data.inbox = data.inbox.filter((item) => !wanted.has(item.id));
    const batch = createRecycleEntry(data, 'inbox', `${removed.length} 条 Inbox 条目`, { items: removed });
    return { count: removed.length, batch };
  });
}

export async function completeInboxItems(ids) {
  return removeInboxItems(ids);
}

export async function restoreRecycleEntry(id) {
  return mutate((data) => {
    const index = data.recycleBin.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('回收站记录不存在或已过期');
    const [entry] = data.recycleBin.splice(index, 1);
    const payload = entry.payload || {};
    if (entry.source === 'quick' && payload.kind !== 'group-tab') {
      const item = payload.item;
      if (item && !data.quickAccess.some((current) => current.id === item.id)) {
        data.quickAccess.splice(Math.min(Math.max(Number(payload.index) || 0, 0), data.quickAccess.length), 0, item);
        data.quickAccess.forEach((current, order) => { current.order = order; });
      }
    } else if ((entry.source === 'quick' && payload.kind === 'group-tab') || entry.source === 'quick-tab') {
      const group = data.quickAccess.find((current) => current.id === payload.groupId && current.type === 'group');
      if (group && payload.tab && !group.tabs.some((tab) => tab.url === payload.tab.url)) {
        group.tabs.splice(Math.min(Math.max(Number(payload.index) || 0, 0), group.tabs.length), 0, payload.tab);
        group.updatedAt = Date.now();
      } else if (!group && payload.tab && !data.quickAccess.some((item) => item.type === 'single' && item.url === payload.tab.url)) {
        const fallback = normalizeQuickItem({ ...payload.tab, type: 'single', order: data.quickAccess.length });
        if (fallback) data.quickAccess.push(fallback);
      }
    } else if (entry.source === 'inbox') {
      const removed = (payload.items || (payload.item ? [{ item: payload.item, index: payload.index }] : []))
        .map((value) => value?.item ? value : { item: value, index: undefined })
        .filter((value) => value.item && !data.inbox.some((current) => current.url === value.item.url));
      removed.sort((aa, bb) => (Number(aa.index) || data.inbox.length) - (Number(bb.index) || data.inbox.length));
      for (const value of removed) {
        const at = Number.isInteger(value.index) ? Math.min(Math.max(value.index, 0), data.inbox.length) : data.inbox.length;
        data.inbox.splice(at, 0, value.item);
      }
    } else if (entry.source === 'collection' && payload.kind !== 'folder') {
      const items = payload.items || (payload.item ? [payload.item] : []);
      const existing = new Set(data.items.map((item) => item.url));
      for (const item of items) {
        if (!item || existing.has(item.url)) continue;
        item.folderId = data.folders.some((folder) => folder.id === item.folderId) ? item.folderId : UNCATEGORIZED_ID;
        const at = Number.isInteger(payload.index) ? Math.min(Math.max(payload.index, 0), data.items.length) : data.items.length;
        data.items.splice(at, 0, item);
        existing.add(item.url);
      }
    } else if ((entry.source === 'collection' && payload.kind === 'folder') || entry.source === 'collection-folder') {
      const folders = payload.folders || [];
      const knownFolders = new Set(data.folders.map((item) => item.id));
      for (const folder of folders) {
        if (!folder || knownFolders.has(folder.id)) continue;
        const parentExists = !folder.parentId || knownFolders.has(folder.parentId);
        data.folders.push({ ...folder, parentId: parentExists ? folder.parentId : null });
        knownFolders.add(folder.id);
      }
      const existing = new Set(data.items.map((item) => item.url));
      for (const item of payload.items || []) if (item && !existing.has(item.url)) {
        data.items.push({ ...item, folderId: knownFolders.has(item.folderId) ? item.folderId : UNCATEGORIZED_ID });
        existing.add(item.url);
      }
    }
    return entry;
  });
}
export async function purgeRecycleEntry(id) {
  return mutate((data) => {
    data.recycleBin = data.recycleBin.filter((entry) => entry.id !== id);
  });
}

export async function clearRecycleBin() {
  return mutate((data) => {
    const count = data.recycleBin.length;
    data.recycleBin = [];
    return count;
  });
}

export async function pruneRecycleBin(now = Date.now()) {
  return mutate((data) => {
    const before = data.recycleBin.length;
    data.recycleBin = (data.recycleBin || []).filter((entry) => Number(entry.expiresAt) > now);
    return before - data.recycleBin.length;
  });
}

export function getRecycleStats(data) {
  const bins = data.recycleBin || [];
  const countPayload = (entry) => {
    const payload = entry.payload || {};
    if (Array.isArray(payload.folders)) return payload.folders.length + (payload.items || []).length;
    if (Array.isArray(payload.items)) return payload.items.length;
    if (payload.item || payload.tab) return 1;
    return 1;
  };
  return {
    batches: bins.length,
    entries: bins.reduce((sum, entry) => sum + countPayload(entry), 0),
    nextExpiry: bins.reduce((min, item) => Math.min(min, Number(item.expiresAt) || Infinity), Infinity),
  };
}

export function getInboxStats(data) {
  const items = data.inbox || [];
  return {
    total: items.length,
    unread: items.filter((item) => !item.readAt).length,
    read: items.filter((item) => item.readAt).length,
  };
}

// ———— 文件夹 ————

// maybeChildId 沿 parentId 向上递归，命中 ancestorId 则为子孙
export function isDescendantFolder(folders, ancestorId, maybeChildId) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur = byId.get(maybeChildId);
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return false;
}

export async function addFolder(name, parentId = null) {
  const clean = String(name || '').trim().slice(0, 50);
  if (!clean) throw new Error('文件夹名称不能为空');
  if (parentId === UNCATEGORIZED_ID) throw new Error('「未分类」下不能新建子文件夹');
  if (parentId) {
    return mutate((data) => {
      if (!data.folders.some((f) => f.id === parentId)) throw new Error('父文件夹不存在');
      const siblings = data.folders.filter((f) => f.parentId === parentId);
      const folder = { id: genId('f'), name: clean, parentId, order: siblings.length, createdAt: Date.now() };
      data.folders.push(folder);
      return folder;
    });
  }
  return mutate((data) => {
    const siblings = data.folders.filter((f) => f.parentId === null);
    const folder = { id: genId('f'), name: clean, parentId: null, order: siblings.length, createdAt: Date.now() };
    data.folders.push(folder);
    return folder;
  });
}

export async function renameFolder(id, name) {
  const clean = String(name || '').trim().slice(0, 50);
  if (!clean) throw new Error('文件夹名称不能为空');
  return mutate((data) => {
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new Error('文件夹不存在');
    if (folder.system) throw new Error('系统文件夹不能重命名');
    folder.name = clean;
    return folder;
  });
}

// 删除文件夹：子文件夹一并删除，其中所有收藏移入「未分类」
export async function removeFolder(id) {
  if (id === UNCATEGORIZED_ID) throw new Error('「未分类」不能删除');
  return mutate((data) => {
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new Error('文件夹不存在');
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of data.folders) {
        if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    const removedFolders = data.folders.filter((f) => doomed.has(f.id));
    const removedItems = data.items.filter((it) => doomed.has(it.folderId));
    data.items = data.items.filter((it) => !doomed.has(it.folderId));
    data.folders = data.folders.filter((f) => !doomed.has(f.id));
    const recycle = createRecycleEntry(data, 'collection-folder', folder.name, {
      folders: removedFolders,
      items: removedItems,
    });
    return { removedFolders: doomed.size, movedItems: removedItems.length, recycle };
  });
}

// 文件夹移动/排序（含防循环与「未分类」限制）
export async function moveFolder(id, { parentId, beforeId, afterId } = {}) {
  return mutate((data) => {
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new Error('文件夹不存在');
    if (folder.system) throw new Error('系统文件夹不能移动');
    const deny = (msg) => { throw new Error(msg); };

    if (beforeId || afterId) {
      const ref = data.folders.find((f) => f.id === (beforeId || afterId));
      if (!ref) deny('目标位置不存在');
      if (ref.system) deny('不能调整「未分类」的位置');
      if (ref.parentId && isDescendantFolder(data.folders, id, ref.parentId)) {
        deny('不能移动到自身或其子文件夹中');
      }
      // before/after：落点父级 = 参照文件夹的父级
      const siblings = data.folders
        .filter((f) => f.parentId === ref.parentId && f.id !== id)
        .sort((a, b) => a.order - b.order);
      let idx = siblings.length;
      if (beforeId) {
        const i = siblings.findIndex((s) => s.id === beforeId);
        if (i >= 0) idx = i;
      } else {
        const i = siblings.findIndex((s) => s.id === afterId);
        if (i >= 0) idx = i + 1;
      }
      siblings.splice(idx, 0, folder);
      siblings.forEach((s, i) => { s.order = i; });
      folder.parentId = ref.parentId;
      return folder;
    }

    const targetParent = parentId !== undefined ? parentId : folder.parentId;
    if (targetParent === UNCATEGORIZED_ID) deny('不能移入「未分类」');
    if (targetParent && isDescendantFolder(data.folders, id, targetParent)) {
      deny('不能移动到自身或其子文件夹中');
    }
    const siblings = data.folders
      .filter((f) => f.parentId === targetParent && f.id !== id)
      .sort((a, b) => a.order - b.order);
    siblings.forEach((s, i) => { s.order = i; });
    folder.parentId = targetParent;
    folder.order = siblings.length;
    return folder;
  });
}

// ———— 设置 / 统计 ————

export async function updateSettings(patch) {
  return mutate((data) => {
    Object.assign(data.settings, patch);
    return data.settings;
  });
}

export function collectTags(data) {
  const map = new Map();
  for (const it of data.items) {
    for (const t of it.tags || []) map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

export function getStats(data) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return {
    items: data.items.length,
    folders: data.folders.filter((f) => !f.system).length,
    tags: collectTags(data).size,
    monthNew: data.items.filter((it) => it.createdAt >= monthStart.getTime()).length,
  };
}


function backupSettings(settings) {
  const copy = { ...settings };
  if (settings.cloudBackup) copy.cloudBackup = settings.cloudBackup.password ? { password: cloneJson(settings.cloudBackup.password) } : {};
  return copy;
}
function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function cloudCounts(data) {
  const quick = data.quickAccess || [];
  const recycle = data.recycleBin || [];
  return {
    items: (data.items || []).length,
    quickSingles: quick.filter((item) => item.type === 'single').length,
    quickGroups: quick.filter((item) => item.type === 'group').length,
    inbox: (data.inbox || []).length,
    recycleEntries: getRecycleStats(data).entries,
    folders: (data.folders || []).filter((folder) => !folder.system).length,
    tags: collectTags(data).size,
  };
}
function sameCloudItem(left, right) {
  return JSON.stringify({ title: left.title, folderId: left.folderId, tags: left.tags || [], note: left.note || '', pinned: !!left.pinned }) === JSON.stringify({ title: right.title, folderId: right.folderId, tags: right.tags || [], note: right.note || '', pinned: !!right.pinned });
}

export function getCloudBackupPayload(data) {
  return exportPayload(data);
}

export function previewCloudRestore(localData, cloudData) {
  if (!cloudData || cloudData.schema !== 3 || !Array.isArray(cloudData.items) || !Array.isArray(cloudData.folders)) throw new Error('云端数据不是有效的 schema 3 备份');
  const localItems = localData.items || [], remoteItems = cloudData.items || [];
  const localByUrl = new Map(localItems.map((item) => [item.url, item]));
  const itemDiff = { added: 0, same: 0, conflicts: 0, localOnly: 0 };
  for (const item of remoteItems) { const local = localByUrl.get(item.url); if (!local) itemDiff.added++; else sameCloudItem(local, item) ? itemDiff.same++ : itemDiff.conflicts++; }
  const remoteUrls = new Set(remoteItems.map((item) => item.url));
  itemDiff.localOnly = localItems.filter((item) => !remoteUrls.has(item.url)).length;
  const localQuick = localData.quickAccess || [], remoteQuick = cloudData.quickAccess || [];
  const localSingleUrls = new Set(localQuick.filter((item) => item.type === 'single').map((item) => item.url));
  const remoteSingleUrls = new Set(remoteQuick.filter((item) => item.type === 'single').map((item) => item.url));
  const quickGroups = { added: 0, same: 0, conflicts: 0, localOnly: 0 };
  for (const item of remoteQuick.filter((entry) => entry.type === 'group')) { const local = localQuick.find((entry) => entry.type === 'group' && entry.id === item.id); if (!local) quickGroups.added++; else JSON.stringify(local) === JSON.stringify(item) ? quickGroups.same++ : quickGroups.conflicts++; }
  quickGroups.localOnly = localQuick.filter((item) => item.type === 'group' && !remoteQuick.some((remote) => remote.type === 'group' && remote.id === item.id)).length;
  const inboxLocal = localData.inbox || [], inboxRemote = cloudData.inbox || [];
  const inboxLocalByUrl = new Map(inboxLocal.map((item) => [item.url, item]));
  const inboxDiff = { added: 0, same: 0, conflicts: 0, localOnly: 0 };
  for (const item of inboxRemote) { const local = inboxLocalByUrl.get(item.url); if (!local) inboxDiff.added++; else JSON.stringify({ title: local.title, readAt: local.readAt }) === JSON.stringify({ title: item.title, readAt: item.readAt }) ? inboxDiff.same++ : inboxDiff.conflicts++; }
  const inboxRemoteUrls = new Set(inboxRemote.map((item) => item.url)); inboxDiff.localOnly = inboxLocal.filter((item) => !inboxRemoteUrls.has(item.url)).length;
  const folderNames = new Set((localData.folders || []).map((folder) => (folder.parentId || '') + '|' + folder.name));
  const folderDiff = { added: (cloudData.folders || []).filter((folder) => !folder.system && !folderNames.has((folder.parentId || '') + '|' + folder.name)).length, same: 0, conflicts: 0, localOnly: 0 };
  folderDiff.same = (cloudData.folders || []).filter((folder) => folder.system || folderNames.has((folder.parentId || '') + '|' + folder.name)).length;
  const localRecycle = new Set((localData.recycleBin || []).map((entry) => entry.id));
  const recycleAdded = (cloudData.recycleBin || []).filter((entry) => !localRecycle.has(entry.id)).length;
  const totalAdded = itemDiff.added + [...remoteSingleUrls].filter((url) => !localSingleUrls.has(url)).length + quickGroups.added + inboxDiff.added + recycleAdded + folderDiff.added;
  const totalSame = itemDiff.same + [...remoteSingleUrls].filter((url) => localSingleUrls.has(url)).length + quickGroups.same + inboxDiff.same + folderDiff.same;
  const totalConflicts = itemDiff.conflicts + quickGroups.conflicts + inboxDiff.conflicts;
  const totalLocalOnly = itemDiff.localOnly + [...localSingleUrls].filter((url) => !remoteSingleUrls.has(url)).length + quickGroups.localOnly + inboxDiff.localOnly;
  return { cloud: cloudCounts(cloudData), local: cloudCounts(localData), items: itemDiff, quickSingles: { added: [...remoteSingleUrls].filter((url) => !localSingleUrls.has(url)).length, same: [...remoteSingleUrls].filter((url) => localSingleUrls.has(url)).length, conflicts: 0, localOnly: [...localSingleUrls].filter((url) => !remoteSingleUrls.has(url)).length }, quickGroups, inbox: inboxDiff, folders: folderDiff, added: totalAdded, same: totalSame, conflicts: totalConflicts, localOnly: totalLocalOnly };
}

function restoreFolders(data, incomingFolders, replace) {
  if (replace) { data.folders = []; }
  if (!data.folders.some((folder) => folder.id === UNCATEGORIZED_ID)) data.folders.unshift({ id: UNCATEGORIZED_ID, name: '未分类', parentId: null, order: 0, system: true });
  const idMap = new Map();
  const existingByPath = new Map();
  for (const folder of data.folders) existingByPath.set(folderPathForData(data.folders, folder.id), folder.id);
  const pending = (incomingFolders || []).filter((folder) => folder && !folder.system && folder.id !== UNCATEGORIZED_ID).map((folder) => ({ ...folder }));
  const known = new Set(data.folders.map((folder) => folder.id));
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    let progressed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const folder = pending[i]; const parentId = folder.parentId ? (idMap.get(folder.parentId) || (known.has(folder.parentId) ? folder.parentId : null)) : null;
      if (folder.parentId && !parentId) continue;
      const pathKey = (parentId || '') + '|' + String(folder.name || '').trim();
      const existing = data.folders.find((current) => current.name === String(folder.name || '').trim() && (current.parentId || '') === (parentId || ''));
      if (existing) idMap.set(folder.id, existing.id); else { const created = { ...folder, id: String(folder.id || genId('f')), name: String(folder.name || '未命名文件夹').slice(0, 50), parentId, order: data.folders.filter((current) => (current.parentId || '') === (parentId || '')).length }; data.folders.push(created); known.add(created.id); idMap.set(folder.id, created.id); existingByPath.set(pathKey, created.id); }
      pending.splice(i, 1); progressed = true;
    }
    if (!progressed) { const folder = pending.pop(); const created = { ...folder, id: String(folder.id || genId('f')), name: String(folder.name || '未命名文件夹').slice(0, 50), parentId: null, order: data.folders.length }; data.folders.push(created); known.add(created.id); idMap.set(folder.id, created.id); }
  }
  return idMap;
}
function folderPathForData(folders, id) { const byId = new Map(folders.map((folder) => [folder.id, folder])); const parts = []; let current = byId.get(id); while (current && !current.system) { parts.unshift(current.name); current = current.parentId ? byId.get(current.parentId) : null; } return parts.join(' / '); }

export async function restoreCloudPayload(cloudData, mode = 'merge') {
  if (!cloudData || cloudData.schema !== 3 || !Array.isArray(cloudData.items) || !Array.isArray(cloudData.folders)) throw new Error('云端数据不是有效的 schema 3 备份');
  return mutate((data) => {
    const localCloudBackup = cloneJson(data.settings?.cloudBackup || {});
    const remoteCloudBackup = cloneJson(cloudData.settings?.cloudBackup || {});
    if (mode === 'replace') {
      data.folders = []; data.items = []; data.quickAccess = []; data.inbox = []; data.recycleBin = []; data.settings = { ...defaultData().settings, ...(cloudData.settings || {}) };
      data.settings.cloudBackup = { ...remoteCloudBackup, ...localCloudBackup, password: remoteCloudBackup.password || localCloudBackup.password };
    } else if (remoteCloudBackup.password && !localCloudBackup.password) {
      data.settings.cloudBackup = { ...localCloudBackup, password: remoteCloudBackup.password };
    }
    const idMap = restoreFolders(data, cloudData.folders, mode === 'replace');
    const urls = new Set(data.items.map((item) => item.url));
    for (const raw of cloudData.items) { if (!raw || !isCollectableUrl(raw.url) || urls.has(raw.url)) continue; data.items.push({ ...cloneJson(raw), id: String(raw.id || genId('i')), folderId: idMap.get(raw.folderId) || (data.folders.some((folder) => folder.id === raw.folderId) ? raw.folderId : UNCATEGORIZED_ID) }); urls.add(raw.url); }
    const quickUrls = new Set(data.quickAccess.filter((item) => item.type === 'single').map((item) => item.url));
    for (const raw of cloudData.quickAccess || []) { const item = normalizeQuickItem(raw); if (!item) continue; if (item.type === 'single') { if (quickUrls.has(item.url)) continue; quickUrls.add(item.url); data.quickAccess.push(item); } else { const sameId = data.quickAccess.find((current) => current.type === 'group' && current.id === item.id); if (!sameId) data.quickAccess.push(item); } }
    data.quickAccess.forEach((item, index) => { item.order = index; });
    const inboxUrls = new Set(data.inbox.map((item) => item.url));
    for (const raw of cloudData.inbox || []) { const item = normalizeInboxItem(raw); if (!item || inboxUrls.has(item.url)) continue; data.inbox.push(item); inboxUrls.add(item.url); }
    const recycleIds = new Set(data.recycleBin.map((entry) => entry.id));
    for (const entry of cloudData.recycleBin || []) if (entry && entry.id && !recycleIds.has(entry.id)) { data.recycleBin.push(cloneJson(entry)); recycleIds.add(entry.id); }
    return { mode, counts: cloudCounts(data) };
  });
}

// ———— 备份导出 / 导入 ————

export function exportPayload(data) {
  const pick = (obj, keys) => {
    const o = {};
    for (const k of keys) o[k] = obj[k];
    return o;
  };
  return {
    app: 'PageClip',
    legacyApp: 'bookmark-sidebar',
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    folders: data.folders.map((f) => pick(f, ['id', 'name', 'parentId', 'order', 'system'])),
    items: data.items.map((it) =>
      pick(it, ['id', 'url', 'title', 'folderId', 'tags', 'note', 'createdAt', 'updatedAt', 'pinned', 'order'])
    ),
    quickAccess: (data.quickAccess || []).map((item) => ({ ...item })),
    inbox: (data.inbox || []).map((item) => ({ ...item })),
    recycleBin: (data.recycleBin || []).map((entry) => ({ ...entry, payload: JSON.parse(JSON.stringify(entry.payload || {})) })),
    settings: backupSettings(data.settings || {}),
  };
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim().slice(0, 2048);
  if (!url) return null;
  const now = Date.now();
  return {
    id: genId('i'),
    url,
    title: String(raw.title || url).slice(0, 500),
    folderId: typeof raw.folderId === 'string' ? raw.folderId : UNCATEGORIZED_ID,
    tags: normalizeTags(raw.tags),
    note: String(raw.note || '').slice(0, 2000),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    pinned: !!raw.pinned,
    order: Number(raw.order) || 0,
  };
}

// mode: 'merge'（保留现有，按 URL 去重）| 'replace'（清空后导入）
export async function importPayload(payload, mode = 'merge') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw new Error('文件格式不正确：缺少 items 数组');
  }
  return mutate((data) => {
    if (mode === 'replace') {
      const fresh = defaultData();
      data.folders = fresh.folders;
      data.items = [];
      data.quickAccess = [];
      data.inbox = [];
      data.recycleBin = [];
      data.settings = { ...fresh.settings, ...(payload.settings || {}) };
    }
    // 文件夹合并：按 name+parentId 判重，建立 旧id → 现id 映射（根优先处理）
    const idMap = new Map();
    let foldersAdded = 0;
    const incoming = [...(payload.folders || [])].sort(
      (a, b) => (a && a.parentId ? 1 : 0) - (b && b.parentId ? 1 : 0)
    );
    for (const f of incoming) {
      if (!f || typeof f !== 'object' || !f.name) continue;
      if (f.id === UNCATEGORIZED_ID || f.system) {
        idMap.set(f.id, UNCATEGORIZED_ID);
        continue;
      }
      const parentNew = f.parentId ? idMap.get(f.parentId) ?? UNCATEGORIZED_ID : null;
      const name = String(f.name).trim().slice(0, 50) || '新建文件夹';
      const exists = data.folders.find(
        (x) => !x.system && x.name === name && x.parentId === parentNew
      );
      if (exists) {
        idMap.set(f.id, exists.id);
        continue;
      }
      const nf = {
        id: genId('f'),
        name,
        parentId: parentNew,
        order: data.folders.filter((x) => x.parentId === parentNew).length,
        createdAt: Date.now(),
      };
      data.folders.push(nf);
      idMap.set(f.id, nf.id);
      foldersAdded++;
    }

    let itemsAdded = 0;
    const existingUrls = new Set(data.items.map((it) => it.url));
    for (const raw of payload.items) {
      const it = sanitizeItem(raw);
      if (!it || !isCollectableUrl(it.url) || existingUrls.has(it.url)) continue;
      it.folderId = idMap.get(it.folderId) || UNCATEGORIZED_ID;
      it.order = data.items.length
        ? Math.max(...data.items.map((x) => x.order || 0)) + 1
        : 0;
      data.items.push(it);
      existingUrls.add(it.url);
      itemsAdded++;
    }

    if (mode === 'merge' || mode === 'replace') {
      const quick = Array.isArray(payload.quickAccess) ? payload.quickAccess.map(normalizeQuickItem).filter(Boolean) : [];
      const inbox = Array.isArray(payload.inbox) ? payload.inbox.map(normalizeInboxItem).filter(Boolean) : [];
      if (mode === 'replace' && Array.isArray(payload.recycleBin)) data.recycleBin = payload.recycleBin.filter((entry) => entry && entry.id && entry.payload);
      const quickUrls = new Set(data.quickAccess.map((item) => item.type === 'single' ? item.url : ''));
      for (const item of quick) {
        if (item.type === 'single' && quickUrls.has(item.url)) continue;
        item.order = data.quickAccess.length;
        data.quickAccess.push(item);
        if (item.type === 'single') quickUrls.add(item.url);
      }
      const inboxUrls = new Set(data.inbox.map((item) => item.url));
      for (const item of inbox) {
        if (inboxUrls.has(item.url)) continue;
        data.inbox.push(item);
        inboxUrls.add(item.url);
      }
    }
    return { foldersAdded, itemsAdded, mode };
  });
}
