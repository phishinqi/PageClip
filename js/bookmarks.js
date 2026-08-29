// 「Chrome 书签」页签：完整管理 —— 浏览、新建、重命名/编辑、删除、移动（拖拽 + 移动到…）。

import {
  h,
  icon,
  faviconEl,
  showModal,
  formDialog,
  confirmDialog,
  contextMenu,
  toast,
  openUrl,
} from './ui.js';
import { createDnd, chromeMoveIndex, isSamePlace, wouldCycle } from './tree.js';

export function createBookmarksTab(ctx) {
  let loaded = false;
  let rootTree = null;
  const byId = new Map();
  const permanent = new Set(); // 根节点(0)的直接子节点：书签栏 / 其他书签等，不可拖拽/删除
  const expanded = new Set();
  const selectedBookmarks = new Set();
  let selectedBookmarkAnchor = null;

  const scroll = ctx.scrollEl;

  const header = h(
    'div',
    { class: 'bm-header' },
    h('button', { class: 'btn btn-ghost sm', onclick: () => newBookmark(barId()) }, icon('plus', 14), '书签'),
    h('button', { class: 'btn btn-ghost sm', onclick: () => newFolder(barId()) }, icon('folderPlus', 14), '文件夹'),
    h('span', { class: 'flex1' }),
    h(
      'button',
      { class: 'btn btn-ghost sm', title: '把当前标签页加入书签栏', onclick: quickAddCurrent },
      icon('bookmark', 14),
      '收藏当前页'
    )
  );

  // ———— 数据 ————

  async function reload() {
    const [root] = await chrome.bookmarks.getTree();
    rootTree = root;
    byId.clear();
    walk(root);
    for (const id of [...selectedBookmarks]) if (!byId.has(id)) selectedBookmarks.delete(id);
    render();
  }

  function walk(node) {
    byId.set(node.id, node);
    if (node.parentId === '0') permanent.add(node.id);
    (node.children || []).forEach(walk);
  }

  function isPermanent(id) {
    return permanent.has(id);
  }

  function barId() {
    return byId.has('1') ? '1' : (rootTree?.children?.[0]?.id || '1');
  }

  function countUrls(node) {
    if (node.url) return 1;
    return (node.children || []).reduce((n, c) => n + countUrls(c), 0);
  }

  function pathOf(node) {
    const parts = [];
    let cur = node.parentId ? byId.get(node.parentId) : null;
    while (cur && cur.parentId) {
      parts.unshift(cur.title || '未命名');
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return parts.join(' / ');
  }

  // ———— 渲染 ————

  function render() {
    scroll.replaceChildren();
    if (!rootTree) return;
    for (const child of rootTree.children || []) appendTreeNode(scroll, child, 0);
  }

  function appendTreeNode(container, node, depth) {
    const row = nodeRow(node, depth);
    container.append(row);
    if (!node.url && (node.children || []).length) {
      const isExpanded = expanded.has(node.id);
      const childWrap = h('div', {
        class: `folder-children bm-folder-children${isExpanded ? ' is-expanded' : ''}`,
        dataset: { parentFolder: node.id },
      });
      for (const child of node.children || []) appendTreeNode(childWrap, child, depth + 1);
      container.append(childWrap);
    }
  }

  function nodeRow(node, depth) {
    const isFolder = !node.url;
    const perm = isFolder && isPermanent(node.id);
    const hasChildren = isFolder && (node.children || []).length > 0;
    const row = h('div', {
      class: `row ${isFolder ? 'row-folder' : 'row-url'}${!isFolder && selectedBookmarks.has(node.id) ? ' is-selected' : ''}`,
      draggable: perm ? null : 'true',
      tabindex: '0',
      role: isFolder ? 'treeitem' : 'button',
      'aria-pressed': !isFolder ? String(selectedBookmarks.has(node.id)) : null,
      'aria-label': node.title || (node.url ? node.url : '未命名'),
      'aria-expanded': isFolder && hasChildren ? String(expanded.has(node.id)) : null,
      dataset: {
        id: node.id,
        kind: isFolder ? 'bm-folder' : 'bm-url',
        ...(perm ? { nodrag: '1' } : {}),
      },
    });
    row.style.paddingLeft = `${8 + depth * 14}px`;

    const caret = hasChildren
      ? h('span', { class: `caret${expanded.has(node.id) ? ' open' : ''}` }, icon('chevron', 14))
      : h('span', { class: 'caret ph' });

    const ico = isFolder
      ? h('span', { class: 'row-ico folder' }, icon('folder', 16))
      : faviconEl(node.url, 16);
    const title = h('span', { class: 'row-title', text: node.title || (node.url ? node.url : '未命名') });
    const urlMeta = !isFolder ? h('span', { class: 'bookmark-url', text: node.url }) : null;
    const count = hasChildren
      ? h('span', { class: 'row-count', text: String(countUrls(node)) })
      : null;

    const actions = h('span', { class: `row-actions${isFolder ? '' : ' card-actions'}` });
    if (isFolder) actions.append(actBtn('plus', '在此新建书签', () => newBookmark(node.id)));
    actions.append(actBtn('edit', isFolder ? '重命名' : '编辑', () => (isFolder ? renameFolder(node) : editBookmark(node))));
    if (!isFolder) actions.append(actBtn('swap', '剪切到文件夹', () => moveToPicker(node)));
    if (!perm) actions.append(actBtn('trash', '删除', () => removeNode(node)));

    const content = isFolder
      ? h('span', { class: 'bookmark-row-content' }, title)
      : h('span', { class: 'bookmark-row-content' }, title, urlMeta);
    row.append(caret, ico, content);
    if (count) row.append(count);
    row.append(actions);

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      if (isFolder) {
        toggleExpand(node.id);
      } else {
        if (e.detail > 1) return;
        selectBookmark(node.id, e);
      }
    });
    if (!isFolder) {
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.row-actions')) return;
        openUrl(node.url, { newTab: true });
      });
    }
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.row-actions')) {
        e.preventDefault();
        if (isFolder) toggleExpand(node.id);
        else openUrl(node.url, { newTab: true });
      }
    });
    row.addEventListener('auxclick', (e) => {
      if (!isFolder && e.button === 1) {
        e.preventDefault();
        openUrl(node.url, { newTab: true });
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, menuFor(node, isFolder, perm));
    });
    return row;
  }

  function actBtn(name, title, onClick) {
    return h('button', { class: 'act-btn', title, onclick: (e) => { e.stopPropagation(); onClick(); } }, icon(name, 14));
  }

  function menuFor(node, isFolder, perm) {
    if (isFolder) {
      const items = [
        { label: '新建书签', icon: 'plus', onClick: () => newBookmark(node.id) },
        { label: '新建子文件夹', icon: 'folderPlus', onClick: () => newFolder(node.id) },
        { sep: true },
      ];
      if (!perm) {
        items.push(
          { label: '重命名', icon: 'edit', onClick: () => renameFolder(node) },
          { label: '移动到…', icon: 'swap', onClick: () => moveToPicker(node) },
          { label: '删除', icon: 'trash', danger: true, onClick: () => removeNode(node) }
        );
      }
      return items;
    }
    return [
      { label: '在新标签页打开', icon: 'open', onClick: () => openUrl(node.url, { ctrlKey: true }) },
      { label: '编辑', icon: 'edit', onClick: () => editBookmark(node) },
      { label: '移动到…', icon: 'swap', onClick: () => moveToPicker(node) },
      { sep: true },
      { label: '删除', icon: 'trash', danger: true, onClick: () => removeNode(node) },
    ];
  }

  function selectBookmark(id, event) {
    const rows = [...scroll.querySelectorAll('.row-url')];
    const index = rows.findIndex((row) => row.dataset.id === id);
    if (event.shiftKey && selectedBookmarkAnchor) {
      const anchorIndex = rows.findIndex((row) => row.dataset.id === selectedBookmarkAnchor);
      if (anchorIndex >= 0 && index >= 0) {
        const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        if (!event.ctrlKey && !event.metaKey) selectedBookmarks.clear();
        rows.slice(lo, hi + 1).forEach((row) => selectedBookmarks.add(row.dataset.id));
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (selectedBookmarks.has(id)) selectedBookmarks.delete(id);
      else selectedBookmarks.add(id);
    } else {
      selectedBookmarks.clear();
      selectedBookmarks.add(id);
    }
    selectedBookmarkAnchor = id;
    syncBookmarkSelection();
  }

  function syncBookmarkSelection() {
    scroll.querySelectorAll('.row-url').forEach((row) => {
      const selected = selectedBookmarks.has(row.dataset.id);
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-pressed', String(selected));
    });
  }

  function toggleExpand(id) {
    const next = !expanded.has(id);
    if (next) expanded.add(id);
    else expanded.delete(id);
    const safeId = CSS.escape(id);
    const childWrap = scroll.querySelector(`.bm-folder-children[data-parent-folder="${safeId}"]`);
    const row = scroll.querySelector(`.row[data-id="${safeId}"]`);
    childWrap?.classList.toggle('is-expanded', next);
    row?.setAttribute('aria-expanded', String(next));
    row?.querySelector('.caret')?.classList.toggle('open', next);
  }

  // ———— 增删改 ————

  function normalizeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return s;
    return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  }

  async function newBookmark(parentId) {
    const v = await formDialog({
      title: '新建书签',
      fields: [
        { key: 'title', label: '名称', value: '', placeholder: '书签名称' },
        { key: 'url', label: '网址', value: '', placeholder: 'https://…' },
      ],
      validate: (vals) => (vals.url ? null : '网址不能为空'),
    });
    if (!v) return;
    const url = normalizeUrl(v.url);
    await chrome.bookmarks.create({ parentId, title: v.title || url, url });
    expanded.add(parentId);
    await reload();
    toast('已创建书签');
  }

  async function newFolder(parentId) {
    const v = await formDialog({
      title: '新建文件夹',
      fields: [{ key: 'title', label: '名称', value: '', placeholder: '文件夹名称' }],
      validate: (vals) => (vals.title ? null : '名称不能为空'),
    });
    if (!v) return;
    await chrome.bookmarks.create({ parentId, title: v.title });
    expanded.add(parentId);
    await reload();
    toast('已创建文件夹');
  }

  async function editBookmark(node) {
    const v = await formDialog({
      title: '编辑书签',
      fields: [
        { key: 'title', label: '名称', value: node.title },
        { key: 'url', label: '网址', value: node.url },
      ],
      validate: (vals) => (vals.url ? null : '网址不能为空'),
    });
    if (!v) return;
    await chrome.bookmarks.update(node.id, { title: v.title || node.title, url: normalizeUrl(v.url) });
    await reload();
    toast('已保存');
  }

  async function renameFolder(node) {
    const v = await formDialog({
      title: '重命名文件夹',
      fields: [{ key: 'title', label: '名称', value: node.title }],
      validate: (vals) => (vals.title ? null : '名称不能为空'),
    });
    if (!v) return;
    await chrome.bookmarks.update(node.id, { title: v.title });
    await reload();
    toast('已保存');
  }

  async function removeNode(node) {
    if (node.url) {
      const ok = await confirmDialog({
        title: '删除书签',
        message: `删除书签「${node.title || node.url}」？`,
        okLabel: '删除',
      });
      if (!ok) return;
      await chrome.bookmarks.remove(node.id);
    } else {
      const n = countUrls(node);
      const ok = await confirmDialog({
        title: '删除文件夹',
        message: `删除文件夹「${node.title || '未命名'}」及其中的 ${n} 个书签？`,
        okLabel: '删除',
      });
      if (!ok) return;
      await chrome.bookmarks.removeTree(node.id);
    }
    await reload();
    toast('已删除');
  }

  // ———— 移动到…（文件夹选择器） ————

  async function moveToPicker(node) {
    const flat = [];
    const pushFolder = (parent, depth) => {
      for (const c of parent.children || []) {
        if (c.url) continue;
        flat.push({ node: c, depth });
        pushFolder(c, depth + 1);
      }
    };
    for (const c of rootTree.children || []) {
      flat.push({ node: c, depth: 0 });
      pushFolder(c, 1);
    }
    const targets = flat.filter(
      (f) => f.node.id !== node.id && !wouldCycle(byId, node.id, f.node.id)
    );
    const m = h('div', { class: 'picker' });
    let modalApi;
    for (const f of targets) {
      const row = h(
        'div',
        { class: 'picker-row' },
        h('span', { class: 'row-ico folder' }, icon('folder', 15)),
        h('span', { class: 'row-title', text: f.node.title || '未命名' })
      );
      row.style.paddingLeft = `${8 + f.depth * 14}px`;
      row.addEventListener('click', async () => {
        modalApi.close();
        await chrome.bookmarks.move(node.id, { parentId: f.node.id });
        expanded.add(f.node.id);
        await reload();
        toast(`已移动到「${f.node.title || '未命名'}」`);
      });
      m.append(row);
    }
    modalApi = showModal({
      title: `移动「${node.title || (node.url ? '书签' : '未命名')}」到…`,
      body: m,
      buttons: [{ label: '取消', kind: 'ghost' }],
    });
  }

  // ———— 拖拽 ————

  createDnd({
    container: scroll,
    rowSelector: '.row',
    getPayload: (row) => ({ kind: row.dataset.kind, id: row.dataset.id }),
    policy: (drag, row) => {
      const t = byId.get(row.dataset.id);
      if (!t || t.id === drag.id) return null;
      if (row.dataset.kind === 'bm-folder') {
        if (drag.kind === 'bm-folder') {
          if (isPermanent(t.id)) return { zones: ['into'] };
          return { zones: ['before', 'into', 'after'] };
        }
        return { zones: ['into'] };
      }
      return { zones: ['before', 'after'] };
    },
    onDrop: async (drag, row, zone) => {
      const d = byId.get(drag.id);
      const t = byId.get(row.dataset.id);
      if (!d || !t || d.id === t.id) return;
      if (zone === 'into') {
        if (wouldCycle(byId, d.id, t.id)) throw new Error('不能移动到自身的子文件夹中');
        await chrome.bookmarks.move(d.id, { parentId: t.id });
        expanded.add(t.id);
      } else {
        // before/after：目标父级若在被拖文件夹子树内，同样是移入自身 → 拒绝
        if (!d.url && t.parentId !== d.parentId && wouldCycle(byId, d.id, t.parentId)) {
          throw new Error('不能移动到自身的子文件夹中');
        }
        const index = chromeMoveIndex(t, zone);
        if (!isSamePlace(d, t.parentId, index)) {
          await chrome.bookmarks.move(d.id, { parentId: t.parentId, index });
        }
      }
      await reload();
    },
  });

  // ———— 书签变更实时刷新 ————

  const liveReload = debounceReload();
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) {
    chrome.bookmarks[ev].addListener(() => {
      if (loaded) liveReload();
    });
  }

  function debounceReload() {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => reload(), 150);
    };
  }

  // ———— 当前页加入书签栏 ————

  async function quickAddCurrent() {
    const tab = await ctx.getActiveTab();
    if (!tab || !tab.url) {
      toast('无法读取当前页面', 'error');
      return;
    }
    await chrome.bookmarks.create({ parentId: barId(), title: tab.title || tab.url, url: tab.url });
    expanded.add(barId());
    await reload();
    toast('已加入书签栏');
  }

  // ———— 搜索（供全局搜索调用） ————

  function searchAll(textTokens) {
    if (!textTokens.length) return [];
    const out = [];
    for (const node of byId.values()) {
      if (!node.url) continue;
      const hay = `${node.title}\n${node.url}`.toLowerCase();
      if (textTokens.every((tk) => hay.includes(tk))) out.push({ node, path: pathOf(node) });
      if (out.length >= 50) break;
    }
    return out;
  }

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    await reload();
    // 默认展开书签栏
    if (rootTree) for (const c of rootTree.children || []) expanded.add(c.id);
    render();
  }

  return { header, scroll, reload, ensureLoaded, searchAll };
}
