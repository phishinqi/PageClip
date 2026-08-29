// Google Drive appDataFolder：只保存加密后的 PageClip 密文包。
import { loadData, updateSettings } from './store.js';

export const BACKUP_FILE_NAME = 'PageClip-latest.enc';
export const BACKUP_MIME = 'application/octet-stream';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CLOUD_SETTINGS = 'cloudBackup';
let tokenCache = null;

function identityApi() { if (!chrome.identity?.getAuthToken) throw new Error('当前浏览器不支持 Google OAuth'); return chrome.identity; }
async function getToken(interactive = true) {
  if (tokenCache) return tokenCache;
  let result;
  try { result = await identityApi().getAuthToken({ interactive }); }
  catch (error) {
    const message = error?.message || String(error);
    if (/invalid_request/i.test(message)) {
      const extensionId = chrome.runtime?.id || '当前扩展 ID';
      throw new Error('Google OAuth 配置无效（invalid_request）。请在 Google Cloud 创建“Chrome Extension”类型 OAuth Client，并将 Item ID 设置为 ' + extensionId + '；不要使用 Web application / Desktop client。');
    }
    throw error;
  }
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('未获取到 Google OAuth Token');
  tokenCache = token;
  return token;
}
async function clearToken() {
  const token = tokenCache;
  tokenCache = null;
  try { if (token && chrome.identity?.removeCachedAuthToken) await chrome.identity.removeCachedAuthToken({ token }); } catch {}
}
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
  if (response.status === 401 && retry) { await clearToken(); return driveRequest(path, options, false); }
  return jsonResponse(response);
}
function cloudSettings(data) { return data.settings?.[CLOUD_SETTINGS] || {}; }
async function saveCloudSettings(patch) {
  const data = await loadData();
  await updateSettings({ [CLOUD_SETTINGS]: { ...cloudSettings(data), ...patch } });
}

export async function connectGoogle() {
  await getToken(true);
  let profile = {};
  try { profile = await identityApi().getProfileUserInfo({ accountStatus: 'ANY' }); } catch {}
  const email = profile.email || '';
  await saveCloudSettings({ googleAccountEmail: email || null });
  return { email: email || null };
}

export async function getConnectedAccount() {
  const data = await loadData();
  const settings = cloudSettings(data);
  if (settings.googleAccountEmail) return { email: settings.googleAccountEmail };
  if (!tokenCache) return null;
  try {
    const profile = await identityApi().getProfileUserInfo({ accountStatus: 'ANY' });
    return profile?.email ? { email: profile.email } : { email: null };
  } catch { return { email: null }; }
}

export async function signOutGoogle() {
  await clearToken();
  try { await chrome.identity?.clearAllCachedAuthTokens?.(); } catch {}
  const data = await loadData();
  const settings = cloudSettings(data);
  await updateSettings({ [CLOUD_SETTINGS]: { ...settings, googleAccountEmail: null, driveFileId: null, lastBackupAt: null, lastBackupSize: null, lastEncryptionMode: null } });
  return { signedOut: true };
}

async function listBackupFiles(interactive = true) {
  const q = "name = '" + BACKUP_FILE_NAME + "' and trashed = false";
  const query = new URLSearchParams({ spaces: 'appDataFolder', q, pageSize: '100', orderBy: 'modifiedTime desc', fields: 'files(id,name,size,createdTime,modifiedTime,mimeType)' });
  const result = await driveRequest(DRIVE_API + '/files?' + query.toString(), { interactive });
  return Array.isArray(result?.files) ? result.files : [];
}

export async function findLatestBackup(interactive = true) {
  const files = await listBackupFiles(interactive);
  return files[0] || null;
}

async function uploadMedia(fileId, serialized) {
  return driveRequest(DRIVE_UPLOAD_API + '/files/' + encodeURIComponent(fileId) + '?uploadType=media&fields=id,name,size,createdTime,modifiedTime,mimeType', { method: 'PATCH', headers: { 'Content-Type': BACKUP_MIME }, body: serialized });
}
async function createDriveFile(serialized) {
  const metadata = await driveRequest(DRIVE_API + '/files?fields=id,name,size,createdTime,modifiedTime,mimeType', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: BACKUP_FILE_NAME, parents: ['appDataFolder'], mimeType: BACKUP_MIME }) });
  try { return await uploadMedia(metadata.id, serialized); } catch (error) { await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(metadata.id), { method: 'DELETE' }).catch(() => {}); throw error; }
}

export async function uploadLatestBackup(envelope) {
  if (!envelope || envelope.format !== 'pageclip-cloud-backup') throw new Error('备份密文包格式不正确');
  const serialized = JSON.stringify(envelope);
  const files = await listBackupFiles();
  const data = await loadData();
  const configuredId = data.settings?.[CLOUD_SETTINGS]?.driveFileId;
  const target = files.find((file) => file.id === configuredId) || files[0];
  const result = target ? await uploadMedia(target.id, serialized) : await createDriveFile(serialized);
  const duplicates = files.filter((file) => file.id !== result.id);
  for (const duplicate of duplicates) await driveRequest(DRIVE_API + '/files/' + encodeURIComponent(duplicate.id), { method: 'DELETE' }).catch(() => {});
  await saveCloudSettings({ driveFileId: result.id, lastBackupAt: Date.now(), lastBackupSize: new TextEncoder().encode(serialized).byteLength, lastEncryptionMode: envelope.encryption?.mode || null });
  return { ...result, removedDuplicates: duplicates.length, size: new TextEncoder().encode(serialized).byteLength };
}

export async function downloadLatestBackup() {
  const files = await listBackupFiles();
  const data = await loadData();
  const configuredId = data.settings?.[CLOUD_SETTINGS]?.driveFileId;
  const file = files.find((item) => item.id === configuredId) || files[0];
  if (!file) throw new Error('Google Drive 中没有 PageClip 云备份');
  const token = await getToken(true);
  let response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + token } });
  if (response.status === 401) { await clearToken(); const retryToken = await getToken(true); response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + retryToken } }); }
  const envelope = await jsonResponse(response);
  await saveCloudSettings({ driveFileId: file.id });
  return { file, envelope };
}

export async function getCloudBackupStatus() {
  const data = await loadData();
  const account = cloudSettings(data).googleAccountEmail ? { email: cloudSettings(data).googleAccountEmail } : null;
  if (!account && !tokenCache) return { connected: false, account: null, file: null };
  try { return { connected: true, account: account || await getConnectedAccount(), file: tokenCache ? await findLatestBackup(false) : null }; }
  catch (error) { return { connected: true, account, file: null, error: error.message }; }
}
