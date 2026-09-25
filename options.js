import {
  ensureDataInitialized, loadData, getStats, getInboxStats, getRecycleStats,
  exportPayload, importPayload, restoreRecycleEntry, purgeRecycleEntry,
  clearRecycleBin, pruneRecycleBin, updateSettings, getCloudBackupPayload, previewCloudRestore, restoreCloudPayload,
  renameTag, deleteTag, restoreTagSnapshot, updateTagRules, applyTagRulesToExisting,
} from './js/store.js';
import { bookmarkRuleEntries, cleanTag, countTags, hasActiveRules, normalizeTagRules, normalizeTags, tagKey, tagUsage, urlKey } from './js/tag-model.js';
import { importBookmarksHtml } from './js/bookmark-import.js';
import { initI18n, applyI18n, onLocaleChanged, setLocalePreference, getLocalePreference, translateText, t } from './js/i18n.js';
import { encryptBackup, decryptBackup, createPasswordVerifier, verifyBackupPassword, getOrCreateDeviceKey, exportEncryptedRecoveryKey, importEncryptedRecoveryKey } from './js/crypto-backup.js';
import { connectGoogle, signOutGoogle, uploadLatestBackup, downloadLatestBackup, downloadBackup, listBackups, getCloudBackupStatus } from './js/cloud-backup.js';
import { getCloudCardState } from './js/cloud-status.js';

const root = document.getElementById('options-root');
let data = null;
let recycleSelection = new Set();
let cloudStatus = { connected: false, account: null, file: null };
// 当前 Chrome 书签的网址，用来在标签统计中排除已经没有书签的网址；读取失败时为 null（不排除）。
let liveBookmarkUrls = null;
// 正在编辑、尚未保存的标签规则（输入框用文本表示标签）。
let rulesDraft = null;
let settingSearchQuery = '';
let activeSettingSection = 'overview';

async function init() {
  await ensureDataInitialized();
  await pruneRecycleBin();
  data = await loadData();
  await initI18n({ root: document });
  cloudStatus = await getCloudBackupStatus();
  await loadBookmarkUrls();
  render();
  onLocaleChanged(() => { applyI18n(document); render(); });
}

function render() {
  const stats = getStats(data);
  const inbox = getInboxStats(data);
  const recycle = getRecycleStats(data);
  const quick = data.quickAccess || [];
  root.replaceChildren(
    settingsToolbar(),
    h('div', { class: 'settings-layout' },
      settingsNav(),
      h('div', { class: 'settings-content' },
        settingsSection('overview', t('settings.sectionOverview'),
          card(t('settings.stats'), t('settings.statsHint'), h('div', { class: 'stat-grid' },
        stat(stats.items, t('settings.permanent')),
        stat(quick.filter((item) => item.type === 'single').length, t('settings.quickSingles')),
        stat(quick.filter((item) => item.type === 'group').length, t('settings.quickGroups')),
        stat(inbox.unread, t('settings.unread')),
        stat(inbox.read, t('settings.read')),
        stat(stats.folders, t('settings.folders')),
        stat(countTags(data, { liveUrls: liveBookmarkUrls }).length, t('settings.tags')),
        stat(recycle.entries, t('settings.recycleEntries'))
          ), { search: t('settings.stats') + ' ' + t('settings.statsHint'), full: true })),
        settingsSection('tags', t('settings.sectionTags'),
          tagManagerCard(),
          tagRulesCard()),
        settingsSection('import', t('settings.sectionImport'),
          card(t('settings.importBookmarks'), t('settings.bookmarksHint'), h('div', {}, actions(
            button(t('settings.readBookmarks'), 'primary', importCurrentBookmarks),
            button(t('settings.chooseBookmarks'), '', chooseHtml)
          ), autoBookmarkImportControls()), { search: t('settings.importBookmarks') + ' ' + t('settings.bookmarksHint') }),
          card(t('settings.htmlCsv'), t('settings.htmlCsvHint'), exportActions(), { search: t('settings.htmlCsv') + ' ' + t('settings.htmlCsvHint') })),
        settingsSection('backup', t('settings.sectionBackup'),
          card(t('settings.backup'), t('settings.backupHint'), actions(
        button(t('settings.exportJson'), 'primary', exportJson),
        button(t('settings.importJson'), '', chooseJson)
          ), { search: t('settings.backup') + ' ' + t('settings.backupHint') }),
          cloudCard(),
          card(t('settings.recycle'), t('settings.recycleHint'), recycleView(recycle), { search: t('settings.recycle') + ' ' + t('settings.recycleHint') })),
        settingsSection('general', t('settings.sectionGeneral'),
          languageCard(),
          card(t('settings.shortcuts'), t('settings.shortcutsHint'), h('div', {},
            p(t('settings.shortcutsText')),
            button(t('settings.openShortcuts'), '', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })),
            h('p', { class: 'desc option-note', text: t('settings.localNote') })
          ), { search: t('settings.shortcuts') + ' ' + t('settings.shortcutsHint') + ' ' + t('settings.openShortcuts') })),
        settingsSection('about', t('settings.sectionAbout'), aboutCard()),
        h('p', { class: 'settings-search-empty', id: 'settings-search-empty', hidden: true, text: t('settings.searchEmpty') })
      )
    )
  );
  filterSettings();
}

function settingsToolbar() {
  const input = h('input', {
    class: 'settings-search',
    type: 'search',
    value: settingSearchQuery,
    placeholder: t('settings.searchPlaceholder'),
    'aria-label': t('settings.searchPlaceholder')
  });
  input.addEventListener('input', () => { settingSearchQuery = input.value; filterSettings(); });
  return h('div', { class: 'settings-toolbar' },
    h('div', { class: 'settings-toolbar-copy' },
      h('span', { class: 'settings-toolbar-kicker', text: t('settings.searchKicker') }),
      h('strong', { text: t('settings.searchHint') })),
    h('label', { class: 'settings-search-wrap' }, input)
  );
}

function settingsNav() {
  const nav = h('nav', { class: 'settings-nav', 'aria-label': t('settings.navigation') });
  for (const [id, labelKey] of [
    ['overview', 'settings.sectionOverview'],
    ['tags', 'settings.sectionTags'],
    ['import', 'settings.sectionImport'],
    ['backup', 'settings.sectionBackup'],
    ['general', 'settings.sectionGeneral'],
    ['about', 'settings.sectionAbout'],
  ]) {
    const item = h('button', { class: 'settings-nav-item', type: 'button', 'data-section-nav': id },
      h('span', { class: 'settings-nav-dot' }), h('span', { text: t(labelKey) }));
    item.addEventListener('click', () => {
      activeSettingSection = id;
      document.getElementById('settings-section-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateSettingsNav();
    });
    nav.append(item);
  }
  return nav;
}

function settingsSection(id, title, ...children) {
  return h('section', { class: 'settings-section', id: 'settings-section-' + id, 'data-settings-section': id },
    h('div', { class: 'settings-section-heading' }, h('h2', { text: title })),
    grid(...children)
  );
}

function filterSettings() {
  const query = settingSearchQuery.trim().toLocaleLowerCase();
  const sections = [...document.querySelectorAll('[data-settings-section]')];
  for (const section of sections) {
    const cards = [...section.querySelectorAll('.option-card')];
    let visible = 0;
    for (const optionCard of cards) {
      const matches = !query || String(optionCard.dataset.search || '').toLocaleLowerCase().includes(query);
      optionCard.hidden = !matches;
      if (matches) visible++;
    }
    section.hidden = visible === 0;
  }
  const empty = document.getElementById('settings-search-empty');
  const visibleSections = sections.filter((section) => !section.hidden).length;
  if (empty) empty.hidden = !query || visibleSections > 0;
  updateSettingsNav();
}

function updateSettingsNav() {
  const sections = [...document.querySelectorAll('[data-settings-section]')];
  document.querySelectorAll('[data-section-nav]').forEach((item) => {
    const section = sections.find((entry) => entry.dataset.settingsSection === item.dataset.sectionNav);
    item.classList.toggle('active', item.dataset.sectionNav === activeSettingSection && !section?.hidden);
    item.disabled = !!section?.hidden;
  });
}

function aboutCard() {
  const version = chrome.runtime?.getManifest?.().version || '—';
  return card(t('settings.aboutTitle'), t('settings.aboutHint'), h('div', { class: 'about-card-body' },
    h('div', { class: 'about-identity' },
      h('img', { src: 'logo.svg', alt: 'PageClip', class: 'about-logo' }),
      h('div', {}, h('strong', { text: 'PageClip' }), h('span', { class: 'about-version', text: t('settings.version', { VERSION: version }) }))),
    h('p', { class: 'about-summary', text: t('settings.aboutSummary') }),
    h('div', { class: 'about-facts' },
      h('div', {}, h('strong', { text: t('settings.aboutLocalTitle') }), h('span', { text: t('settings.aboutLocalText') })),
      h('div', {}, h('strong', { text: t('settings.aboutBackupTitle') }), h('span', { text: t('settings.aboutBackupText') })),
      h('div', {}, h('strong', { text: t('settings.aboutPermissionTitle') }), h('span', { text: t('settings.aboutPermissionText') }))),
    h('div', { class: 'about-links' },
      externalLink(t('settings.aboutGithub'), 'https://github.com/phishinqi/PageClip'),
      externalLink(t('settings.aboutIssues'), 'https://github.com/phishinqi/PageClip/issues'),
      externalLink(t('settings.aboutWebsite'), 'https://phishinqi.github.io/PageClip/'),
      externalLink(t('settings.aboutStore'), 'https://chromewebstore.google.com/detail/pageclip/mnapcpmijebakicgdflohgnjmndhlneg'),
      externalLink(t('settings.aboutPrivacy'), 'https://phishinqi.github.io/PageClip/privacy.html'),
      externalLink(t('settings.aboutTerms'), 'https://phishinqi.github.io/PageClip/terms.html')
    )
  ), { search: t('settings.aboutTitle') + ' ' + t('settings.aboutHint') + ' ' + t('settings.aboutSummary') + ' ' + t('settings.aboutPermissionText'), full: true });
}


function languageCard() {
  const select = h('select', { class: 'locale-select', 'aria-label': t('settings.language') });
  for (const option of [
    ['auto', t('settings.localeAuto')],
    ['zh_CN', t('settings.localeZh')],
    ['en', t('settings.localeEn')]
  ]) select.append(h('option', { value: option[0], text: option[1] }));
  select.value = getLocalePreference();
  select.addEventListener('change', () => setLocalePreference(select.value));
  return card(t('settings.language'), t('settings.languageHint'), h('div', { class: 'language-setting' }, select), { search: t('settings.language') + ' ' + t('settings.languageHint') + ' ' + t('settings.localeZh') + ' ' + t('settings.localeEn') });
}

function cloudCard() {
  const view = getCloudCardState(cloudStatus, data.settings?.cloudBackup || {});
  const connected = view.connected;
  const authorizationRequired = view.authorizationRequired;
  return card(t('settings.cloud'), t('settings.cloudHint'), h('div', { class: 'cloud-backup' },
    h('div', { class: 'cloud-status' }, h('strong', { text: t(view.titleKey, view.titleValues) }), h('span', { class: 'desc', text: t(view.statusKey, view.statusValues) })),
    actions(
      !connected ? button(t(authorizationRequired ? 'settings.reconnect' : 'settings.connect'), 'primary', connectCloud) : null,
      connected ? button(t('settings.manualBackup'), 'primary', runCloudBackup) : null,
      connected ? button(t('settings.manualRestore'), '', runCloudRestore) : null,
      connected ? button(t('settings.viewBackups'), '', showCloudBackups) : null,
      (connected || authorizationRequired) ? button(t('settings.exportRecovery'), '', exportRecoveryKey) : null,
      (connected || authorizationRequired) ? button(t('settings.importRecovery'), '', importRecoveryKey) : null,
      (connected || authorizationRequired) ? button(t('settings.signOut'), 'danger', disconnectCloud) : null
    ),
    (connected || authorizationRequired) ? autoBackupControls(authorizationRequired) : null,
    (connected || authorizationRequired) ? h('p', { class: 'desc recovery-note', text: t('settings.recoveryBinaryNote') }) : null,
    h('p', { class: 'desc cloud-note', text: t('settings.cloudNote') })
  ), { search: [t('settings.cloud'), t('settings.cloudHint'), t('settings.manualBackup'), t('settings.manualRestore'), t('settings.autoBackup'), t('settings.exportRecovery'), t('settings.importRecovery')].join(' ') });
}

function autoBackupControls(authorizationRequired = false) {
  const settings = data.settings?.cloudBackup || {};
  const enabled = !!settings.autoBackupEnabled;
  const checkbox = h('input', { type: 'checkbox', checked: enabled });
  checkbox.addEventListener('change', () => saveAutoBackupSettings(checkbox.checked, checkbox));
  const last = authorizationRequired
    ? t('settings.autoBackupPaused')
    : settings.lastAutoBackupError ? t('settings.autoBackupError', { ERROR: settings.lastAutoBackupError }) : settings.lastAutoBackupAt ? t('settings.autoBackupLast', { TIME: new Date(settings.lastAutoBackupAt).toLocaleString() }) : t('settings.autoBackupNever');
  return h('div', { class: 'auto-backup-controls' },
    h('div', { class: 'auto-backup-header' }, h('strong', { text: t('settings.autoBackup') }), h('span', { class: 'desc', text: enabled ? t('settings.autoBackupEnabled') : t('settings.autoBackupDisabled') })),
    h('label', { class: 'auto-backup-toggle' }, checkbox, h('span', { text: t('settings.autoBackupToggle') })),
    h('p', { class: 'desc auto-backup-meta', text: last }),
    h('p', { class: 'desc auto-backup-note', text: t('settings.autoBackupHint') })
  );
}

async function saveAutoBackupSettings(enabled, checkbox) {
  if (enabled && !cloudStatus.connected) {
    checkbox.checked = false;
    await connectCloud();
    if (!cloudStatus.connected) return;
  }
  try {
    await updateSettings({ cloudBackup: { ...(data.settings?.cloudBackup || {}), autoBackupEnabled: enabled, autoBackupMode: 'device-key' } });
    data = await loadData();
    cloudStatus = await getCloudBackupStatus();
    render();
    toast(t('settings.autoBackupSaved'));
  } catch (error) {
    checkbox.checked = !enabled;
    toast(error.message || t('settings.autoBackupFailed'), 'error');
  }
}

async function connectCloud() { try { await connectGoogle(); cloudStatus = await getCloudBackupStatus(); data = await loadData(); render(); toast(t('settings.cloudConnected')); } catch (error) { toast(error.message || t('backup.googleFailed'), 'error'); } }
async function disconnectCloud() { if (!confirm(t('backup.logoutConfirm'))) return; try { await signOutGoogle(); cloudStatus = await getCloudBackupStatus(); data = await loadData(); render(); toast(t('settings.signedOut')); } catch (error) { toast(error.message || t('backup.failed'), 'error'); } }

async function chooseBackupMode() {
  const body = h('div', { class: 'cloud-form' });
  const passwordRadio = h('input', { type: 'radio', name: 'cloud-encryption-mode', checked: true });
  const deviceRadio = h('input', { type: 'radio', name: 'cloud-encryption-mode' });
  const passwordHint = h('p', { class: 'desc', text: t('backup.passwordHint') });
  body.append(h('label', { class: 'radio-row' }, passwordRadio, h('span', {}, h('strong', { text: t('backup.passwordMode') }), passwordHint)), h('label', { class: 'radio-row' }, deviceRadio, h('span', {}, h('strong', { text: t('backup.deviceMode') }), h('p', { class: 'desc', text: t('backup.deviceHint') }))));
  return optionDialog(t('backup.chooseMode'), body, [
    { label: t('button.cancel'), kind: 'ghost', cancel: true },
    { label: t('button.next'), kind: 'primary', onClick: async () => ({ mode: deviceRadio.checked ? 'device-key' : 'password' }) }
  ]);
}

async function askPassword(title, confirmPassword = false, label = '备份密码') {
  const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('backup.passwordPlaceholder') });
  const confirmInput = confirmPassword ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('backup.passwordPlaceholder') }) : null;
  const body = h('div', { class: 'cloud-form' }, h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: label }), password), confirmInput ? h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: t('backup.passwordConfirm') }), confirmInput) : null, h('p', { class: 'desc', text: t('backup.passwordWarning') }));
  return optionDialog(title, body, [{ label: t('button.cancel'), kind: 'ghost', cancel: true }, { label: t('button.confirm'), kind: 'primary', onClick: async () => { if (password.value.length < 8 || (confirmInput && password.value !== confirmInput.value)) { toast(confirmInput ? t('backup.passwordMismatch') : t('backup.passwordLength'), 'error'); return false; } return password.value; } }]);
}

async function runCloudBackup() {
  try {
    await connectGoogle();
    cloudStatus = await getCloudBackupStatus();
    const choice = await chooseBackupMode(); if (!choice) return;
    let options = { mode: choice.mode };
    if (choice.mode === 'password') {
      const configured = data.settings?.cloudBackup?.password?.verifier;
      const password = await askPassword(configured ? '输入备份密码' : '设置备份密码', !configured); if (!password) return;
      if (!configured) { const verifier = await createPasswordVerifier(password); await updateSettings({ cloudBackup: { ...(data.settings.cloudBackup || {}), password: verifier } }); data = await loadData(); }
      else if (!(await verifyBackupPassword(password)).valid) throw new Error('备份密码不正确');
      options.password = password;
    } else options.key = await getOrCreateDeviceKey();
    cloudStatus = await getCloudBackupStatus();
    if (cloudStatus.file && !confirm(t('backup.overwrite'))) return;
    const envelope = await encryptBackup(getCloudBackupPayload(data), options);
    const result = await uploadLatestBackup(envelope);
    cloudStatus = await getCloudBackupStatus();
    data = await loadData(); render(); toast(t('backup.success', { SIZE: Math.round(result.size / 1024) }));
  } catch (error) { toast(error.message || t('backup.cloudFailed'), 'error'); }
}

async function runCloudRestore() { return restoreCloudFile(null); }
async function restoreCloudFile(fileId) {
  try {
    if (!cloudStatus.connected) await connectCloud();
    if (!cloudStatus.connected) return;
    const remote = fileId ? await downloadBackup(fileId, true) : await downloadLatestBackup();
    let options = {};
    if (remote.envelope.encryption?.mode === 'password') { const password = await askPassword(t('backup.enter'), false); if (!password) return; options.password = password; }
    else if (remote.envelope.encryption?.mode === 'device-key') options.key = await getOrCreateDeviceKey();
    const cloudData = await decryptBackup(remote.envelope, options);
    const diff = previewCloudRestore(data, cloudData);
    const decision = await showRestorePreview(remote.file, diff); if (!decision) return;
    if (decision === 'replace' && !confirm(t('backup.restoreReplace'))) return;
    await restoreCloudPayload(cloudData, decision); data = await loadData(); cloudStatus = await getCloudBackupStatus(); render(); toast(decision === 'replace' ? t('settings.restoreReplaceDone') : t('settings.restoreMergeDone'));
  } catch (error) { toast(error.message || t('backup.restoreFailed'), 'error'); }
}

async function showCloudBackups() {
  try {
    const files = await listBackups(true);
    const dialog = h('dialog', { class: 'option-dialog' });
    const list = h('div', { class: 'backup-history-list' });
    if (!files.length) list.append(h('p', { class: 'empty', text: t('settings.noBackups') }));
    for (const file of files) {
      const isLatest = file.name === 'PageClip-latest.enc';
      const size = Math.max(0, Math.round(Number(file.size || 0) / 1024));
      const restore = button(t('settings.restoreBackup'), '', async () => {
        dialog.close();
        dialog.remove();
        await restoreCloudFile(file.id);
      });
      list.append(h('div', { class: 'backup-history-row' },
        h('div', { class: 'meta' }, h('strong', { text: isLatest ? t('settings.latestBackup') : t('settings.historyBackup') }), h('small', { text: t('settings.backupMeta', { TIME: new Date(file.modifiedTime || Date.now()).toLocaleString(), SIZE: size }) })),
        restore
      ));
    }
    const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
    dialog.append(h('div', { class: 'option-dialog-card' }, h('h2', { text: t('settings.backupHistoryTitle') }), h('div', { class: 'option-dialog-body' }, list), h('div', { class: 'option-dialog-actions' }, button(t('button.cancel'), 'btn-ghost', close))));
    dialog.addEventListener('cancel', close, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } catch (error) { toast(error.message || t('settings.backupListFailed'), 'error'); }
}

async function showRestorePreview(file, diff) {
  const body = h('div', { class: 'restore-preview' }, h('p', { class: 'desc', text: t('settings.restoreTime', { TIME: new Date(file.modifiedTime || Date.now()).toLocaleString() }) }), h('div', { class: 'diff-grid' },
    stat(diff.cloud.items, t('settings.permanent')), stat(diff.cloud.quickSingles, t('settings.quickSingles')), stat(diff.cloud.quickGroups, t('settings.quickGroups')), stat(diff.cloud.inbox, 'Inbox'), stat(diff.cloud.recycleEntries, t('settings.recycleEntries')), stat(diff.added, t('backup.added')), stat(diff.same, t('backup.same')), stat(diff.conflicts, t('backup.conflicts')), stat(diff.localOnly, t('backup.localOnly'))
  ), h('p', { class: 'desc', text: t('settings.restoreHint') }));
  return optionDialog(t('backup.diffTitle'), body, [{ label: t('button.cancel'), kind: 'ghost', cancel: true }, { label: t('backup.merge'), kind: 'primary', onClick: async () => 'merge' }, { label: t('backup.replace'), kind: 'danger', onClick: async () => 'replace' }]);
}

async function exportRecoveryKey() { try { const password = await askPassword(t('backup.setupRecovery'), true, t('backup.recoveryLabel')); if (!password) return; const file = await exportEncryptedRecoveryKey(password); downloadBinary(file, 'PageClip-device-recovery-key.pckey', 'application/octet-stream'); toast(t('settings.recoveryExported')); } catch (error) { toast(error.message || t('backup.failed'), 'error'); } }
function importRecoveryKey() { const input = h('input', { type: 'file', accept: '.pckey,.bin,.json,application/octet-stream,application/json' }); input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const password = await askPassword('输入恢复密钥密码', false, t('backup.recoveryLabel')); if (!password) return; await importEncryptedRecoveryKey(file, password); toast(t('settings.recoveryImported')); } catch (error) { toast(error.message || t('backup.restoreFailed'), 'error'); } }); input.click(); }

function optionDialog(title, body, buttons) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'option-dialog' });
    const cardEl = h('div', { class: 'option-dialog-card' }, h('h2', { text: title }), h('div', { class: 'option-dialog-body' }, body), h('div', { class: 'option-dialog-actions' }));
    const actionsEl = cardEl.lastChild;
    let settled = false;
    const close = (value) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
    for (const config of buttons) { const buttonEl = button(config.label, 'btn ' + (config.kind || 'btn-ghost'), async () => { if (config.cancel) { close(null); return; } try { const value = await config.onClick(); if (value !== false) close(value); } catch (error) { toast(error.message || String(error), 'error'); } }); actionsEl.append(buttonEl); }
    dialog.append(cardEl); dialog.addEventListener('cancel', () => close(null), { once: true }); dialog.addEventListener('close', () => { if (!settled) close(null); }, { once: true }); document.body.append(dialog); dialog.showModal();
  });
}

// ———— 标签管理与标签规则 ————

async function loadBookmarkUrls() {
  try {
    const urls = new Set();
    const walk = (node) => {
      if (node?.url) urls.add(urlKey(node.url));
      for (const child of node?.children || []) walk(child);
    };
    (await chrome.bookmarks.getTree()).forEach(walk);
    liveBookmarkUrls = urls;
  } catch {
    liveBookmarkUrls = null;
  }
}

async function reloadAfterTagChange({ resetRules = false } = {}) {
  data = await loadData();
  if (resetRules) rulesDraft = null;
  await loadBookmarkUrls();
  render();
}

function tagManagerCard() {
  const tags = countTags(data, { liveUrls: liveBookmarkUrls });
  const list = h('div', { class: 'tag-manager-list' });
  if (!tags.length) list.append(h('p', { class: 'empty', text: t('settings.tagManagerEmpty') }));
  for (const entry of tags) {
    list.append(h('div', { class: 'tag-manager-row' },
      h('div', { class: 'meta' }, h('strong', { text: '#' + entry.name }), h('small', { text: t('settings.tagCount', { COUNT: entry.count }) })),
      button(t('tags.rename'), '', () => renameTagFromSettings(entry.name)),
      button(t('tags.merge'), '', () => mergeTagFromSettings(entry.name)),
      button(t('tags.delete'), 'danger', () => changeTagFromSettings({ from: entry.name }))
    ));
  }
  return card(t('settings.tagManager'), t('settings.tagManagerHint'), list, { search: [t('settings.tagManager'), t('settings.tagManagerHint'), t('tags.rename'), t('tags.merge'), t('tags.delete')].join(' ') });
}

// 改名时输入已有的标签名就是合并。
async function renameTagFromSettings(name) {
  const input = h('input', { type: 'text', spellcheck: 'false' });
  input.value = name;
  const body = h('div', { class: 'cloud-form' },
    h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: t('tags.newName') }), input),
    p(t('tags.renameHint'))
  );
  const target = await optionDialog(t('tags.renameTitle', { TAG: name }), body, [
    { label: t('button.cancel'), kind: 'ghost', cancel: true },
    { label: t('button.confirm'), kind: 'primary', onClick: async () => {
      const value = cleanTag(input.value);
      if (!value) { toast(t('tags.nameRequired'), 'error'); return false; }
      if (value === name) { toast(t('tags.sameName'), 'error'); return false; }
      return value;
    } },
  ]);
  if (!target) return;
  const existing = countTags(data).find((entry) => tagKey(entry.name) === tagKey(target) && tagKey(entry.name) !== tagKey(name));
  await changeTagFromSettings({ from: name, to: existing ? existing.name : target, merge: !!existing });
}

async function mergeTagFromSettings(name) {
  const others = countTags(data, { liveUrls: liveBookmarkUrls }).filter((entry) => tagKey(entry.name) !== tagKey(name));
  if (!others.length) { toast(t('tags.noOtherTags'), 'error'); return; }
  const select = h('select', { class: 'locale-select' });
  for (const entry of others) select.append(h('option', { value: entry.name, text: '#' + entry.name + ' · ' + entry.count }));
  const target = await optionDialog(t('tags.mergeTitle', { TAG: name }), h('div', { class: 'cloud-form' }, select), [
    { label: t('button.cancel'), kind: 'ghost', cancel: true },
    { label: t('button.confirm'), kind: 'primary', onClick: async () => select.value },
  ]);
  if (!target) return;
  await changeTagFromSettings({ from: name, to: target, merge: true });
}

// to 为空表示删除。执行前确认影响范围，完成后提供撤销。
async function changeTagFromSettings({ from, to = null, merge = false }) {
  const usage = tagUsage(data, from, { liveUrls: liveBookmarkUrls });
  const values = { FROM: from, TO: to, TAG: from, COUNT: usage.count, RULES: usage.rules };
  const message = !to ? t('tags.confirmDelete', values) : t(merge ? 'tags.confirmMerge' : 'tags.confirmRename', values);
  const ok = await optionDialog(t('tags.globalTitle'), p(message), [
    { label: t('button.cancel'), kind: 'ghost', cancel: true },
    { label: to ? t('button.confirm') : t('tags.delete'), kind: to ? 'primary' : 'danger', onClick: async () => true },
  ]);
  if (!ok) return;
  try {
    const result = to ? await renameTag(from, to) : await deleteTag(from);
    await reloadAfterTagChange({ resetRules: result.rulesChanged > 0 });
    const done = !to ? t('tags.deleted', { TAG: from }) : t(merge ? 'tags.merged' : 'tags.renamed', { TAG: to });
    toastAction(done, t('tags.undo'), () => undoTagChange(result.snapshot));
  } catch (error) { toast(error.message || String(error), 'error'); }
}

async function undoTagChange(snapshot) {
  try {
    await restoreTagSnapshot(snapshot);
    await reloadAfterTagChange({ resetRules: !!snapshot?.rules });
    toast(t('tags.undone'));
  } catch (error) { toast(error.message || String(error), 'error'); }
}

function rulesToDraft(rules) {
  return {
    autoApply: rules.autoApply,
    folder: rules.folder,
    domains: rules.domains.map((rule) => ({ value: rule.domain, match: rule.match, tags: rule.tags.join(', ') })),
    keywords: rules.keywords.map((rule) => ({ value: rule.keyword, tags: rule.tags.join(', ') })),
  };
}

function draftToRules(draft) {
  return {
    autoApply: draft.autoApply,
    folder: draft.folder,
    domains: draft.domains.map((rule) => ({ domain: rule.value, match: rule.match, tags: normalizeTags(rule.tags) })),
    keywords: draft.keywords.map((rule) => ({ keyword: rule.value, tags: normalizeTags(rule.tags) })),
  };
}

function savedRules() {
  return normalizeTagRules(data.settings?.tagRules);
}

function rulesDirty() {
  return !!rulesDraft && JSON.stringify(rulesDraft) !== JSON.stringify(rulesToDraft(savedRules()));
}

function tagRulesCard() {
  if (!rulesDraft) rulesDraft = rulesToDraft(savedRules());
  const toggle = (key, label) => {
    const checkbox = h('input', { type: 'checkbox', checked: rulesDraft[key] });
    checkbox.addEventListener('change', () => { rulesDraft[key] = checkbox.checked; });
    return h('label', { class: 'auto-backup-toggle' }, checkbox, h('span', { text: label }));
  };
  return card(t('settings.tagRules'), t('settings.tagRulesHint'), h('div', { class: 'tag-rules' },
    toggle('autoApply', t('settings.tagRulesAuto')),
    toggle('folder', t('settings.tagRulesFolder')),
    h('p', { class: 'desc tag-rules-note', text: t('settings.tagRulesFolderHint') }),
    ruleSection('domains', t('settings.tagRulesDomains'), t('settings.tagRulesDomainsHint'), t('settings.tagRuleDomainPlaceholder')),
    ruleSection('keywords', t('settings.tagRulesKeywords'), t('settings.tagRulesKeywordsHint'), t('settings.tagRuleKeywordPlaceholder')),
    actions(
      button(t('settings.tagRulesSave'), 'primary', saveRules),
      button(t('settings.tagRulesApply'), '', applyRulesNow)
    )
  ), { search: [t('settings.tagRules'), t('settings.tagRulesHint'), t('settings.tagRulesDomains'), t('settings.tagRulesKeywords'), t('settings.tagRuleMatchExact'), t('settings.tagRuleMatchSubdomains'), t('settings.tagRulesSave'), t('settings.tagRulesApply')].join(' '), full: true });
}

function ruleSection(kind, title, hint, placeholder) {
  const rows = h('div', { class: 'tag-rule-rows' });
  rulesDraft[kind].forEach((rule, index) => {
    const valueInput = h('input', { type: 'text', placeholder, spellcheck: 'false', 'aria-label': placeholder });
    valueInput.value = rule.value;
    valueInput.addEventListener('input', () => { rule.value = valueInput.value; });
    const matchSelect = kind === 'domains' ? h('select', { class: 'tag-rule-match', 'aria-label': t('settings.tagRuleMatch') },
      h('option', { value: 'subdomains', text: t('settings.tagRuleMatchSubdomains') }),
      h('option', { value: 'exact', text: t('settings.tagRuleMatchExact') })) : null;
    if (matchSelect) {
      matchSelect.value = rule.match || 'subdomains';
      matchSelect.addEventListener('change', () => { rule.match = matchSelect.value; });
    }
    const tagsInput = h('input', { type: 'text', placeholder: t('settings.tagRuleTagsPlaceholder'), spellcheck: 'false', 'aria-label': t('settings.tagRuleTagsPlaceholder') });
    tagsInput.value = rule.tags;
    tagsInput.addEventListener('input', () => { rule.tags = tagsInput.value; });
    rows.append(h('div', { class: 'tag-rule-row' },
      valueInput,
      matchSelect,
      h('span', { class: 'tag-rule-arrow', text: '→' }),
      tagsInput,
      button(t('button.delete'), 'danger', () => { rulesDraft[kind].splice(index, 1); render(); })
    ));
  });
  return h('div', { class: 'tag-rule-section' },
    h('strong', { text: title }),
    h('p', { class: 'desc', text: hint }),
    rows,
    button(t('settings.tagRuleAdd'), '', () => { rulesDraft[kind].push(kind === 'domains' ? { value: '', match: 'subdomains', tags: '' } : { value: '', tags: '' }); render(); })
  );
}

async function saveRules() {
  const rules = draftToRules(rulesDraft);
  const filled = [...rulesDraft.domains, ...rulesDraft.keywords].filter((rule) => rule.value.trim() || rule.tags.trim()).length;
  const normalized = normalizeTagRules(rules);
  const ignored = filled - normalized.domains.length - normalized.keywords.length;
  try {
    await updateTagRules(rules);
    data = await loadData();
    rulesDraft = null;
    render();
    toast(ignored > 0 ? t('settings.tagRulesSaved') + ' · ' + t('settings.tagRulesIgnored', { COUNT: ignored }) : t('settings.tagRulesSaved'));
  } catch (error) { toast(error.message || String(error), 'error'); }
}

// 手动对现有书签（收藏和 Chrome 书签）执行规则：先预览数量，确认后执行，可撤销。
async function applyRulesNow() {
  if (rulesDirty()) { toast(t('settings.tagRulesUnsaved'), 'error'); return; }
  if (!hasActiveRules(savedRules())) { toast(t('settings.tagRulesEmpty'), 'error'); return; }
  try {
    const bookmarkEntries = bookmarkRuleEntries(await chrome.bookmarks.getTree());
    const preview = await applyTagRulesToExisting({ bookmarkEntries, dryRun: true });
    if (!preview.changed) {
      toast(preview.limited ? t('settings.tagRulesApplyLimited', { COUNT: preview.limited }) : t('settings.tagRulesApplyNone'));
      return;
    }
    const message = [
      t('settings.tagRulesApplyConfirm', { COUNT: preview.changed }),
      preview.limited ? t('settings.tagRulesApplyLimited', { COUNT: preview.limited }) : '',
    ].filter(Boolean).join(' ');
    const ok = await optionDialog(t('settings.tagRulesApplyTitle'), p(message), [
      { label: t('button.cancel'), kind: 'ghost', cancel: true },
      { label: t('button.confirm'), kind: 'primary', onClick: async () => true },
    ]);
    if (!ok) return;
    const result = await applyTagRulesToExisting({ bookmarkEntries });
    await reloadAfterTagChange();
    toastAction(t('settings.tagRulesApplied', { COUNT: result.changed }), t('tags.undo'), () => undoTagChange(result.snapshot));
  } catch (error) { toast(error.message || String(error), 'error'); }
}

function grid(...children) { return h('div', { class: 'options-grid' }, ...children); }
function card(title, desc, body, options = {}) {
  const element = h('section', { class: 'option-card' + (options.full ? ' full' : '') }, h('h2', { text: title }), h('p', { class: 'desc', text: desc }), body);
  const controls = [...element.querySelectorAll('button, input, select, textarea, a')];
  const controlText = controls.map((control) => [control.textContent, control.getAttribute('placeholder'), control.getAttribute('aria-label'), control.getAttribute('title')].filter(Boolean).join(' ')).join(' ');
  element.dataset.search = [title, desc, options.search || "", controlText].join(" ");
  return element;
}
function actions(...children) { return h('div', { class: 'actions' }, ...children); }
function stat(value, label) { return h('div', { class: 'stat' }, h('strong', { text: String(value) }), h('span', { text: label })); }
function p(text) { return h('p', { class: 'desc', text }); }
function externalLink(label, href) { return h('a', { class: 'about-link', href, target: '_blank', rel: 'noopener noreferrer' }, label); }
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = translateText(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'checked' && value) el.checked = true;
    else if (key === 'title' || key === 'placeholder' || key === 'aria-label') el.setAttribute(key, translateText(value));
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child != null) el.append(child instanceof Node ? child : document.createTextNode(translateText(child))); 
  return el;
}
function button(label, className, onClick) { return h('button', { class: className, onclick: onClick }, label); }
function toast(message, kind = 'ok') { const el = h('div', { class: 'toast ' + kind, text: message }); document.body.append(el); setTimeout(() => el.remove(), 2600); }
// 带操作按钮（如撤销）的提示停留更久，留出点击时间。
function toastAction(message, label, onClick) { const el = h('div', { class: 'toast ok toast-with-action' }, h('span', { text: message }), button(label, 'toast-action', () => { el.remove(); onClick(); })); document.body.append(el); setTimeout(() => el.remove(), 6000); }

function recycleView(stats) {
  const list = h('div', { class: 'recycle-list' });
  const entries = data.recycleBin || [];
  const toolbar = h('div', { class: 'recycle-toolbar' },
    h('span', { class: 'desc', text: entries.length ? ('批次 ' + stats.batches + ' · 条目 ' + stats.entries) : '回收站为空' }),
    h('span', { class: 'flex1' }),
    button('全选', '', () => { entries.forEach((entry) => recycleSelection.add(entry.id)); render(); }),
    button('清除选择', '', () => { recycleSelection.clear(); render(); })
  );
  list.append(toolbar);
  if (!entries.length) return list;
  for (const entry of entries) {
    const checked = recycleSelection.has(entry.id);
    const row = h('div', { class: 'recycle-row' },
      h('input', { type: 'checkbox', checked, onchange: (event) => { event.target.checked ? recycleSelection.add(entry.id) : recycleSelection.delete(entry.id); } }),
      h('div', { class: 'meta' }, h('strong', { text: entry.label }), h('small', { text: sourceLabel(entry.source) + ' · ' + new Date(entry.deletedAt).toLocaleString() + ' · 到期 ' + new Date(entry.expiresAt).toLocaleDateString() })),
      button('恢复', '', () => restoreEntries([entry.id])),
      button('永久删除', 'danger', () => purgeEntries([entry.id]))
    );
    list.append(row);
  }
  list.append(actions(
    button('恢复已选', 'primary', () => restoreEntries([...recycleSelection])),
    button('永久删除已选', 'danger', () => purgeEntries([...recycleSelection])),
    button('清空回收站', 'danger', async () => { if (!entries.length || !confirm('永久清空回收站？')) return; await clearRecycleBin(); recycleSelection.clear(); data = await loadData(); render(); toast('回收站已清空'); })
  ));
  return list;
}
function sourceLabel(source) { return ({ collection: 'PageClip 收藏', 'collection-folder': 'PageClip 文件夹', quick: '快捷收藏', 'quick-tab': '快捷集合网页', inbox: 'PageClip Inbox', 'chrome-bookmark': 'Chrome 书签' })[source] || source || '未知来源'; }
async function restoreEntries(ids) { const wanted = ids.filter((id) => (data.recycleBin || []).some((entry) => entry.id === id)); if (!wanted.length) return; for (const id of wanted) await restoreRecycleEntry(id); recycleSelection.clear(); data = await loadData(); render(); toast('已恢复 ' + wanted.length + ' 个回收批次'); }
async function purgeEntries(ids) { const wanted = ids.filter((id) => (data.recycleBin || []).some((entry) => entry.id === id)); if (!wanted.length || !confirm('永久删除选中的回收批次？')) return; for (const id of wanted) await purgeRecycleEntry(id); recycleSelection.clear(); data = await loadData(); render(); toast('已永久删除'); }

function exportActions() {
  return actions(
    button('导入收藏 HTML/CSV', '', () => chooseStructuredImport('collection')),
    button('导入快捷 HTML/CSV', '', () => chooseStructuredImport('quick')),
    button('导入 Inbox HTML/CSV', '', () => chooseStructuredImport('inbox')),
    button('导出收藏 HTML', '', () => downloadText(collectionHtml(data), 'PageClip-收藏.html', 'text/html')),
    button('导出收藏 CSV', '', () => downloadText(collectionCsv(data), 'PageClip-收藏.csv', 'text/csv')),
    button('导出快捷 HTML', '', () => downloadText(quickHtml(data), 'PageClip-快捷收藏.html', 'text/html')),
    button('导出快捷 CSV', '', () => downloadText(quickCsv(data), 'PageClip-快捷收藏.csv', 'text/csv')),
    button('导出 Inbox HTML', '', () => downloadText(inboxHtml(data), 'PageClip-Inbox.html', 'text/html')),
    button('导出 Inbox CSV', '', () => downloadText(inboxCsv(data), 'PageClip-Inbox.csv', 'text/csv')),
    button('导出 Chrome 书签 HTML', '', () => exportChrome('html')),
    button('导出 Chrome 书签 CSV', '', () => exportChrome('csv'))
  );
}
function collectionRows() { return (data.items || []).map((item) => [item.title, item.url, folderName(item.folderId), (item.tags || []).join('、'), item.note || '', new Date(item.createdAt).toISOString(), item.pinned ? '置顶' : '']); }
function folderName(id) { return (data.folders || []).find((folder) => folder.id === id)?.name || '未分类'; }
function quickRows() { return (data.quickAccess || []).flatMap((item) => item.type === 'group' ? (item.tabs || []).map((tab) => [item.title, tab.title, tab.url, '集合', new Date(item.updatedAt).toISOString()]) : [[item.title, item.title, item.url, '单页', new Date(item.updatedAt).toISOString()]]); }
function inboxRows() { return (data.inbox || []).map((item) => [item.title, item.url, item.readAt ? '已读' : '未读', new Date(item.createdAt).toISOString()]); }
function csv(rows, headers) { return '\ufeff' + [headers, ...rows].map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n'); }
function collectionCsv(d) { return csv(collectionRows(), ['标题', '网址', '文件夹', '标签', '备注', '创建时间', '状态']); }
function quickCsv(d) { return csv(quickRows(), ['集合', '标题', '网址', '类型', '更新时间']); }
function inboxCsv(d) { return csv(inboxRows(), ['标题', '网址', '状态', '创建时间']); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function listHtml(title, rows, headers) { return '<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title><h1>' + esc(title) + '</h1><table><thead><tr>' + headers.map((header) => '<th>' + esc(header) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row) => '<tr>' + row.map((value) => '<td>' + esc(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'; }
function collectionHtml(d) { return listHtml('PageClip 收藏', collectionRows(), ['标题', '网址', '文件夹', '标签', '备注', '创建时间', '状态']); }
function quickHtml(d) { return listHtml('PageClip 快捷收藏夹', quickRows(), ['集合', '标题', '网址', '类型', '更新时间']); }
function inboxHtml(d) { return listHtml('PageClip Inbox', inboxRows(), ['标题', '网址', '状态', '创建时间']); }
function downloadText(text, name, type) { const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function downloadBinary(bytes, name, type) { const url = URL.createObjectURL(new Blob([bytes], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

async function exportJson() { downloadText(JSON.stringify(exportPayload(data), null, 2), 'PageClip-备份-' + dateStamp() + '.json', 'application/json'); toast('JSON 备份已导出'); }
function chooseJson() { const input = h('input', { type: 'file', accept: '.json,application/json' }); input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const payload = JSON.parse(await file.text()); const mode = confirm('选择“确定”替换现有 PageClip 数据；选择“取消”执行合并导入。') ? 'replace' : 'merge'; const result = await importPayload(payload, mode); data = await loadData(); render(); toast('导入完成：新增 ' + result.itemsAdded + ' 条收藏'); } catch (error) { toast(error.message || '导入失败', 'error'); } }); input.click(); }
async function importCurrentBookmarks() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'run-bookmark-import' });
    if (!response?.ok) throw new Error(response?.message || t('settings.bookmarkAutoImportFailed'));
    const result = response.result || {};
    data = await loadData();
    render();
    toast(t('settings.bookmarkAutoImportDone', { ADDED: result.itemsAdded || 0, DUPLICATES: result.duplicatesSkipped || 0, INVALID: result.invalidSkipped || 0 }));
  } catch (error) { toast(error.message || t('settings.bookmarkAutoImportFailed'), 'error'); }
}

function autoBookmarkImportControls() {
  const settings = data.settings?.bookmarkAutoImport || {};
  const enabled = !!settings.enabled;
  const checkbox = h('input', { type: 'checkbox', checked: enabled });
  checkbox.addEventListener('change', () => saveAutoBookmarkImportSettings(checkbox.checked, checkbox));
  const result = settings.lastResult || {};
  const meta = settings.lastError
    ? t('settings.bookmarkAutoImportError', { ERROR: settings.lastError })
    : settings.lastSuccessAt
      ? t('settings.bookmarkAutoImportLast', { TIME: new Date(settings.lastSuccessAt).toLocaleString(), ADDED: result.itemsAdded || 0, DUPLICATES: result.duplicatesSkipped || 0 })
      : t('settings.bookmarkAutoImportNever');
  return h('div', { class: 'auto-bookmark-import-controls' },
    h('div', { class: 'auto-backup-header' }, h('strong', { text: t('settings.bookmarkAutoImport') }), h('span', { class: 'desc', text: enabled ? t('settings.bookmarkAutoImportEnabled') : t('settings.bookmarkAutoImportDisabled') })),
    h('label', { class: 'auto-backup-toggle' }, checkbox, h('span', { text: t('settings.bookmarkAutoImportToggle') })),
    h('p', { class: 'desc auto-backup-meta', text: meta }),
    settings.lastError ? button(t('settings.bookmarkAutoImportRetry'), '', importCurrentBookmarks) : null,
    h('p', { class: 'desc auto-backup-note', text: t('settings.bookmarkAutoImportHint') })
  );
}

async function saveAutoBookmarkImportSettings(enabled, checkbox) {
  if (enabled && !confirm(t('settings.bookmarkAutoImportConfirm'))) {
    checkbox.checked = false;
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'set-bookmark-auto-import', enabled });
    if (!response?.ok) throw new Error(response?.message || t('settings.bookmarkAutoImportFailed'));
    data = await loadData();
    render();
    const result = response.result || {};
    if (enabled && !result.skipped) toast(t('settings.bookmarkAutoImportDone', { ADDED: result.itemsAdded || 0, DUPLICATES: result.duplicatesSkipped || 0, INVALID: result.invalidSkipped || 0 }));
    else toast(t('settings.bookmarkAutoImportSaved'));
  } catch (error) {
    checkbox.checked = !enabled;
    toast(error.message || t('settings.bookmarkAutoImportFailed'), 'error');
  }
}
function chooseHtml() { const input = h('input', { type: 'file', accept: '.html,text/html' }); input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const result = await importBookmarksHtml(await file.text(), 'merge'); data = await loadData(); render(); toast('HTML 导入完成：新增 ' + result.itemsAdded + ' 条，重复 ' + result.duplicatesSkipped + ' 条，无效 ' + result.invalidSkipped + ' 条'); } catch (error) { toast(error.message || 'HTML 导入失败', 'error'); } }); input.click(); }
async function exportChrome(mode) { try { const tree = await chrome.bookmarks.getTree(); if (mode === 'html') downloadText(bookmarksHtml(tree), 'Chrome-书签.html', 'text/html'); else downloadText(bookmarksCsv(tree), 'Chrome-书签.csv', 'text/csv'); toast('Chrome 书签已导出'); } catch (error) { toast(error.message || 'Chrome 书签导出失败', 'error'); } }
function bookmarksHtml(tree) { const roots = Array.isArray(tree) ? tree : [tree]; function nodeHtml(node) { if (node.url) return '<DT><A HREF="' + esc(node.url) + '">' + esc(node.title || node.url) + '</A>\n'; const children = (node.children || []).map(nodeHtml).join(''); return '<DT><H3>' + esc(node.title || '未命名') + '</H3>\n<DL><p>\n' + children + '</DL><p>\n'; } return '<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p>\n' + roots.flatMap((root) => (root.children || []).map(nodeHtml)).join('') + '</DL><p>\n'; }
function bookmarksCsv(tree) { const rows=[]; function walk(node, path) { if (node.url) rows.push([path.join(' / '), node.title || node.url, node.url, node.dateAdded ? new Date(node.dateAdded).toISOString() : '']); else (node.children || []).forEach((child) => walk(child, node.id === '0' ? path : path.concat(node.title || '未命名'))); } (Array.isArray(tree) ? tree : [tree]).forEach((root) => walk(root, [])); return csv(rows, ['文件夹路径', '标题', '网址', '创建时间']); }

function chooseStructuredImport(target) {
  const input = h('input', { type: 'file', accept: '.html,.csv,text/html,text/csv' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const rows = await readStructuredRows(await file.text(), file.name);
      const payload = buildStructuredPayload(target, rows);
      const result = await importPayload(payload, 'merge');
      data = await loadData();
      render();
      const added = target === 'collection' ? result.itemsAdded : target === 'quick' ? (payload.quickAccess || []).length : (payload.inbox || []).length;
      toast('导入完成：新增 ' + added + ' 条，跳过 ' + payload._skipped + ' 条无效或重复');
    } catch (error) { toast(error.message || 'HTML/CSV 导入失败', 'error'); }
  });
  input.click();
}

async function readStructuredRows(text, fileName) {
  const source = String(text || '');
  if (/\.html?$/i.test(fileName) || /<table\b/i.test(source)) {
    if (typeof DOMParser === 'undefined') throw new Error('当前环境不支持 HTML 解析');
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const table = doc.querySelector('table');
    if (!table) throw new Error('HTML 中没有可导入的数据表格');
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim());
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    if (!headers.length) throw new Error('HTML 表格缺少表头');
    return bodyRows.map((tr) => { const values = Array.from(tr.querySelectorAll('td')).map((cell) => cell.textContent.trim()); return Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])); });
  }
  const records = parseCsv(source);
  if (records.length < 1) throw new Error('CSV 文件为空');
  const headers = records.shift().map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '') : header);
  return records.filter((record) => record.some((value) => value.trim())).map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ''])));
}

function parseCsv(source) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function isSupportedImportUrl(url) { try { const parsed = new URL(String(url || '').trim()); return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? !!parsed.hostname : parsed.protocol === 'file:'; } catch { return false; } }
function field(row, names) { for (const name of names) if (row[name] !== undefined) return String(row[name]).trim(); return ''; }
function rowUrl(row) { return field(row, ['网址', 'URL', 'url', '链接']); }
function rowTitle(row) { return field(row, ['标题', 'title', '名称']) || rowUrl(row); }
function rowTime(row) { const value = field(row, ['创建时间', '更新时间', '时间']); const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : Date.now(); }

function buildStructuredPayload(target, rows) {
  const valid = [], seen = new Set();
  for (const row of rows) {
    const url = rowUrl(row);
    if (!isSupportedImportUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    valid.push({ row, url });
  }
  const skipped = rows.length - valid.length;
  if (target === 'collection') {
    const folders = [], folderIds = new Map();
    const items = valid.map(({ row, url }) => {
      const folderName = field(row, ['文件夹', 'folder', '文件夹路径']);
      let folderId = 'f_uncategorized';
      if (folderName) { if (!folderIds.has(folderName)) { folderId = 'import-folder-' + folderIds.size; folderIds.set(folderName, folderId); folders.push({ id: folderId, name: folderName.split(' / ').pop(), parentId: null }); } else folderId = folderIds.get(folderName); }
      return { url, title: rowTitle(row), folderId, tags: field(row, ['标签', 'tags']).split(/[、,，\s]+/).filter(Boolean), note: field(row, ['备注', 'note']), createdAt: rowTime(row) };
    });
    return { items, folders, _skipped: skipped };
  }
  if (target === 'inbox') {
    return { items: [], quickAccess: [], inbox: valid.map(({ row, url }) => ({ url, title: rowTitle(row), createdAt: rowTime(row), updatedAt: rowTime(row), readAt: field(row, ['状态', 'status']) === '已读' ? rowTime(row) : null })), _skipped: skipped };
  }
  const groups = new Map(), singles = [];
  for (const { row, url } of valid) {
    const type = field(row, ['类型', 'type']);
    const groupTitle = field(row, ['集合', 'group']);
    if (type === '集合' && groupTitle) { if (!groups.has(groupTitle)) groups.set(groupTitle, []); groups.get(groupTitle).push({ url, title: rowTitle(row) }); }
    else singles.push({ type: 'single', title: rowTitle(row), url, createdAt: rowTime(row), updatedAt: rowTime(row), pinned: false });
  }
  const quickAccess = [...singles, ...[...groups.entries()].map(([title, tabs], index) => ({ id: 'import-group-' + index, type: 'group', title, tabs, createdAt: Date.now(), updatedAt: Date.now(), pinned: false, order: index }))];
  return { items: [], quickAccess, inbox: [], _skipped: skipped };
}

function dateStamp() { return new Date().toISOString().slice(0, 10); }

init();
