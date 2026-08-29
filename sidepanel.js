// 侧边栏主入口：状态管理、双页签切换、全局搜索与新手引导。

import {
  ensureDataInitialized,
  pruneRecycleBin,
  loadData,
  collectIntoStorage,
  isCollectableUrl,
  updateSettings,
} from './js/store.js';
import { h, icon, toast, showModal, debounce } from './js/ui.js';
import { initI18n, applyI18n, onLocaleChanged } from './js/i18n.js';
import { createCollectionTab } from './js/collection.js';
import { createBookmarksTab } from './js/bookmarks.js';
import { createQuickAccessTab } from './js/quick-access.js';
import { createInboxTab } from './js/inbox.js';
import { renderSearch } from './js/search.js';

let data = null;
const state = {
  tab: 'collection',
  folderId: 'all',
  tagFilter: new Set(),
  colExpanded: new Set(),
  search: '',
};

const $ = (id) => document.getElementById(id);

// ———— 模块装配 ————

const collection = createCollectionTab({
  state,
  getData: () => data,
  refresh,
  collectCurrent,
  railEl: $('rail'),
  headerEl: $('col-header'),
  scrollEl: $('col-scroll'),
});

const bookmarks = createBookmarksTab({
  scrollEl: $('bm-scroll'),
  getActiveTab,
});

const quickAccess = createQuickAccessTab({
  rootEl: $('quick-root'),
  getData: () => data,
  getActiveTab,
  refresh,
  showModal,
});

const inbox = createInboxTab({
  rootEl: $('inbox-root'),
  getData: () => data,
  getActiveTab,
  refresh,
});

// ———— 数据流 ————

async function refresh() {
  data = await loadData();
  renderCurrent();
}

function renderCurrent() {
  const q = state.search;
  $('view-search').hidden = !q;
  $('view-collection').hidden = !!q || state.tab !== 'collection';
  $('view-quick').hidden = !!q || state.tab !== 'quick';
  $('view-inbox').hidden = !!q || state.tab !== 'inbox';
  $('view-bookmarks').hidden = !!q || state.tab !== 'bookmarks';
  if (q) {
    renderSearch($('search-scroll'), q, {
      getData: () => data,
      searchBookmarks: (tokens) => bookmarks.searchAll(tokens),
    });
    bookmarks.ensureLoaded().then(() => {
      if (state.search === q) renderSearch($('search-scroll'), q, {
        getData: () => data,
        searchBookmarks: (tokens) => bookmarks.searchAll(tokens),
      });
    }).catch(() => {});
    return;
  }
  if (state.tab === 'collection') {
    collection.renderAll();
  } else if (state.tab === 'quick') {
    quickAccess.render();
  } else if (state.tab === 'inbox') {
    inbox.render();
  } else {
    bookmarks.ensureLoaded();
  }
}

// ———— 收藏当前页 ————

async function getActiveTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function collectCurrent() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    toast('无法读取当前页面', 'error');
    return;
  }
  if (!isCollectableUrl(tab.url)) {
    toast('系统特权页面无法收藏', 'error');
    return;
  }
  const { duplicate, item } = await collectIntoStorage({
    url: tab.url,
    title: tab.title || tab.url,
  });
  toast(duplicate ? '已在收藏中，已更新收藏时间' : `已收藏：${(item.title || '').slice(0, 24)}`);
  if (state.tab !== 'collection' || state.search) await refresh();
}

// ———— 初始化 ————

async function init() {
  await ensureDataInitialized();
  await pruneRecycleBin();
  await initI18n();
  data = await loadData();

  $('view-bookmarks').prepend(bookmarks.header);
  applyI18n(document);
  $('btnCollect').append(icon('plus', 18));
  $('btnQuick').append(icon('star', 17));
  $('btnInbox').append(icon('inbox', 17));
  $('btnSettings').append(icon('gear', 17));
  $('btnEmbeddedClose').append(icon('close', 17));
  $('btnEmbeddedClose').hidden = !new URLSearchParams(location.search).has('embedded');
  $('searchIcon').append(icon('search', 15));
  $('btnClearSearch').append(icon('close', 14));
  $('btnCollect').addEventListener('click', collectCurrent);
  $('btnQuick').addEventListener('click', () => quickAccess.addCurrent());
  $('btnInbox').addEventListener('click', () => inbox.addCurrent());
  $('btnSettings').addEventListener('click', openOptionsPage);
  $('btnEmbeddedClose').addEventListener('click', () => {
    window.parent.postMessage({ type: 'pageclip:close-overlay' }, '*');
  });

  for (const tabBtn of document.querySelectorAll('#tabs .tab')) {
    tabBtn.addEventListener('click', () => {
      state.tab = tabBtn.dataset.tab;
      document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('active', b === tabBtn));
      renderCurrent();
    });
  }

  const searchInput = $('searchInput');
  const onSearch = debounce(() => {
    state.search = searchInput.value.trim();
    $('btnClearSearch').hidden = !state.search;
    renderCurrent();
  }, 150);
  searchInput.addEventListener('input', onSearch);
  $('btnClearSearch').addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    $('btnClearSearch').hidden = true;
    renderCurrent();
    searchInput.focus();
  });

  // storage 变化（如快捷键在面板外收藏）→ 实时刷新
  const storageRefresh = debounce(() => refresh(), 100);
  onLocaleChanged(() => { applyI18n(document); renderCurrent(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bc_data) storageRefresh();
  });
  // Chrome 书签外部变化 → 书签树实时刷新
  const bmRefresh = debounce(() => bookmarks.reload(), 150);
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) {
    chrome.bookmarks[ev].addListener(bmRefresh);
  }

  chrome.runtime.onMessage?.addListener((message) => {
    if (message?.type === 'pageclip:open-settings') openOptionsPage();
  });
  renderCurrent();
  if (!data.settings.onboardingDone) showOnboarding();
  if (new URLSearchParams(location.search).get('openSettings') === '1') openOptionsPage();
}

// ———— 独立设置页 ————

async function openOptionsPage() {
  const url = chrome.runtime.getURL('options.html');
  const existing = await chrome.tabs.query({ url: `${url}*` });
  if (existing[0]) await chrome.tabs.update(existing[0].id, { active: true, url });
  else await chrome.tabs.create({ url });
}

// ———— 新手引导 ————

function showOnboarding() {
  const step = (icoName, title, desc) =>
    h(
      'div',
      { class: 'ob-step' },
      h('div', { class: 'ob-ico' }, icon(icoName, 20)),
      h('div', {}, h('b', { text: title }), h('p', { class: 'dim', text: desc }))
    );
  const overlay = h(
    'div',
    { class: 'onboarding' },
    h(
      'div',
      { class: 'ob-card' },
      h('div', { class: 'ob-logo' }, h('img', { src: 'logo.svg', alt: 'PageClip' })), 
      h('h2', { text: '欢迎使用 PageClip' }),
      step('plus', '一键收藏当前页', '点击右上角 ＋ 或按 Ctrl+Shift+S 静默收藏，之后在列表里补充标签和备注。'),
      step('swap', '双页签两套体系', '「收藏」是你的私人收藏夹（标签 / 备注 / 文件夹 / 置顶）；「Chrome 书签」直接管理浏览器书签。'),
      step('search', '全局搜索与拖拽', '顶部搜索框同时搜两套数据，输入 #标签名 可按标签过滤；条目与文件夹都支持拖拽。'),
      h(
        'button',
        {
          class: 'btn btn-primary ob-start',
          onclick: async () => {
            overlay.remove();
            await updateSettings({ onboardingDone: true });
          },
        },
        '开始使用'
      )
    )
  );
  document.body.append(overlay);
}

init();
