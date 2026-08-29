// 全局统一搜索：同时搜「插件收藏」与「Chrome 书签」，结果分组显示。
// 语法：普通词匹配 标题/网址/备注/标签；#标签名 只匹配标签（大小写不敏感，包含匹配）。

import { h, icon, faviconEl, highlight, openUrl, fmtTime, hostOf } from './ui.js';

const selectedSearch = new Set();

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

  // ———— Chrome 书签（仅文本词） ————
  const bms = ctx.searchBookmarks(textTokens);

  scroll.replaceChildren();
  scroll.append(
    h('div', { class: 'search-summary' },
      `共 ${items.length + bms.length} 条结果`,
      tagTokens.length ? h('span', { class: 'dim' }, '　标签过滤：' + tagTokens.map((t) => '#' + t).join(' ')) : null
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
      row.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        const key = `collection:${it.id}`;
        if (e.ctrlKey || e.metaKey) {
          if (selectedSearch.has(key)) selectedSearch.delete(key);
          else selectedSearch.add(key);
        } else {
          selectedSearch.clear();
          selectedSearch.add(key);
        }
        row.classList.toggle('is-selected', selectedSearch.has(key));
        row.setAttribute('aria-pressed', String(selectedSearch.has(key)));
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
    for (const { node, path } of bms) {
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
      row.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        const key = `bookmark:${node.id}`;
        if (e.ctrlKey || e.metaKey) {
          if (selectedSearch.has(key)) selectedSearch.delete(key);
          else selectedSearch.add(key);
        } else {
          selectedSearch.clear();
          selectedSearch.add(key);
        }
        row.classList.toggle('is-selected', selectedSearch.has(key));
        row.setAttribute('aria-pressed', String(selectedSearch.has(key)));
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
        h('div', { class: 'empty-hint', text: '试试更短的关键词；#标签名 只过滤插件收藏的标签' })
      )
    );
  }
}

function groupLabel(icoName, text) {
  return h('div', { class: 'search-group' }, icon(icoName, 14), h('span', { text }));
}

function folderName(folderId, data) {
  const f = data.folders.find((x) => x.id === folderId);
  return f ? f.name : '未分类';
}
