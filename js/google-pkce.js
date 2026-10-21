// Google Desktop public-client PKCE. No secret and no third-party OAuth server.
// Firefox intercepts its documented mozoauth2 loopback. Chromium tab interception
// needs real-browser acceptance testing; never claim launchWebAuthFlow accepts it.
import { GOOGLE_AUTH_POLICY } from './google-auth-policy.js';
const KEY = 'pageclipGooglePkce';
const CONFIG = 'pageclipGoogleOAuthConfig';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid https://www.googleapis.com/auth/userinfo.email';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
let inflight = null;
const local = () => chrome.storage.local;
const identity = () => globalThis.browser?.identity || chrome.identity;
const fail = (kind, code, message, retryAfter = null) => Object.assign(new Error(message), { name: 'GoogleAuthError', kind, code, retryAfter });
async function read() { await local().setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); return (await local().get(KEY))[KEY] || {}; }
async function write(state) { await local().set({ [KEY]: state }); }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function pkceConfiguration(clientId = null) {
  await local().setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (clientId !== null) {
    if (!GOOGLE_AUTH_POLICY.desktopExperiment) throw fail('auth', 'release_unsupported', 'Desktop 授权实验未通过发布验收，正式版不接受用户自行配置 OAuth 客户端');
    clientId = clientId.trim();
    if (!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw fail('auth', 'configuration', '请输入 Google Desktop app 类型的公开 Client ID；不要输入 client secret');
    const prior = (await local().get(CONFIG))[CONFIG];
    if (prior?.clientId && prior.clientId !== clientId && (await read()).refreshToken) throw fail('auth', 'configuration', '请先断开 Google 授权，再更换 Desktop Client ID');
    await local().set({ [CONFIG]: { clientId, clientType: 'desktop' } });
  }
  return (await local().get(CONFIG))[CONFIG] || null;
}
export function desktopRedirect() {
  const firefox = /Firefox\//i.test(globalThis.navigator?.userAgent || '');
  if (firefox) {
    const url = new URL(identity().getRedirectURL());
    return { uri: 'http://127.0.0.1/mozoauth2/' + url.hostname.split('.')[0], transport: 'identity' };
  }
  return { uri: 'http://127.0.0.1:43821/pageclip/oauth2', transport: 'tab' };
}
async function tokenRequest(fields) {
  let response;
  try { response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(20000) }); }
  catch { throw fail('retry', 'token_transport', 'Google 令牌服务暂不可用'); }
  let body; try { body = await response.json(); } catch { throw fail('retry', 'token_response', 'Google 令牌响应无效'); }
  if (!response.ok) {
    const raw = response.headers?.get('Retry-After');
    const delay = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - Date.now())) : null;
    if (response.status === 429 || response.status >= 500 || response.status === 408) throw fail('retry', 'token_transport', 'Google 令牌服务暂不可用', delay);
    if (body?.error === 'invalid_grant') throw fail('auth', 'invalid_grant', 'Google 授权已失效，请重新授权');
    if (['invalid_client', 'unauthorized_client'].includes(body?.error)) throw fail('auth', 'client_type', 'Google 不接受此公开客户端。请核对 Desktop app 类型；不可用 Web client secret 绕过');
    // Classify known descriptions locally; never persist or expose response text.
    if (body?.error === 'invalid_request') {
      if (/client[_ ]secret/i.test(body.error_description || '')) throw fail('auth', 'client_secret_required', 'Google 要求此客户端提供 client secret；当前无 secret 方案不成立，已停止，不能将 secret 放入扩展');
      if (/redirect[_ ]uri/i.test(body.error_description || '')) throw fail('auth', 'redirect_rejected', 'Google 拒绝换码 redirect_uri，请检查客户端类型及回调格式');
      if (/code[_ ]verifier|code[_ ]challenge|pkce/i.test(body.error_description || '')) throw fail('auth', 'pkce_rejected', 'Google 拒绝 PKCE 参数');
      throw fail('auth', 'invalid_request', 'Google 认为换码请求参数不符合要求');
    }
    if (body?.error === 'invalid_scope') throw fail('permission', 'scope', 'Google 拒绝请求的权限范围');
    throw fail('auth', 'token_rejected', 'Google 拒绝令牌交换，请检查客户端类型和授权配置');
  }
  if (typeof body.access_token !== 'string' || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0 || body.token_type?.toLowerCase() !== 'bearer') throw fail('auth', 'token_incomplete', 'Google 返回不完整令牌信息，请重新授权');
  if (body.scope && !['https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/userinfo.email'].every(s => body.scope.split(' ').includes(s) || s.endsWith('userinfo.email') && body.scope.split(' ').includes('email'))) throw fail('permission', 'scope', 'Google 未授予必要的 Drive 和邮箱权限');
  return body;
}
function tokens(body, previous = {}) {
  return { ...previous, accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000,
    refreshToken: body.refresh_token || previous.refreshToken || null,
    refreshExpiresAt: body.refresh_token_expires_in ? Date.now() + Number(body.refresh_token_expires_in) * 1000 : previous.refreshExpiresAt || null,
    pending: null, error: null };
}
export async function clearPkceToken(rejected = null) {
  const state = await read();
  if (!rejected || state.accessToken === rejected) { delete state.accessToken; state.expiresAt = null; await write(state); }
}
export async function disconnectPkce() { await local().remove(KEY); }
export async function acceptPkceCallback(callbackUrl, tabId = null) {
  const state = await read(), pending = state.pending;
  if (!pending || pending.expiresAt < Date.now()) return false;
  if (pending.transport === 'tab' && tabId !== pending.tabId) return false;
  let callback; try { callback = new URL(callbackUrl); } catch { return false; }
  const expected = new URL(pending.redirectUri);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.username || callback.password) return false;
  if (callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== pending.state) return false;
  if (callback.searchParams.get('error')) {
    await write({ ...state, pending: null, error: 'authorization_denied' });
    return false;
  }
  const code = callback.searchParams.get('code');
  if (!code || callback.searchParams.getAll('code').length !== 1) return false;
  // Error-page tab.url is chrome-error://chromewebdata/, not the callback.
  // Persist before any network request so a terminated worker can resume exchange.
  await write({ ...state, pending: { ...pending, callbackUrl } });
  const complete = async () => {
    const latest = await read();
    if (latest.pending?.state !== pending.state) return;
    try {
      const body = await tokenRequest({ client_id: pending.clientId, code, code_verifier: pending.verifier, grant_type: 'authorization_code', redirect_uri: pending.redirectUri });
      if ((await read()).pending?.state !== pending.state) return;
      await write(tokens(body));
    } catch (error) {
      if ((await read()).pending?.state === pending.state) {
        // A response may have been lost after Google consumed a one-use code.
        // Retry transient failures once on later recovery; invalid_grant requires reauthorization.
        await write({ ...latest, pending: error.kind === 'retry' ? latest.pending : null, error: error.code, errorKind: error.kind });
      }
    }
  };
  if (navigator.locks?.request) await navigator.locks.request('pageclip-google-pkce-exchange', complete); else await complete();
  const success = !!(await read()).accessToken;
  if (success && pending.transport === 'tab') await chrome.tabs.remove(tabId).catch(() => {});
  return success;
}
// Deliberately expose only booleans and allowlisted codes, never credentials/URLs.
export async function pkceDiagnostics() {
  const state = await read();
  const codes = ['authorization_denied', 'authorization_cancelled', 'invalid_grant', 'client_type', 'token_rejected', 'token_incomplete', 'token_transport', 'token_response', 'scope', 'client_secret_required', 'redirect_rejected', 'pkce_rejected', 'invalid_request'];
  return {
    configured: !!(await pkceConfiguration())?.clientId,
    phase: state.accessToken ? 'token-received' : state.pending?.callbackUrl ? 'callback-received' : state.pending ? 'awaiting-callback' : state.error ? 'failed' : 'not-started',
    hasRefreshToken: !!state.refreshToken,
    expiresAt: state.expiresAt || null,
    errorCode: codes.includes(state.error) ? state.error : state.error ? 'unknown' : null,
  };
}
export async function cancelPkceTab(tabId) {
  const state = await read();
  if (state.pending?.tabId === tabId && !state.pending.callbackUrl) {
    await write({ ...state, pending: null, error: 'authorization_cancelled', errorKind: 'auth' });
  }
}
export async function recoverPkceCallback() {
  const state = await read();
  if (state.pending?.callbackUrl) return acceptPkceCallback(state.pending.callbackUrl, state.pending.tabId);
  if (state.pending?.transport !== 'tab' || state.pending.tabId == null) return;
  const tab = await chrome.tabs.get(state.pending.tabId).catch(() => null);
  if (tab?.url) return acceptPkceCallback(tab.url, tab.id);
  if (!tab) await cancelPkceTab(state.pending.tabId);
}
async function authorize(config) {
  const redirect = desktopRedirect();
  if (redirect.transport === 'identity' && !identity()?.launchWebAuthFlow) throw fail('auth', 'callback_unavailable', '此浏览器缺少 Firefox loopback identity API');
  if (redirect.transport === 'tab' && !chrome.tabs?.onUpdated) throw fail('auth', 'callback_unavailable', '此浏览器缺少 OAuth 标签页回调能力');
  const verifier = random(), state = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const pending = { state, verifier, clientId: config.clientId, redirectUri: redirect.uri, transport: redirect.transport, expiresAt: Date.now() + 10 * 60 * 1000 };
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect.uri, response_type: 'code', scope: SCOPES,
    state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + query;
  if (redirect.transport === 'identity') {
    await write({ pending });
    let callback;
    try { callback = await identity().launchWebAuthFlow({ url, interactive: true }); }
    catch { await write({ error: 'authorization_denied' }); throw fail('auth', 'authorization_denied', 'Google 授权未完成，请重试'); }
    if (!await acceptPkceCallback(callback)) throw fail('auth', 'callback_invalid', 'Google 回调校验失败');
  } else {
    // Save identity before navigation. Background listener survives options closure.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    pending.tabId = tab.id;
    await write({ pending });
    await chrome.tabs.update(tab.id, { url });
    throw fail('auth', 'authorization_pending', 'Google 授权页已打开。完成后后台将验证账号并恢复同步；请勿关闭授权标签页');
  }
  while (true) {
    const current = await read();
    if (current.accessToken) return current.accessToken;
    if (!current.pending || Date.now() >= pending.expiresAt) throw fail(current.errorKind || 'auth', current.error || 'authorization_timeout', 'Google 授权未完成；请检查回调及 Desktop 客户端设置后重新授权');
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}
async function acquire(interactive) {
  if (!GOOGLE_AUTH_POLICY.desktopExperiment) throw fail('auth', 'release_unsupported', '当前浏览器的 Google Drive 授权尚无通过验收的发布方案；本地数据和待同步任务保留');
  const config = await pkceConfiguration();
  if (!config?.clientId) throw fail('auth', 'desktop_client_required', '原生 Google 认证不可用。请在设置中配置自己的 Google Desktop app Client ID，使用无 secret 的 PKCE 授权；不要填入 Web 客户端 ID');
  let state = await read();
  if (state.error === 'client_secret_required') throw fail('auth', 'client_secret_required', '此 Desktop 客户端已实测要求 client_secret，当前无 secret 路径已停止。重新登录不会解决；请勿在对话、源码或扩展包中提供密钥');
  if (state.accessToken && state.expiresAt > Date.now() + 60000) return state.accessToken;
  if (state.refreshToken && (!state.refreshExpiresAt || state.refreshExpiresAt > Date.now())) {
    try {
      const body = await tokenRequest({ client_id: config.clientId, grant_type: 'refresh_token', refresh_token: state.refreshToken });
      if ((await read()).refreshToken !== state.refreshToken) throw fail('auth', 'disconnected', '授权已断开');
      const next = tokens(body, state); await write(next); return next.accessToken;
    } catch (error) {
      if (error.kind !== 'auth') throw error;
      if (error.code === 'invalid_grant') { await write({ error: 'invalid_grant' }); state = {}; }
      if (!interactive) throw error;
    }
  }
  if (interactive) return authorize(config);
  throw fail('auth', 'reauthorize', 'Google 授权需重新连接，待同步任务已保留');
}
export async function getPkceToken(interactive = false) {
  if (inflight) return inflight;
  const work = () => acquire(interactive);
  inflight = navigator.locks?.request ? navigator.locks.request('pageclip-google-pkce', work) : work();
  try { return await inflight; } finally { inflight = null; }
}
