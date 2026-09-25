// 全局统一搜索：同时搜「插件收藏」与「Chrome 书签」，结果分组显示。
// 语法：普通词匹配 标题/网址/备注/标签；#标签名 只匹配标签（大小写不敏感，包含匹配）。
// Chrome 书签的标签按网址与收藏共享，同样参与匹配。
// 结果可多选（Ctrl 切换、Shift 连选），选中后可以批量编辑标签。

import { h, icon, faviconEl, highlight, openUrl, fmtTime, hostOf } from './ui.js';
import { t } from './i18n.js';
import { openBatchTagEditor } from './tag-editor.js';

const selectedSearch = new Set();
let selectionAnchor = null;

export function parseQuery(q) {
  const tagTokens = [];
  const textTokens = [];
  for (const raw of String(q || '').trim().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('#') && raw.length > 1) tagTokens.push(raw.slice(1).toLowerCase());
    else textTokens.push(raw.toLowerCase());
  }
  return { tagTokens, textTokens };
}

export function renderSearch(scroll, query, ctx) {
  const { tagTokens, textTokens } = parseQuery(query);
  const data = ctx.getData();
  const markTokens = [...textTokens, ...tagTokens];

  // ———— 插件收藏 ————
  const items = data.items
    .filter((it) => {
      const tags = (it.tags || []).map((t) => t.toLowerCase());
      if (!tagTokens.every((tt) => tags.some((t) => t.includes(tt)))) return false;
      const hay = `${it.title}\n${it.url}\n${it.note || ''}\n${tags.join('\n')}`.toLowerCase();
      return textTokens.every((tk) => hay.includes(tk));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // ———— Chrome 书签 ————
  const bms = ctx.searchBookmarks(textTokens, tagTokens);

  // 结果的显示顺序和网址，供 Shift 连选、全选和批量编辑标签使用；不在本次结果里的选中项丢掉。
  const urlByKey = new Map();
  for (const it of items) urlByKey.set(`collection:${it.id}`, it.url);
  for (const { node } of bms) urlByKey.set(`bookmark:${node.id}`, node.url);
  const keys = [...urlByKey.keys()];
  for (const key of [...selectedSearch]) if (!urlByKey.has(key)) selectedSearch.delete(key);
  if (!urlByKey.has(selectionAnchor)) selectionAnchor = null;
  const rows = new Map();
  const toolbar = h('span', { class: 'selection-toolbar search-selection-toolbar' });

  function syncSelection() {
    for (const [key, row] of rows) {
      row.classList.toggle('is-selected', selectedSearch.has(key));
      row.setAttribute('aria-pressed', String(selectedSearch.has(key)));
    }
    toolbar.replaceChildren();
    if (!keys.length) return;
    toolbar.append(
      h('span', { class: 'selection-count', text: t('selection.count', { COUNT: selectedSearch.size }) }),
      h('button', { class: 'text-btn', onclick: () => { keys.forEach((key) => selectedSearch.add(key)); syncSelection(); } }, t('button.selectAll')),
      h('button', { class: 'text-btn', disabled: !selectedSearch.size, onclick: () => { selectedSearch.clear(); selectionAnchor = null; syncSelection(); } }, t('button.clearShort')),
      h('button', { class: 'text-btn', disabled: !selectedSearch.size, onclick: editSelectedTags }, t('tags.button'))
    );
  }

  function selectResult(key, event) {
    if (event.shiftKey && selectionAnchor) {
      const [lo, hi] = [keys.indexOf(selectionAnchor), keys.indexOf(key)].sort((a, b) => a - b);
      if (!event.ctrlKey && !event.metaKey) selectedSearch.clear();
      keys.slice(lo, hi + 1).forEach((k) => selectedSearch.add(k));
    } else if (event.ctrlKey || event.metaKey) {
      if (selectedSearch.has(key)) selectedSearch.delete(key);
      else selectedSearch.add(key);
    } else {
      selectedSearch.clear();
      selectedSearch.add(key);
    }
    selectionAnchor = key;
    syncSelection();
  }

  function editSelectedTags() {
    const urls = [...selectedSearch].map((key) => urlByKey.get(key)).filter(Boolean);
    openBatchTagEditor({ urls, data: ctx.getData(), onDone: () => ctx.refresh?.() });
  }

  scroll.replaceChildren();
  scroll.append(
    h('div', { class: 'search-summary' },
      h('span', {},
        `共 ${items.length + bms.length} 条结果`,
        tagTokens.length ? h('span', { class: 'dim' }, '　标签过滤：' + tagTokens.map((t) => '#' + t).join(' ')) : null
      ),
      toolbar
    )
  );

  if (items.length) {
    scroll.append(groupLabel('bookmark', `插件收藏（${items.length}）`));
    for (const it of items) {
      const row = h('div', {
        class: `card search-result-card${selectedSearch.has(`collection:${it.id}`) ? ' is-selected' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-pressed': String(selectedSearch.has(`collection:${it.id}`)),
        'aria-label': `${it.title || it.url}，${hostOf(it.url) || it.url}`,
      });
      const actions = h('span', { class: 'row-actions' }, h('span', { class: 'flex1' }));
      row.append(
        h('div', { class: 'card-top' }, faviconEl(it.url, 16), highlight(it.title || it.url, markTokens), actions),
        h('div', { class: 'card-meta' },
          h('span', { text: hostOf(it.url) || it.url.slice(0, 40) }),
          h('span', { text: folderName(it.folderId, data) }),
          h('span', { text: fmtTime(it.createdAt) })
        )
      );
      if ((it.tags || []).length) {
        row.append(
          h('div', { class: 'card-tags' },
            it.tags.map((t) => h('span', { class: 'mini-tag' }, highlight(`#${t}`, markTokens)))
          )
        );
      }
      if (it.note) row.append(h('div', { class: 'card-note' }, highlight(it.note, markTokens)));
      rows.set(`collection:${it.id}`, row);
      row.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        selectResult(`collection:${it.id}`, e);
      });
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.row-actions, .mini-tag')) return;
        openUrl(it.url, { newTab: true });
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openUrl(it.url, { newTab: true });
        }
      });
      row.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          openUrl(it.url, { newTab: true });
        }
      });
      scroll.append(row);
    }
  }

  if (bms.length) {
    scroll.append(groupLabel('folder', `Chrome 书签（${bms.length}）`));
    for (const { node, path, tags = [] } of bms) {
      const row = h('div', {
        class: `search-result-card${selectedSearch.has(`bookmark:${node.id}`) ? ' is-selected' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-pressed': String(selectedSearch.has(`bookmark:${node.id}`)),
        'aria-label': `${node.title || node.url}，${node.url}`,
      });
      row.append(faviconEl(node.url, 16));
      row.append(h('span', { class: 'row-title' }, highlight(node.title || node.url, markTokens)));
      row.append(
        h('span', { class: 'bm-sub' },
          highlight(node.url, markTokens),
          path ? h('span', { class: 'dim' }, `　·　${path}`) : null
        )
      );
      if (tags.length) {
        row.append(h('div', { class: 'card-tags' }, tags.map((t) => h('span', { class: 'mini-tag' }, highlight(`#${t}`, markTokens)))));
      }
      rows.set(`bookmark:${node.id}`, row);
      row.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        selectResult(`bookmark:${node.id}`, e);
      });
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.row-actions')) return;
        openUrl(node.url, { newTab: true });
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openUrl(node.url, { newTab: true });
        }
      });
      row.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          openUrl(node.url, { newTab: true });
        }
      });
      scroll.append(row);
    }
  }

  if (!items.length && !bms.length) {
    scroll.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-ico' }, icon('search', 36)),
        h('div', { class: 'empty-title', text: '没有匹配结果' }),
        h('div', { class: 'empty-hint', text: '试试更短的关键词；#标签名 会同时过滤收藏和 Chrome 书签' })
      )
    );
  }
  syncSelection();
}

function groupLabel(icoName, text) {
  return h('div', { class: 'search-group' }, icon(icoName, 14), h('span', { text }));
}

function folderName(folderId, data) {
  const f = data.folders.find((x) => x.id === folderId);
  return f ? f.name : '未分类';
}
