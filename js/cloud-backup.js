// Google Drive appDataFolder：只保存加密后的 PageClip 密文包。
import { loadData, updateSettings, getCloudBackupPayload } from './store.js';
import { encryptBackup, getOrCreateDeviceKey } from './crypto-backup.js';

export const BACKUP_FILE_NAME = 'PageClip-latest.enc';
export const BACKUP_MIME = 'application/octet-stream';
export const AUTO_BACKUP_ALARM = 'pageclip-auto-backup';
const BACKUP_HISTORY_PREFIX = 'PageClip-backup-';
const BACKUP_HISTORY_LIMIT = 20;
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CLOUD_SETTINGS = 'cloudBackup';
// Authentication is shared by backup and causal sync; never cache native tokens here.
import { getToken, clearToken, getAuthenticatedAccount, disconnectAuthentication, authenticationStatus } from './google-auth.js';
export { getToken, clearToken, getAuthenticatedAccount } from './google-auth.js';
async function resolveAccountInfo(token) { return getAuthenticatedAccount(token); }
async function jsonResponse(response) {
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(body?.error?.message || ('Google Drive 请求失败（HTTP ' + response.status + '）'));
  return body;
}
async function driveRequest(path, options = {}, retry = true) {
  const token = await getToken(options.interactive !== false);
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(path, { ...options, headers, interactive: undefined });
  if (response.status === 401 && retry) { await clearToken(token); return driveRequest(path, { ...options, interactive: false }, false); }
  return jsonResponse(response);
}
function cloudSettings(data) { return data.settings?.[CLOUD_SETTINGS] || {}; }
async function saveCloudSettings(patch) {
  const data = await loadData();
  await updateSettings({ [CLOUD_SETTINGS]: { ...cloudSettings(data), ...patch } });
}

export async function connectGoogle() {
  const token = await getToken(true);
  const account = await resolveAccountInfo(token);
  await saveCloudSettings({ googleAccountEmail: account.email || null, googleAuthorizedAt: Date.now(), authRequired: false, lastAutoBackupError: null });
  return { email: account.email || null, accountError: account.error || null };
}

export async function getConnectedAccount() {
  const data = await loadData();
  const settings = cloudSettings(data);
  if (settings.googleAccountEmail) return { email: settings.googleAccountEmail, error: null };
  return null;
}

export async function signOutGoogle() {
  await disconnectAuthentication();
  const data = await loadData();
  const settings = cloudSettings(data);
  await updateSettings({ [CLOUD_SETTINGS]: { ...settings, googleAccountEmail: null, driveFileId: null, lastBackupAt: null, lastBackupSize: null, lastEncryptionMode: null, autoBackupEnabled: false, authRequired: false, lastAutoBackupError: null } });
  return { signedOut: true };
}

function backupQuery(includeHistory = false) {
  const nameQuery = includeHistory ? "(name = '" + BACKUP_FILE_NAME + "' or name contains '" + BACKUP_HISTORY_PREFIX + "')" : "name = '" + BACKUP_FILE_NAME + "'";
  return nameQuery + ' and trashed = false';
}
async function listBackupFiles(interactive = true, includeHistory = false) {
  const query = new URLSearchParams({ spaces: 'appDataFolder', q: backupQuery(includeHistory), pageSize: '100', orderBy: 'modifiedTime desc', fields: 'files(id,name,size,createdTime,modifiedTime,mimeType)' });
  const result = await driveRequest(DRIVE_API + '/files?' + query.toString(), { interactive });
  return Array.isArray(result?.files) ? result.files : [];
}
export async function listBackups(interactive = true) {
  return listBackupFiles(interactive, true);
}
export async function findLatestBackup(interactive = true) {
  const files = await listBackupFiles(interactive, false);
  return files.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))[0] || null;
}
async function uploadMedia(fileId, serialized, interactive = true) {
  return driveRequest(DRIVE_UPLOAD_API + '/files/' + encodeURIComponent(fileId) + '?uploadType=media&fields=id,name,size,createdTime,modifiedTime,mimeType', { method: 'PATCH', headers: { 'Content-Type': BACKUP_MIME }, body: serialized, interactive });
}
async function createDriveFile(fileName, serialized, interactive = true) {
  const metadata = await driveRequest(DRIVE_API + '/files?fields=id,name,size,createdTime,modifiedTime,mimeType', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fileName, parents: ['appDataFolder'], mimeType: BACKUP_MIME }), interactive });
  try { return await uploadMedia(metadata.id, serialized, interactive); } catch (error) { await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(metadata.id), { method: 'DELETE', interactive }).catch(() => {}); throw error; }
}
async function createHistorySnapshot(serialized, interactive) {
  const suffix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return createDriveFile(BACKUP_HISTORY_PREFIX + suffix + '.enc', serialized, interactive);
}
async function pruneBackupHistory(files, interactive) {
  const history = files.filter((file) => String(file.name || '').startsWith(BACKUP_HISTORY_PREFIX)).sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  const stale = history.slice(BACKUP_HISTORY_LIMIT);
  for (const file of stale) await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(file.id), { method: 'DELETE', interactive }).catch(() => {});
  return stale.length;
}
export async function uploadLatestBackup(envelope, options = {}) {
  if (!envelope || envelope.format !== 'pageclip-cloud-backup') throw new Error('备份密文包格式不正确');
  const interactive = options.interactive !== false;
  const keepHistory = options.keepHistory !== false;
  const serialized = JSON.stringify(envelope);
  const files = await listBackupFiles(interactive, true);
  const data = await loadData();
  const configuredId = data.settings?.[CLOUD_SETTINGS]?.driveFileId;
  const latestFiles = files.filter((file) => file.name === BACKUP_FILE_NAME);
  const target = latestFiles.find((file) => file.id === configuredId) || latestFiles[0];
  const result = target ? await uploadMedia(target.id, serialized, interactive) : await createDriveFile(BACKUP_FILE_NAME, serialized, interactive);
  const duplicates = latestFiles.filter((file) => file.id !== result.id);
  for (const duplicate of duplicates) await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(duplicate.id), { method: 'DELETE', interactive }).catch(() => {});
  let historyFile = null;
  let historyError = null;
  if (keepHistory) {
    try { historyFile = await createHistorySnapshot(serialized, interactive); } catch (error) { historyError = error?.message || String(error); }
  }
  const historyFiles = [...files.filter((file) => String(file.name || '').startsWith(BACKUP_HISTORY_PREFIX)), ...(historyFile ? [historyFile] : [])];
  const historyRemoved = await pruneBackupHistory(historyFiles, interactive);
  await saveCloudSettings({ driveFileId: result.id, lastBackupAt: Date.now(), lastBackupSize: new TextEncoder().encode(serialized).byteLength, lastEncryptionMode: envelope.encryption?.mode || null });
  return { ...result, historyFile, historyError, historyRemoved, removedDuplicates: duplicates.length, size: new TextEncoder().encode(serialized).byteLength };
}
async function downloadBackupFile(file, interactive = true) {
  const token = await getToken(interactive);
  let response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + token } });
  if (response.status === 401) { await clearToken(token); const retryToken = await getToken(false); response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + retryToken } }); }
  const envelope = await jsonResponse(response);
  return { file, envelope };
}
export async function downloadBackup(fileId = null, interactive = true) {
  const files = await listBackupFiles(interactive, true);
  const data = await loadData();
  const configuredId = data.settings?.[CLOUD_SETTINGS]?.driveFileId;
  const file = fileId ? files.find((item) => item.id === fileId) : files.find((item) => item.id === configuredId && item.name === BACKUP_FILE_NAME) || files.find((item) => item.name === BACKUP_FILE_NAME);
  if (!file) throw new Error('Google Drive 中没有 PageClip 云备份');
  const result = await downloadBackupFile(file, interactive);
  if (file.name === BACKUP_FILE_NAME) await saveCloudSettings({ driveFileId: file.id });
  return result;
}
export async function downloadLatestBackup() {
  return downloadBackup(null, true);
}
let automaticBackupRunning = false;
export async function runAutomaticBackup() {
  if (automaticBackupRunning) return { skipped: true, reason: 'running' };
  const data = await loadData();
  const settings = cloudSettings(data);
  if (!settings.autoBackupEnabled) return { skipped: true, reason: 'disabled' };
  if (settings.authRequired) return { skipped: true, reason: 'authorization-required', justPaused: false };
  automaticBackupRunning = true;
  try {
    const key = await getOrCreateDeviceKey();
    const envelope = await encryptBackup(getCloudBackupPayload(data), { mode: 'device-key', key });
    const result = await uploadLatestBackup(envelope, { interactive: false, keepHistory: true, automatic: true });
    await saveCloudSettings({ autoBackupMode: 'device-key', lastAutoBackupAt: Date.now(), lastAutoBackupError: null, authRequired: false });
    return { skipped: false, ...result };
  } catch (error) {
    if (error?.kind === 'auth' || error?.kind === 'permission') {
      await saveCloudSettings({ authRequired: true, lastAutoBackupError: null }).catch(() => {});
      return { skipped: true, reason: 'authorization-required', justPaused: true };
    }
    await saveCloudSettings({ lastAutoBackupError: error?.message || String(error) }).catch(() => {});
    throw error;
  } finally {
    automaticBackupRunning = false;
  }
}

export async function getCloudBackupStatus() {
  const data = await loadData();
  const settings = cloudSettings(data);
  const storedEmail = settings.googleAccountEmail || '';
  const storedAccount = storedEmail ? { email: storedEmail, error: null } : null;
  const auth = await authenticationStatus();
  if (!storedAccount) return { connected: false, authorizationRequired: false, account: null, file: null, authentication: auth };
  if (['reauthorize', 'unsupported', 'permission', 'disconnected'].includes(auth.status)) return { connected: false, authorizationRequired: auth.status !== 'disconnected', account: storedAccount, file: null, authentication: auth };
  if (settings.authRequired) return { connected: false, authorizationRequired: true, account: storedAccount, file: null };
  try {
    const account = storedAccount || await getConnectedAccount();
    return {
      connected: true,
      authorizationRequired: false,
      account: account?.email ? { email: account.email } : null,
      accountError: account?.error || null,
      authentication: auth,
      file: null,
    };
  } catch (error) {
    return { connected: true, authorizationRequired: false, account: storedAccount, file: null, error: error.message };
  }
}
