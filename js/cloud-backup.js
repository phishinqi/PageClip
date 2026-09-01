// Google Drive appDataFolder：只保存加密后的 PageClip 密文包。
import { loadData, updateSettings, getCloudBackupPayload } from './store.js';
import { encryptBackup, getOrCreateDeviceKey } from './crypto-backup.js';

export const BACKUP_FILE_NAME = 'PageClip-latest.enc';
export const BACKUP_MIME = 'application/octet-stream';
export const AUTO_BACKUP_ALARM = 'pageclip-auto-backup';
export const AUTO_BACKUP_DEFAULT_HOURS = 24;
export const AUTO_BACKUP_INTERVALS = [6, 12, 24, 168];
const BACKUP_HISTORY_PREFIX = 'PageClip-backup-';
const BACKUP_HISTORY_LIMIT = 20;
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CLOUD_SETTINGS = 'cloudBackup';
// Brave cannot reliably use Chrome's getAuthToken() flow. This public client ID
// is only used by the chromiumapp.org redirect fallback; never ship a client secret.
const BRAVE_WEB_CLIENT_ID = '996608683771-lsgfug2pj1oou55naskrj1n48oa27qgi.apps.googleusercontent.com';
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];
const BRAVE_OAUTH_SCOPES = [...OAUTH_SCOPES, 'openid', 'https://www.googleapis.com/auth/userinfo.email'];
const GOOGLE_USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
let tokenCache = null;
let pendingTokenRequest = null;
let pendingInteractiveUpgrade = null;

function identityApi() {
  if (!chrome.identity) throw new Error('当前浏览器不支持 Google OAuth');
  return chrome.identity;
}
async function isBraveBrowser() {
  try {
    const detector = globalThis.navigator?.brave?.isBrave;
    if (typeof detector === 'function') return Boolean(await detector.call(globalThis.navigator.brave));
  } catch {}
  const brands = globalThis.navigator?.userAgentData?.brands;
  if (Array.isArray(brands) && brands.some((entry) => /brave/i.test(entry?.brand || ''))) return true;
  // Last-resort compatibility check. Brave may expose a Chrome-compatible UA,
  // so this is deliberately not the primary detection mechanism.
  return /\bBrave\//i.test(globalThis.navigator?.userAgent || '');
}
function canUseWebAuthFlow(identity) {
  return typeof identity?.launchWebAuthFlow === 'function' && typeof identity?.getRedirectURL === 'function';
}
function isBraveIdentityFlowError(error) {
  return /invalid_request|custom uri scheme|chrome apps?/i.test(error?.message || String(error));
}
function parseOAuthCallback(callbackUrl) {
  const callback = new URL(callbackUrl);
  const fragment = new URLSearchParams(callback.hash.startsWith('#') ? callback.hash.slice(1) : callback.hash);
  const params = callback.searchParams;
  const error = fragment.get('error') || params.get('error');
  if (error) {
    const description = fragment.get('error_description') || params.get('error_description') || error;
    throw new Error('Google OAuth 授权失败：' + description);
  }
  return fragment.get('access_token') || params.get('access_token') || '';
}
async function getTokenViaBraveWebFlow(interactive = true) {
  const identity = identityApi();
  if (!canUseWebAuthFlow(identity)) throw new Error('Brave Web OAuth API 不可用（需要 launchWebAuthFlow 和 getRedirectURL）');
  const redirectUri = identity.getRedirectURL();
  const query = new URLSearchParams({
    client_id: BRAVE_WEB_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: BRAVE_OAUTH_SCOPES.join(' '),
    include_granted_scopes: 'true',
    prompt: interactive ? 'select_account' : 'none',
  });
  const callbackUrl = await identity.launchWebAuthFlow({
    url: 'https://accounts.google.com/o/oauth2/v2/auth?' + query.toString(),
    interactive,
  });
  if (!callbackUrl) throw new Error('Brave Web OAuth 未返回回调地址');
  const token = parseOAuthCallback(callbackUrl);
  if (!token) throw new Error('Brave Web OAuth 回调中没有 access token');
  return token;
}
function authFailureMessage(nativeError, fallbackError, extensionId, brave = false) {
  const nativeText = nativeError ? (nativeError.message || String(nativeError)) : '未执行 Chrome 原生认证';
  const fallbackText = fallbackError ? (fallbackError.message || String(fallbackError)) : '未执行 Brave Web OAuth';
  return (brave ? 'Brave Web OAuth 失败' : 'Google OAuth 失败') + '：Chrome 原生认证：' + nativeText + '；Web OAuth：' + fallbackText + '。请确认 Web OAuth Client 已允许回调地址 https://' + extensionId + '.chromiumapp.org/，且不要把 client secret 放进扩展。';
}
async function resolveAccountInfo(token) {
  const identity = identityApi();
  try {
    if (typeof identity.getProfileUserInfo === 'function') {
      const profile = await identity.getProfileUserInfo({ accountStatus: 'ANY' });
      if (profile?.email) return { email: profile.email, error: null };
    }
  } catch (error) {
    // Brave may expose the API but return no profile; continue with userinfo.
  }
  if (!token) return { email: '', error: 'Google 账号信息不可用：没有 OAuth token' };
  try {
    const response = await fetch(GOOGLE_USERINFO_API, { headers: { Authorization: 'Bearer ' + token } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error_description || body?.error?.message || ('HTTP ' + response.status));
    if (body?.email) return { email: body.email, error: null };
    throw new Error('userinfo 响应没有 email');
  } catch (error) {
    return { email: '', error: 'Google 账号邮箱读取失败：' + (error?.message || String(error)) };
  }
}
async function getTokenOnce(interactive) {
  const identity = identityApi();
  const brave = await isBraveBrowser();
  let result;
  if (brave) {
    try {
      result = await getTokenViaBraveWebFlow(interactive);
    } catch (error) {
      const extensionId = chrome.runtime?.id || '当前扩展 ID';
      throw new Error(authFailureMessage(null, error, extensionId, true));
    }
  } else if (typeof identity.getAuthToken !== 'function') {
    try {
      result = await getTokenViaBraveWebFlow(interactive);
    } catch (error) {
      const extensionId = chrome.runtime?.id || '当前扩展 ID';
      throw new Error(authFailureMessage(null, error, extensionId));
    }
  } else {
    try {
      result = await identity.getAuthToken({ interactive });
    } catch (error) {
      if (!canUseWebAuthFlow(identity)) throw error;
      try {
        result = await getTokenViaBraveWebFlow(interactive);
      } catch (fallbackError) {
        const extensionId = chrome.runtime?.id || '当前扩展 ID';
        throw new Error(authFailureMessage(error, fallbackError, extensionId));
      }
    }
  }
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('未获取到 Google OAuth Token');
  tokenCache = token;
  return token;
}

function startTokenRequest(interactive) {
  const request = { interactive, promise: null };
  request.promise = getTokenOnce(interactive);
  pendingTokenRequest = request;
  request.promise.then(
    () => { if (pendingTokenRequest === request) pendingTokenRequest = null; },
    () => { if (pendingTokenRequest === request) pendingTokenRequest = null; }
  );
  return request.promise;
}

function upgradeToInteractiveToken(silentRequest) {
  if (pendingInteractiveUpgrade) return pendingInteractiveUpgrade;
  pendingInteractiveUpgrade = silentRequest.then(
    (token) => token || startTokenRequest(true),
    () => startTokenRequest(true)
  );
  pendingInteractiveUpgrade.then(
    () => { pendingInteractiveUpgrade = null; },
    () => { pendingInteractiveUpgrade = null; }
  );
  return pendingInteractiveUpgrade;
}

async function getToken(interactive = true) {
  if (tokenCache) return tokenCache;
  if (pendingInteractiveUpgrade) return pendingInteractiveUpgrade;
  if (!pendingTokenRequest) return startTokenRequest(interactive);
  if (!interactive || pendingTokenRequest.interactive) return pendingTokenRequest.promise;
  return upgradeToInteractiveToken(pendingTokenRequest.promise);
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
  const token = await getToken(true);
  const account = await resolveAccountInfo(token);
  await saveCloudSettings({ googleAccountEmail: account.email || null });
  return { email: account.email || null, accountError: account.error || null };
}

export async function getConnectedAccount() {
  const data = await loadData();
  const settings = cloudSettings(data);
  if (settings.googleAccountEmail) return { email: settings.googleAccountEmail, error: null };
  if (!tokenCache) return null;
  const account = await resolveAccountInfo(tokenCache);
  if (account.email) await saveCloudSettings({ googleAccountEmail: account.email });
  return { email: account.email || null, error: account.error || null };
}

export async function signOutGoogle() {
  await clearToken();
  try { await chrome.identity?.clearAllCachedAuthTokens?.(); } catch {}
  const data = await loadData();
  const settings = cloudSettings(data);
  await updateSettings({ [CLOUD_SETTINGS]: { ...settings, googleAccountEmail: null, driveFileId: null, lastBackupAt: null, lastBackupSize: null, lastEncryptionMode: null, autoBackupEnabled: false } });
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
  if (response.status === 401) { await clearToken(); const retryToken = await getToken(interactive); response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + retryToken } }); }
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
  automaticBackupRunning = true;
  try {
    const key = await getOrCreateDeviceKey();
    const envelope = await encryptBackup(getCloudBackupPayload(data), { mode: 'device-key', key });
    const result = await uploadLatestBackup(envelope, { interactive: false, keepHistory: true, automatic: true });
    await saveCloudSettings({ autoBackupMode: 'device-key', lastAutoBackupAt: Date.now(), lastAutoBackupError: null });
    return { skipped: false, ...result };
  } catch (error) {
    await saveCloudSettings({ lastAutoBackupError: error?.message || String(error) }).catch(() => {});
    throw error;
  } finally {
    automaticBackupRunning = false;
  }
}

export async function getCloudBackupStatus() {
  const data = await loadData();
  const storedEmail = cloudSettings(data).googleAccountEmail || '';
  const storedAccount = storedEmail ? { email: storedEmail, error: null } : null;
  if (!storedAccount && !tokenCache) return { connected: false, account: null, file: null };
  try {
    const account = storedAccount || await getConnectedAccount();
    return {
      connected: true,
      account: account?.email ? { email: account.email } : null,
      accountError: account?.error || null,
      file: tokenCache ? await findLatestBackup(false) : null,
    };
  } catch (error) {
    return { connected: true, account: storedAccount, file: null, error: error.message };
  }
}
