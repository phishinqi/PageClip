// 本地预览用 chrome API mock（dev/preview.html 通过 js/boot.js 自动加载）。
// 数据持久化到 localStorage，接口行为尽量对齐 MV3 真实语义。

(() => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return;

  const LS_KEY = 'bc_mock_chrome_v1';

  // ———— mock 收藏数据 ————
  function defaultMockData() {
    const now = Date.now();
    const day = 86400000;
    return {
      schema: 3,
      folders: [
        { id: 'f_uncategorized', name: '未分类', parentId: null, order: 0, system: true },
        { id: 'f_work', name: '工作', parentId: null, order: 0, createdAt: now },
        { id: 'f_fe', name: '前端', parentId: 'f_work', order: 0, createdAt: now },
        { id: 'f_read', name: '待读', parentId: null, order: 1, createdAt: now },
      ],
      items: [
        { id: 'i_1', url: 'https://developer.chrome.com/docs/extensions/mv3/overview/', title: 'MV3 架构概览 - Chrome Developers', folderId: 'f_work', tags: ['chrome', '文档'], note: 'service worker 生命周期重点看', createdAt: now - 2 * day, updatedAt: now - day, pinned: true, order: 0 },
        { id: 'i_2', url: 'https://github.com/nicolestandifer3/vite', title: 'Vite - 下一代前端工具链', folderId: 'f_fe', tags: ['前端', '工具'], note: '', createdAt: now - 3 * day, updatedAt: now - 3 * day, pinned: true, order: 1 },
        { id: 'i_3', url: 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript', title: 'JavaScript | MDN', folderId: 'f_fe', tags: ['文档', '前端'], note: '参考资料', createdAt: now - 5 * day, updatedAt: now - 5 * day, pinned: false, order: 0 },
        { id: 'i_4', url: 'https://caniuse.com/', title: 'Can I use - 浏览器兼容性查询', folderId: 'f_work', tags: ['工具'], note: '', createdAt: now - 6 * day, updatedAt: now - 6 * day, pinned: false, order: 1 },
        { id: 'i_5', url: 'https://web.dev/articles/rendering-performance', title: '渲染性能 | web.dev', folderId: 'f_read', tags: ['待读', '性能'], note: '周末精读', createdAt: now - 10 * day, updatedAt: now - 10 * day, pinned: false, order: 0 },
      ],
      quickAccess: [
        { id: 'q_mock', type: 'single', title: 'Chrome 扩展文档', url: 'https://developer.chrome.com/docs/extensions/', favIconUrl: '', createdAt: now - day, updatedAt: now - day, pinned: true, order: 0 },
        { id: 'qg_mock', type: 'group', title: '本地演示集合', tabs: [
          { url: 'https://github.com/', title: 'GitHub', favIconUrl: '', groupId: 7, groupTitle: '演示', groupColor: 'blue' },
          { url: 'https://developer.mozilla.org/zh-CN/', title: 'MDN', favIconUrl: '', groupId: 7, groupTitle: '演示', groupColor: 'blue' },
        ], createdAt: now - 2 * day, updatedAt: now - day, pinned: false, order: 1 },
      ],
      inbox: [
        { id: 'in_mock_1', url: 'https://web.dev/learn/', title: 'Learn web development', favIconUrl: '', createdAt: now - day, updatedAt: now - day, readAt: null, source: 'pageclip' },
        { id: 'in_mock_2', url: 'https://developer.chrome.com/blog/', title: 'Chrome for Developers', favIconUrl: '', createdAt: now - 2 * day, updatedAt: now - 2 * day, readAt: now - day, source: 'pageclip' },
      ],
      recycleBin: [{ id: 'rb_mock', deletedAt: now - day, expiresAt: now + 29 * day, source: 'inbox', label: '演示回收批次', payload: { items: [{ id: 'old_in', url: 'https://example.com/old', title: '已删除演示', readAt: null }] } }],
      settings: { onboardingDone: true, sortMode: 'time', railExpanded: true, quickAccessExpanded: true, inboxExpanded: true },
    };
  }

  let mockData;
  try {
    mockData = JSON.parse(localStorage.getItem(LS_KEY)) || defaultMockData();
  } catch {
    mockData = defaultMockData();
  }
  const persist = () => localStorage.setItem(LS_KEY, JSON.stringify(mockData));

  // ———— mock Chrome 书签树 ————
  const bmTree = {
    id: '0',
    parentId: null,
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        index: 0,
        title: '书签栏',
        children: [
          { id: '10', parentId: '1', index: 0, title: 'GitHub', url: 'https://github.com/', dateAdded: 1 },
          {
            id: '11',
            parentId: '1',
            index: 1,
            title: '开发工具',
            children: [
              { id: '110', parentId: '11', index: 0, title: 'Chrome DevTools 文档', url: 'https://developer.chrome.com/docs/devtools', dateAdded: 2 },
              { id: '111', parentId: '11', index: 1, title: 'Can I use', url: 'https://caniuse.com/', dateAdded: 3 },
            ],
          },
          { id: '12', parentId: '1', index: 2, title: 'Chromium 源码搜索', url: 'https://source.chromium.org/', dateAdded: 4 },
        ],
      },
      {
        id: '2',
        parentId: '0',
        index: 1,
        title: '其他书签',
        children: [
          { id: '20', parentId: '2', index: 0, title: 'Hacker News', url: 'https://news.ycombinator.com/', dateAdded: 5 },
        ],
      },
    ],
  };

  let bmNextId = 1000;
  const listeners = { created: [], removed: [], changed: [], moved: [], alarm: [], storage: null };
  const readingEntries = [
    { url: 'https://web.dev/articles/learn-css', title: 'Learn CSS - web.dev', hasBeenRead: false, creationTime: Date.now() - 86400000, lastUpdateTime: Date.now() - 86400000 },
    { url: 'https://developer.chrome.com/blog/reading-list', title: 'Chrome Reading List', hasBeenRead: true, creationTime: Date.now() - 3 * 86400000, lastUpdateTime: Date.now() - 2 * 86400000 },
  ];
  const contextMenuListeners = [];
  let readingPermission = true;
  const fire = (name, ...args) => listeners[name].forEach((f) => setTimeout(() => f(...args), 0));

  function bmWalk(node, fn, parent) {
    fn(node, parent);
    (node.children || []).forEach((c) => bmWalk(c, fn, node));
  }
  function bmFind(id) {
    let found = null;
    let foundParent = null;
    bmWalk(bmTree, (n, p) => {
      if (n.id === id) { found = n; foundParent = p; }
    });
    return { node: found, parent: foundParent };
  }
  function bmRemoveAt(parent, id) {
    if (!parent || !parent.children) return null;
    const i = parent.children.findIndex((c) => c.id === id);
    if (i >= 0) return parent.children.splice(i, 1)[0];
    return null;
  }

  function bmReindex() {
    bmWalk(bmTree, (node) => {
      (node.children || []).forEach((child, index) => {
        child.parentId = node.id;
        child.index = index;
      });
    });
  }

  function dual(v, cb) {
    if (typeof cb === 'function') setTimeout(() => cb(v), 0);
    return Promise.resolve(v);
  }

  function openMockUrl(url) {
    if (!url) return;
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (!popup) {
      // 预览页面位于 iframe 中，回退时导航外层窗口，模拟更新当前标签页。
      (window.top || window).location.assign(url);
    }
  }

  const chromeMock = {
    runtime: { id: 'mock-extension-id', getURL(path) { return String(path || ''); } },
    i18n: { getUILanguage() { return window.__pageclipMockLocale || 'zh-CN'; } },
    identity: {
      async getAuthToken() { if (!mockAuthEnabled) throw new Error('模拟 OAuth 被拒绝'); return { token: 'mock-google-token' }; },
      async getProfileUserInfo() { return { email: 'pageclip.mock@gmail.com', id: 'mock-account' }; },
      async removeCachedAuthToken() {},
      async clearAllCachedAuthTokens() {},
    },
    storage: {
      local: {
        get(key, cb) {
          const keys = key == null ? ['bc_data'] : Array.isArray(key) ? key : [key];
          const out = {};
          if (keys.includes('bc_data') && mockData) out.bc_data = mockData;
          return dual(out, cb);
        },
        set(obj, cb) {
          const oldValue = mockData;
          if ('bc_data' in obj) mockData = obj.bc_data;
          persist();
          if (listeners.storage) {
            setTimeout(() => listeners.storage({ bc_data: { oldValue, newValue: mockData } }, 'local'), 0);
          }
          return dual(undefined, cb);
        },
        remove(key, cb) { return dual(undefined, cb); },
      },
      onChanged: {
        addListener(f) { listeners.storage = f; },
      },
    },
    bookmarks: {
      getTree(cb) { return dual([bmTree], cb); },
      create(obj, cb) {
        const { node: parent } = bmFind(obj.parentId);
        if (!parent || !parent.children) throw new Error('parent not found');
        const node = {
          id: String(bmNextId++),
          parentId: obj.parentId,
          index: parent.children.length,
          title: obj.title || '',
          dateAdded: Date.now(),
        };
        if (obj.url) node.url = obj.url;
        else node.children = [];
        parent.children.push(node);
        bmReindex();
        fire('created', node.id, node);
        return dual(node, cb);
      },
      update(id, changes, cb) {
        const { node } = bmFind(id);
        if (changes.title !== undefined) node.title = changes.title;
        if (changes.url !== undefined) node.url = changes.url;
        bmReindex();
        fire('changed', id, changes);
        return dual(node, cb);
      },
      remove(id, cb) {
        const { parent } = bmFind(id);
        bmRemoveAt(parent, id);
        bmReindex();
        fire('removed', id, { parentId: parent.id, index: 0 });
        return dual(undefined, cb);
      },
      removeTree(id, cb) {
        const { parent } = bmFind(id);
        bmRemoveAt(parent, id);
        bmReindex();
        fire('removed', id, { parentId: parent.id, index: 0 });
        return dual(undefined, cb);
      },
      move(id, dest, cb) {
        const { node, parent } = bmFind(id);
        if (!node || !parent) throw new Error('node not found');
        const oldIndex = node.index ?? parent.children.findIndex((c) => c.id === id);
        const target = bmFind(dest.parentId).node;
        if (!target || !target.children) throw new Error('target parent not found');
        let index = dest.index;
        if (index === undefined || index === null) index = target.children.length;
        // 对齐 Chromium BookmarkModel::Move：同层且 index > oldIndex 时内部 index--
        if (parent === target && index > oldIndex) index--;
        if (parent === target && (index === oldIndex || index === oldIndex + 1)) {
          return dual(node, cb); // 无操作
        }
        bmRemoveAt(parent, id);
        index = Math.min(index, target.children.length);
        target.children.splice(index, 0, node);
        node.parentId = target.id;
        bmReindex();
        fire('moved', id, { parentId: dest.parentId, index });
        return dual(node, cb);
      },
      onChanged: mkListener('changed'),
      onCreated: mkListener('created'),
      onRemoved: mkListener('removed'),
      onMoved: mkListener('moved'),
    },
    tabs: {
      async query(q) {
        return [
          { id: 900, index: 0, url: 'https://developer.chrome.com/docs/extensions/mv3/overview/', title: 'MV3 架构概览 - Chrome Developers', favIconUrl: '', active: true, groupId: -1 },
          { id: 901, index: 1, url: 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript', title: 'JavaScript | MDN', favIconUrl: '', active: false, groupId: -1 },
          { id: 902, index: 2, url: 'https://github.com/', title: 'GitHub', favIconUrl: '', active: false, groupId: -1 },
        ];
      },
      async create(o) {
        openMockUrl(o.url);
        return { id: 901, url: o.url };
      },
      async update(id, o) {
        openMockUrl(o.url);
        return { id, url: o.url };
      },
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setTitle() {},
    },
    commands: {
      async getAll() {
        return [
          { name: 'collect-current-page', shortcut: 'Ctrl+Shift+S' },
          { name: 'add-to-quick-access', shortcut: 'Ctrl+Shift+Q' },
          { name: 'add-to-inbox', shortcut: 'Ctrl+Shift+R' },
        ];
      },
      onCommand: { addListener() {} },
    },
    sidePanel: { setPanelBehavior() { return Promise.resolve(); } },
    alarms: { create() {}, onAlarm: mkListener('alarm') },
    permissions: {
      async contains() { return readingPermission; },
      async request() { readingPermission = true; return true; },
    },
    readingList: {
      async query() { return [...readingEntries]; },
      async addEntry(entry) {
        const existing = readingEntries.find((item) => item.url === entry.url);
        if (existing) Object.assign(existing, entry);
        else readingEntries.push({ ...entry, creationTime: Date.now(), lastUpdateTime: Date.now() });
      },
      async updateEntry(query, changes) {
        const item = readingEntries.find((entry) => entry.url === query.url);
        if (item) Object.assign(item, changes, { lastUpdateTime: Date.now() });
      },
      async removeEntry(query) {
        const index = readingEntries.findIndex((entry) => entry.url === query.url);
        if (index >= 0) readingEntries.splice(index, 1);
      },
    },
    contextMenus: {
      create() {},
      removeAll() { return Promise.resolve(); },
      onClicked: { addListener(fn) { contextMenuListeners.push(fn); } },
    },
  };

  function mkListener(name) {
    return { addListener(f) { listeners[name].push(f); } };
  }

  window.chrome = chromeMock;
  const nativeFetch = window.fetch?.bind(window);
  const driveResponse = (body, status = 200) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.__pageclipMockDrive = { files: mockDriveFiles, setAuthEnabled(value) { mockAuthEnabled = !!value; } };
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.includes('www.googleapis.com/drive/v3') && !url.includes('www.googleapis.com/upload/drive/v3')) return nativeFetch ? nativeFetch(input, init) : driveResponse({});
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = String(init.method || 'GET').toUpperCase();
    if (path.endsWith('/files') && method === 'GET') {
      const files = mockDriveFiles.filter((file) => !file.trashed && file.name === 'PageClip-latest.enc').sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime))).map(({ content, ...file }) => file);
      return driveResponse({ files });
    }
    if (path.endsWith('/files') && method === 'POST') {
      const metadata = JSON.parse(init.body || '{}');
      const now = new Date().toISOString();
      const file = { id: 'mock-drive-' + mockDriveNextId++, name: metadata.name, mimeType: metadata.mimeType, size: '0', createdTime: now, modifiedTime: now, content: '' };
      mockDriveFiles.push(file);
      return driveResponse({ ...file, content: undefined });
    }
    const idMatch = path.match(/\/files\/([^/]+)$/);
    if (idMatch) {
      const file = mockDriveFiles.find((item) => item.id === decodeURIComponent(idMatch[1]));
      if (!file) return driveResponse({ error: { message: 'File not found' } }, 404);
      if (method === 'DELETE') { file.trashed = true; return driveResponse(null, 204); }
      if (method === 'GET' && parsed.searchParams.get('alt') === 'media') return driveResponse(JSON.parse(file.content || '{}'));
    }
    const uploadMatch = path.match(/\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (uploadMatch && method === 'PATCH') {
      const file = mockDriveFiles.find((item) => item.id === decodeURIComponent(uploadMatch[1]));
      if (!file) return driveResponse({ error: { message: 'File not found' } }, 404);
      file.content = typeof init.body === 'string' ? init.body : await init.body.text(); file.size = String(new TextEncoder().encode(file.content).byteLength); file.modifiedTime = new Date().toISOString();
      const { content, ...withoutContent } = file; return driveResponse(withoutContent);
    }
    return driveResponse({ error: { message: 'Unsupported mock Drive request' } }, 400);
  };
  console.log('[mock] chrome API mock 已加载（本地预览模式）');
})();
