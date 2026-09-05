// MV3 Service Worker：严格无状态。
// 不用任何全局变量保存业务数据，每次事件现用现读 chrome.storage.local，
// 随时可能被系统终止也不会留下脏状态。
import {
  collectIntoStorage,
  addQuickItem,
  addInboxItem,
  isCollectableUrl,
  ensureDataInitialized,
  pruneRecycleBin,
  loadData,
  updateSettings,
} from './js/store.js';
import { mergeBrowserBookmarks } from './js/bookmark-import.js';
import { initI18n, t, getMessages } from './js/i18n.js';
import { runAutomaticBackup, AUTO_BACKUP_ALARM } from './js/cloud-backup.js';
import { AUTO_BACKUP_DEBOUNCE_MS, hasBackupRelevantChange } from './js/auto-sync.js';

const DEFAULT_TITLE = '打开 PageClip 侧边栏';
const AUTO_BOOKMARK_IMPORT_ALARM = 'pageclip-auto-bookmark-import';
const BOOKMARK_IMPORT_RECOVERY_ALARM = 'pageclip-bookmark-import-recovery';
const BOOKMARK_IMPORT_DEBOUNCE_MINUTES = 1;
const BOOKMARK_IMPORT_RECOVERY_MINUTES = 24 * 60;
const AUTO_BACKUP_RECONNECT_NOTIFICATION = 'pageclip-auto-backup-reconnect';
let bookmarkImportRunning = null;

function bookmarkImportSettings(data) {
  return data.settings?.bookmarkAutoImport || {};
}

async function saveBookmarkImportSettings(patch) {
  const data = await loadData();
  await updateSettings({ bookmarkAutoImport: { ...bookmarkImportSettings(data), ...patch } });
}

async function configureBookmarkImportSchedule() {
  if (!chrome.alarms?.create) return false;
  const settings = bookmarkImportSettings(await loadData());
  await Promise.resolve(chrome.alarms.clear?.(AUTO_BOOKMARK_IMPORT_ALARM)).catch(() => {});
  await Promise.resolve(chrome.alarms.clear?.(BOOKMARK_IMPORT_RECOVERY_ALARM)).catch(() => {});
  if (!settings.enabled) return false;
  chrome.alarms.create(BOOKMARK_IMPORT_RECOVERY_ALARM, { delayInMinutes: BOOKMARK_IMPORT_RECOVERY_MINUTES, periodInMinutes: BOOKMARK_IMPORT_RECOVERY_MINUTES });
  if (!settings.lastSuccessAt || Date.now() - Number(settings.lastSuccessAt) >= BOOKMARK_IMPORT_RECOVERY_MINUTES * 60 * 1000) {
    chrome.alarms.create(AUTO_BOOKMARK_IMPORT_ALARM, { delayInMinutes: BOOKMARK_IMPORT_DEBOUNCE_MINUTES });
  }
  return true;
}

async function scheduleAutomaticBookmarkImport(trigger = 'event', immediate = false) {
  const settings = bookmarkImportSettings(await loadData());
  if (!settings.enabled && trigger !== 'manual') return false;
  if (!chrome.alarms?.create) return false;
  chrome.alarms.create(AUTO_BOOKMARK_IMPORT_ALARM, { delayInMinutes: immediate ? 0.5 : BOOKMARK_IMPORT_DEBOUNCE_MINUTES });
  return true;
}

async function runBookmarkImport(trigger = 'manual') {
  if (bookmarkImportRunning) return bookmarkImportRunning;
  bookmarkImportRunning = (async () => {
    const settings = bookmarkImportSettings(await loadData());
    if (!settings.enabled && trigger !== 'manual') return { skipped: true, reason: 'disabled' };
    await saveBookmarkImportSettings({ lastAttemptAt: Date.now(), lastError: null });
    try {
      const tree = await chrome.bookmarks.getTree();
      const latest = bookmarkImportSettings(await loadData());
      if (!latest.enabled && trigger !== 'manual') return { skipped: true, reason: 'disabled' };
      const result = await mergeBrowserBookmarks(tree);
      const now = Date.now();
      await saveBookmarkImportSettings({
        initialImportCompleted: latest.enabled ? true : latest.initialImportCompleted === true,
        lastSuccessAt: now,
        lastResult: { ...result, trigger, timestamp: now },
        lastError: null,
      });
      return { skipped: false, ...result };
    } catch (error) {
      const message = error?.message || String(error);
      await saveBookmarkImportSettings({ lastError: message }).catch(() => {});
      throw error;
    }
  })();
  try { return await bookmarkImportRunning; } finally { bookmarkImportRunning = null; }
}

async function enableAutomaticBookmarkImport(enabled) {
  const data = await loadData();
  await updateSettings({ bookmarkAutoImport: { ...bookmarkImportSettings(data), enabled: !!enabled } });
  await configureBookmarkImportSchedule();
  if (enabled) return runBookmarkImport('initial');
  return { skipped: true, reason: 'disabled' };
}


async function configureSidePanel() {
  const api = globalThis.chrome?.sidePanel;
  const setPanelBehavior = api?.setPanelBehavior;
  if (typeof setPanelBehavior !== 'function') return false;
  try {
    await Promise.resolve(
      setPanelBehavior.call(api, { openPanelOnActionClick: true })
    );
    return true;
  } catch {
    return false;
  }
}

async function showAutomaticBackupReconnectNotification() {
  if (typeof chrome.notifications?.create !== 'function') return false;
  await initI18n();
  await Promise.resolve(chrome.notifications.create(AUTO_BACKUP_RECONNECT_NOTIFICATION, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: t('notification.autoBackupPausedTitle'),
    message: t('notification.autoBackupPausedMessage'),
  }));
  return true;
}

async function openFallbackPage(openSettings = false) {
  const pageUrl = chrome.runtime.getURL('sidepanel.html');
  const optionsUrl = chrome.runtime.getURL('options.html');
  const targetUrl = openSettings ? optionsUrl : pageUrl;
  const [existing] = await chrome.tabs.query({ url: `${targetUrl}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
  } else {
    await chrome.tabs.create({ url: targetUrl });
  }
}

function getCurrentTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab);
}
async function scheduleAutomaticBackupAfterChange() {
  if (!chrome.alarms?.create) return false;
  const settings = (await loadData()).settings?.cloudBackup || {};
  if (!settings.autoBackupEnabled || settings.authRequired) return false;
  chrome.alarms.create(AUTO_BACKUP_ALARM, { when: Date.now() + AUTO_BACKUP_DEBOUNCE_MS });
  return true;
}

async function scheduleAutomaticBackupForChange(change) {
  if (!hasBackupRelevantChange(change?.oldValue, change?.newValue)) return false;
  return scheduleAutomaticBackupAfterChange();
}

async function clearLegacyAutomaticBackupAlarm() {
  const alarm = await Promise.resolve(chrome.alarms?.get?.(AUTO_BACKUP_ALARM)).catch(() => null);
  if (alarm?.periodInMinutes) await Promise.resolve(chrome.alarms?.clear?.(AUTO_BACKUP_ALARM)).catch(() => {});
}

async function captureCurrent(kind, source) {
  const tab = source || await getCurrentTab();
  if (!tab || !tab.url) return flashBadge('deny', t('error.readPage'));
  if (!isCollectableUrl(tab.url)) return flashBadge('deny', t('error.systemAdd'));
  const payload = { url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' };
  if (kind === 'quick') await addQuickItem(payload);
  else if (kind === 'inbox') await addInboxItem(payload);
  else await collectIntoStorage(payload);
  flashBadge('ok', kind === 'quick' ? t('toast.quickAdded') : kind === 'inbox' ? t('toast.inboxAdded') : t('toast.saved'));
}

async function createMenus() {
  const menus = chrome.contextMenus;
  if (!menus || typeof menus.create !== 'function') return;
  await initI18n({ refresh: true });
  const create = () => {
    menus.create({ id: 'pageclip-quick', title: t('menu.quick'), contexts: ['page', 'tab'] });
    menus.create({ id: 'pageclip-inbox', title: t('menu.inbox'), contexts: ['page', 'tab'] });
    menus.create({ id: 'pageclip-reading', title: t('menu.reading'), contexts: ['page', 'tab', 'link'] });
    menus.create({ id: 'pageclip-toggle', title: t('menu.toggle'), contexts: ['page', 'tab'] });
  };
  try { const removed = typeof menus.removeAll === 'function' ? menus.removeAll() : null; await Promise.resolve(removed).catch(() => {}); create(); } catch { create(); }
}
async function syncReadingList(url, title) {
  if (!chrome.readingList?.addEntry || !chrome.permissions?.request) throw new Error(t('error.readingUnsupported'));
  const has = chrome.permissions.contains ? await chrome.permissions.contains({ permissions: ['readingList'] }) : false;
  if (!has && !(await chrome.permissions.request({ permissions: ['readingList'] }))) throw new Error(t('error.permissionDenied'));
  await chrome.readingList.addEntry({ url, title: title || url, hasBeenRead: false });
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel().catch(() => {});
  ensureDataInitialized().then(() => pruneRecycleBin()).catch(() => {});
  initI18n().catch(() => {});
  clearLegacyAutomaticBackupAlarm().catch(() => {});
  configureBookmarkImportSchedule().catch(() => {});
  chrome.alarms?.create?.('pageclip-prune-recycle', { periodInMinutes: 24 * 60 });
  createMenus().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanel().catch(() => {});
  ensureDataInitialized().then(() => pruneRecycleBin()).catch(() => {});
  clearLegacyAutomaticBackupAlarm().catch(() => {});
  configureBookmarkImportSchedule().catch(() => {});
  chrome.alarms?.create?.('pageclip-prune-recycle', { periodInMinutes: 24 * 60 });
  createMenus().catch(() => {});
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'pageclip-prune-recycle') pruneRecycleBin().catch(() => {});
  if (alarm.name === AUTO_BACKUP_ALARM) runAutomaticBackup().then((result) => {
    if (result?.reason === 'authorization-required') {
      Promise.resolve(chrome.alarms?.clear?.(AUTO_BACKUP_ALARM)).catch(() => {});
      if (result.justPaused) showAutomaticBackupReconnectNotification().catch(() => {});
    }
  }).catch(() => {});
  if (alarm.name === AUTO_BOOKMARK_IMPORT_ALARM) runBookmarkImport('event').catch(() => {});
  if (alarm.name === BOOKMARK_IMPORT_RECOVERY_ALARM) runBookmarkImport('recovery').catch(() => {});
});

chrome.notifications?.onClicked?.addListener((notificationId) => {
  if (notificationId !== AUTO_BACKUP_RECONNECT_NOTIFICATION) return;
  Promise.resolve(chrome.notifications?.clear?.(notificationId)).catch(() => {});
  openFallbackPage(true).catch(() => {});
});

for (const eventName of ['onCreated', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded', 'onRemoved']) {
  chrome.bookmarks?.[eventName]?.addListener(() => scheduleAutomaticBookmarkImport('event').catch(() => {}));
}

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  try {
    await initI18n();
    const url = info.linkUrl || info.pageUrl || tab?.url;
    const source = url ? { url, title: tab?.title || url, favIconUrl: tab?.favIconUrl || '' } : tab;
    if (info.menuItemId === 'pageclip-toggle') {
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'pageclip:toggle' });
      return;
    }
    if (info.menuItemId === 'pageclip-reading') {
      await syncReadingList(source.url, source.title);
      flashBadge('ok', t('toast.readingAdded'));
      return;
    }
    await captureCurrent(info.menuItemId === 'pageclip-quick' ? 'quick' : 'inbox', source);
  } catch (err) {
    flashBadge('deny', t('error.operation', { ERROR: err.message || String(err) }));
  }
});

chrome.action.onClicked.addListener(async () => {
  // Brave 等未实现 chrome.sidePanel 的 Chromium 浏览器回退到完整管理页。
  if (!await configureSidePanel()) {
    try {
      await openFallbackPage();
    } catch {
      // 让扩展其余功能继续可用；页面打开失败不会影响快捷键收藏。
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.bc_data) return;
  if (changes.bc_data.newValue?.settings?.uiLocale !== changes.bc_data.oldValue?.settings?.uiLocale) createMenus().catch(() => {});
  const oldCloud = changes.bc_data.oldValue?.settings?.cloudBackup || {};
  const newCloud = changes.bc_data.newValue?.settings?.cloudBackup || {};
  if (oldCloud.autoBackupEnabled && !newCloud.autoBackupEnabled) Promise.resolve(chrome.alarms?.clear?.(AUTO_BACKUP_ALARM)).catch(() => {});
  if (oldCloud.authRequired && !newCloud.authRequired) Promise.resolve(chrome.notifications?.clear?.(AUTO_BACKUP_RECONNECT_NOTIFICATION)).catch(() => {});
  scheduleAutomaticBackupForChange(changes.bc_data).catch(() => {});
  const oldBookmarkImport = changes.bc_data.oldValue?.settings?.bookmarkAutoImport || {};
  const newBookmarkImport = changes.bc_data.newValue?.settings?.bookmarkAutoImport || {};
  if (oldBookmarkImport.enabled !== newBookmarkImport.enabled) configureBookmarkImportSchedule().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type || !['capture-current', 'capture-quick', 'capture-inbox', 'sync-reading', 'open-manager', 'open-settings', 'get-i18n-messages', 'run-bookmark-import', 'set-bookmark-auto-import', 'get-bookmark-import-status'].includes(message.type)) return false;
  (async () => {
    if (message.type === 'get-i18n-messages') return { ok: true, locale: message.locale, messages: getMessages(message.locale) };
    if (message.type === 'run-bookmark-import') return { ok: true, result: await runBookmarkImport('manual') };
    if (message.type === 'set-bookmark-auto-import') return { ok: true, result: await enableAutomaticBookmarkImport(message.enabled === true) };
    if (message.type === 'get-bookmark-import-status') return { ok: true, status: bookmarkImportSettings(await loadData()) };
    const payload = message.payload || sender.tab || await getCurrentTab();
    if (message.type === 'open-manager' || message.type === 'open-settings') {
      await openFallbackPage(message.type === 'open-settings');
      return { ok: true, message: message.type === 'open-settings' ? t('content.openSettings') : t('content.openManager') };
    }
    if (!payload?.url) throw new Error(t('error.readPage'));
    if (message.type === 'sync-reading') {
      await syncReadingList(payload.url, payload.title);
      return { ok: true, message: t('toast.readingAdded') };
    }
    await captureCurrent(
      message.type === 'capture-current' ? 'collect' : message.type === 'capture-quick' ? 'quick' : 'inbox',
      payload
    );
    return { ok: true, message: message.type === 'capture-quick' ? t('toast.quickAdded') : message.type === 'capture-inbox' ? t('toast.inboxAdded') : t('toast.saved') };
  })().then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, message: error.message || String(error) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    await initI18n();
    if (command === 'collect-current-page') await captureCurrent('collect');
    else if (command === 'add-to-quick-access') await captureCurrent('quick');
    else if (command === 'add-to-inbox') await captureCurrent('inbox');
    else if (command === 'toggle-pageclip-overlay') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && /^(https?):/i.test(tab.url || '')) {
        await chrome.tabs.sendMessage(tab.id, { type: 'pageclip:toggle' }).catch(async () => {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/bridge.js'] }).catch(() => {});
        });
      }
    }
  } catch (err) {
    flashBadge('deny', t('error.operation', { ERROR: err && err.message ? err.message : err }));
  }
});

// 角标反馈：badge 空间小，长文字放 action title。
// 成功 = 绿色 ✓；失败 = 红色 ! + title 说明，2 秒后恢复。
function flashBadge(kind, title) {
  const ok = kind === 'ok';
  const apply = async () => {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#1e8e3e' : '#d93025' });
    await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    if (!ok) await chrome.action.setTitle({ title });
  };
  apply().catch(() => {});
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    if (!ok) chrome.action.setTitle({ title: t('action.defaultTitle') }).catch(() => {});
  }, 2000);
}
