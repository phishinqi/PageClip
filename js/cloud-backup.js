// Google Drive appDataFolder：只保存加密后的 PageClip 密文包。
import { loadData, updateSettings } from './store.js';

export const BACKUP_FILE_NAME = 'PageClip-latest.enc';
export const BACKUP_MIME = 'application/octet-stream';
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
async function getToken(interactive = true) {
  if (tokenCache) return tokenCache;
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
