import {
  ensureDataInitialized, loadData, getStats, getInboxStats, getRecycleStats,
  exportPayload, importPayload, restoreRecycleEntry, purgeRecycleEntry,
  clearRecycleBin, pruneRecycleBin, updateSettings, getCloudBackupPayload, previewCloudRestore, restoreCloudPayload,
} from './js/store.js';
import { importBrowserBookmarks, importBookmarksHtml } from './js/bookmark-import.js';
import { encryptBackup, decryptBackup, createPasswordVerifier, verifyBackupPassword, getOrCreateDeviceKey, exportEncryptedRecoveryKey, importEncryptedRecoveryKey } from './js/crypto-backup.js';
import { connectGoogle, getConnectedAccount, signOutGoogle, uploadLatestBackup, downloadLatestBackup, getCloudBackupStatus } from './js/cloud-backup.js';

const root = document.getElementById('options-root');
let data = null;
let recycleSelection = new Set();
let cloudStatus = { connected: false, account: null, file: null };

async function init() {
  await ensureDataInitialized();
  await pruneRecycleBin();
  data = await loadData();
  cloudStatus = await getCloudBackupStatus();
  render();
}

function render() {
  const stats = getStats(data);
  const inbox = getInboxStats(data);
  const recycle = getRecycleStats(data);
  const quick = data.quickAccess || [];
  root.replaceChildren(
    grid(
      card('数据统计', 'PageClip 的数据全部保存在本机 chrome.storage.local。', h('div', { class: 'stat-grid' },
        stat(stats.items, '永久收藏'),
        stat(quick.filter((item) => item.type === 'single').length, '快捷单页'),
        stat(quick.filter((item) => item.type === 'group').length, '快捷集合'),
        stat(inbox.unread, 'Inbox 未读'),
        stat(inbox.read, 'Inbox 已读'),
        stat(stats.folders, '文件夹'),
        stat(stats.tags, '标签'),
        stat(recycle.entries, '回收站条目')
      )),
      cloudCard(),
      card('备份与恢复', 'JSON 会保留永久收藏、文件夹、快捷收藏夹和 Inbox；导入支持合并或替换。', actions(
        button('导出 JSON 备份', 'primary', exportJson),
        button('导入 JSON 备份', '', chooseJson)
      )),
      card('导入浏览器书签', '只复制到 PageClip，不修改 Chrome 原生书签。当前浏览器树和 bookmarks.html 都会保留根目录及嵌套层级。', actions(
        button('读取当前浏览器书签', 'primary', importCurrentBookmarks),
        button('选择 bookmarks.html', '', chooseHtml)
      )),
      card('HTML / CSV 导入与导出', 'PageClip 三类数据支持导入导出；Chrome 书签使用 bookmarks.html 入口，导入只写入 PageClip。', exportActions()),
      card('回收站', '删除和完成并移除会保留 30 天；过期快照会自动清理。', recycleView(recycle)),
      card('快捷键与存储说明', '快捷键可在 Chrome 扩展快捷键页修改。', h('div', {},
        p('Ctrl+Shift+S：永久收藏　Ctrl+Shift+Q：快捷收藏　Ctrl+Shift+R：加入 Inbox　Ctrl+Shift+P：网页侧栏'),
        button('打开快捷键设置', '', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })),
        h('p', { class: 'desc option-note', text: '数据仅保存在本机，不上传服务器；卸载扩展前请先导出 JSON 备份。' })
      ))
    )
  );
}


function cloudCard() {
  const account = cloudStatus.account?.email || data.settings?.cloudBackup?.googleAccountEmail || '';
  const file = cloudStatus.file;
  const localLast = data.settings?.cloudBackup?.lastBackupAt;
  const statusText = cloudStatus.error ? '连接失败：' + cloudStatus.error : file ? '云端已有备份 · 修改时间 ' + new Date(file.modifiedTime).toLocaleString() : localLast ? '本机记录上次备份：' + new Date(localLast).toLocaleString() : '尚未上传备份';
  return card('Google Drive 云端备份', '使用 Google OAuth 登录，备份上传到 Drive 隐藏应用数据目录；上传内容始终是加密密文。', h('div', { class: 'cloud-backup' },
    h('div', { class: 'cloud-status' }, h('strong', { text: account ? '已连接：' + account : '尚未连接 Google 账号' }), h('span', { class: 'desc', text: statusText })),
    actions(
      account ? null : button('连接 Google Drive', 'primary', connectCloud),
      account ? button('手动备份', 'primary', runCloudBackup) : null,
      account ? button('手动恢复', '', runCloudRestore) : null,
      account ? button('导出本机恢复密钥', '', exportRecoveryKey) : null,
      account ? button('导入本机恢复密钥', '', importRecoveryKey) : null,
      account ? button('退出并更换账号', 'danger', disconnectCloud) : null
    ),
    h('p', { class: 'desc cloud-note', text: '每次备份选择加密方式：备份密码或 Chrome 本机密钥。本机密钥跨设备恢复需要加密恢复密钥文件。' })
  ));
}

async function connectCloud() { try { await connectGoogle(); cloudStatus = await getCloudBackupStatus(); data = await loadData(); render(); toast('Google Drive 已连接'); } catch (error) { toast(error.message || 'Google 登录失败', 'error'); } }
async function disconnectCloud() { if (!confirm('退出 Google 账号？不会删除云端备份，也不会删除本机 PageClip 数据。')) return; try { await signOutGoogle(); cloudStatus = await getCloudBackupStatus(); data = await loadData(); render(); toast('已退出 Google 账号'); } catch (error) { toast(error.message || '退出失败', 'error'); } }

async function chooseBackupMode() {
  const body = h('div', { class: 'cloud-form' });
  const passwordRadio = h('input', { type: 'radio', name: 'cloud-encryption-mode', checked: true });
  const deviceRadio = h('input', { type: 'radio', name: 'cloud-encryption-mode' });
  const passwordHint = h('p', { class: 'desc', text: '每次备份输入密码；密码不保存，只保存本机 verifier。' });
  body.append(h('label', { class: 'radio-row' }, passwordRadio, h('span', {}, h('strong', { text: '备份密码加密' }), passwordHint)), h('label', { class: 'radio-row' }, deviceRadio, h('span', {}, h('strong', { text: 'Chrome 本机密钥加密' }), h('p', { class: 'desc', text: '同一浏览器可直接恢复；跨设备需要导入加密恢复密钥。' }))));
  return optionDialog('选择备份加密方式', body, [
    { label: '取消', kind: 'ghost', cancel: true },
    { label: '下一步', kind: 'primary', onClick: async () => ({ mode: deviceRadio.checked ? 'device-key' : 'password' }) }
  ]);
}

async function askPassword(title, confirmPassword = false, label = '备份密码') {
  const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 8 个字符' });
  const confirmInput = confirmPassword ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: '再次输入密码' }) : null;
  const body = h('div', { class: 'cloud-form' }, h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: label }), password), confirmInput ? h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: '确认' }), confirmInput) : null, h('p', { class: 'desc', text: 'PageClip 不保存密码；忘记密码且没有本机恢复密钥时无法解密备份。' }));
  return optionDialog(title, body, [{ label: '取消', kind: 'ghost', cancel: true }, { label: '确定', kind: 'primary', onClick: async () => { if (password.value.length < 8 || (confirmInput && password.value !== confirmInput.value)) { toast(confirmInput ? '密码至少 8 个字符且两次输入必须一致' : '密码至少需要 8 个字符', 'error'); return false; } return password.value; } }]);
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
    if (cloudStatus.file && !confirm('云端已有 PageClip-latest.enc，确认覆盖为当前本机数据？')) return;
    const envelope = await encryptBackup(getCloudBackupPayload(data), options);
    const result = await uploadLatestBackup(envelope);
    cloudStatus = await getCloudBackupStatus();
    data = await loadData(); render(); toast('备份成功：' + Math.round(result.size / 1024) + ' KB');
  } catch (error) { toast(error.message || '云端备份失败', 'error'); }
}

async function runCloudRestore() {
  try {
    if (!cloudStatus.connected) await connectGoogle();
    const remote = await downloadLatestBackup();
    let options = {};
    if (remote.envelope.encryption?.mode === 'password') { const password = await askPassword('输入备份密码', false); if (!password) return; options.password = password; }
    else if (remote.envelope.encryption?.mode === 'device-key') options.key = await getOrCreateDeviceKey();
    const cloudData = await decryptBackup(remote.envelope, options);
    const diff = previewCloudRestore(data, cloudData);
    const decision = await showRestorePreview(remote.file, diff); if (!decision) return;
    if (decision === 'replace' && !confirm('替换会覆盖当前本机 PageClip 数据，确认继续？')) return;
    await restoreCloudPayload(cloudData, decision); data = await loadData(); cloudStatus = await getCloudBackupStatus(); render(); toast(decision === 'replace' ? '已用云端备份替换本机数据' : '已合并云端备份');
  } catch (error) { toast(error.message || '云端恢复失败', 'error'); }
}

async function showRestorePreview(file, diff) {
  const body = h('div', { class: 'restore-preview' }, h('p', { class: 'desc', text: '云端备份：' + new Date(file.modifiedTime || Date.now()).toLocaleString() }), h('div', { class: 'diff-grid' },
    stat(diff.cloud.items, '云端收藏'), stat(diff.cloud.quickSingles, '快捷单页'), stat(diff.cloud.quickGroups, '快捷集合'), stat(diff.cloud.inbox, 'Inbox'), stat(diff.cloud.recycleEntries, '回收站'), stat(diff.added, '可新增'), stat(diff.same, '相同'), stat(diff.conflicts, '冲突'), stat(diff.localOnly, '本机独有')
  ), h('p', { class: 'desc', text: '合并：冲突保留本机；替换：完整采用云端 schema 3。' }));
  return optionDialog('恢复差异预览', body, [{ label: '取消', kind: 'ghost', cancel: true }, { label: '合并', kind: 'primary', onClick: async () => 'merge' }, { label: '替换', kind: 'danger', onClick: async () => 'replace' }]);
}

async function exportRecoveryKey() { try { const password = await askPassword('设置恢复密钥密码', true, '恢复密钥密码'); if (!password) return; const file = await exportEncryptedRecoveryKey(password); downloadText(JSON.stringify(file, null, 2), 'PageClip-device-recovery-key.json', 'application/json'); toast('加密恢复密钥已导出'); } catch (error) { toast(error.message || '恢复密钥导出失败', 'error'); } }
function importRecoveryKey() { const input = h('input', { type: 'file', accept: '.json,application/json' }); input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const password = await askPassword('输入恢复密钥密码', false, '恢复密钥密码'); if (!password) return; await importEncryptedRecoveryKey(file, password); toast('本机恢复密钥已导入'); } catch (error) { toast(error.message || '恢复密钥导入失败', 'error'); } }); input.click(); }

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

function grid(...children) { return h('div', { class: 'options-grid' }, ...children); }
function card(title, desc, body) { return h('section', { class: 'option-card' }, h('h2', { text: title }), h('p', { class: 'desc', text: desc }), body); }
function actions(...children) { return h('div', { class: 'actions' }, ...children); }
function stat(value, label) { return h('div', { class: 'stat' }, h('strong', { text: String(value) }), h('span', { text: label })); }
function p(text) { return h('p', { class: 'desc', text }); }
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'checked' && value) el.checked = true;
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child != null) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}
function button(label, className, onClick) { return h('button', { class: className, onclick: onClick }, label); }
function toast(message, kind = 'ok') { const el = h('div', { class: 'toast ' + kind, text: message }); document.body.append(el); setTimeout(() => el.remove(), 2600); }

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

async function exportJson() { downloadText(JSON.stringify(exportPayload(data), null, 2), 'PageClip-备份-' + dateStamp() + '.json', 'application/json'); toast('JSON 备份已导出'); }
function chooseJson() { const input = h('input', { type: 'file', accept: '.json,application/json' }); input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const payload = JSON.parse(await file.text()); const mode = confirm('选择“确定”替换现有 PageClip 数据；选择“取消”执行合并导入。') ? 'replace' : 'merge'; const result = await importPayload(payload, mode); data = await loadData(); render(); toast('导入完成：新增 ' + result.itemsAdded + ' 条收藏'); } catch (error) { toast(error.message || '导入失败', 'error'); } }); input.click(); }
async function importCurrentBookmarks() { try { const tree = await chrome.bookmarks.getTree(); const result = await importBrowserBookmarks(tree, 'merge'); data = await loadData(); render(); toast('导入完成：新增 ' + result.itemsAdded + ' 条，重复 ' + result.duplicatesSkipped + ' 条，无效 ' + result.invalidSkipped + ' 条'); } catch (error) { toast(error.message || '浏览器书签导入失败', 'error'); } }
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
