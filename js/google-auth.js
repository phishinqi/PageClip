// Public extension client: Chrome owns bearer expiry and renewal. No client secret,
// implicit redirect, refresh-token emulation, or application-owned permanent cache.
import { loadData } from './store.js';
import { workerAuthConfigured, getWorkerToken, clearWorkerToken, disconnectWorkerAuth } from './google-worker-auth.js';
import { getPkceToken, clearPkceToken, disconnectPkce, pkceConfiguration } from './google-pkce.js';
export { pkceConfiguration } from './google-pkce.js';

const STATUS_KEY = 'pageclipGoogleAuth';
const LEGACY_KEYS = ['pageclipBraveAccessToken', 'pageclipWebAccessToken'];
const SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'https://www.googleapis.com/auth/userinfo.email'];
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
let pending = null;
let upgrade = null;
let lastToken = null; // Only for rejected-token eviction; never used as a token cache.
let generation = 0;

export class GoogleAuthError extends Error {
  constructor(kind, code, message, retryAfter = null) {
    super(message); this.name = 'GoogleAuthError'; this.kind = kind;
    this.code = code; this.retryAfter = retryAfter;
  }
}
function failure(kind, code) {
  const messages = { retry: 'Google 认证服务暂不可用，请稍后重试', auth: 'Google 授权需要重新连接',
    permission: 'Google Drive 授权权限不足', unsupported: '原生 Google 授权不可用，请配置 Desktop app Client ID 使用 PKCE 替代授权' };
  return new GoogleAuthError(kind === 'unsupported' ? 'auth' : kind, code, messages[kind]);
}
async function prepare() {
  // Never silently downgrade credential protection, including during migration.
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.remove(LEGACY_KEYS);
}
export async function authenticationStatus() {
  await prepare();
  const state = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY];
  return state?.version === 1 ? state : { version: 1, method: 'native', status: 'unknown', expiresAt: null, expiryManagedBy: 'browser' };
}
async function record(status, code = null) {
  const previous = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY];
  const epoch = status === 'disconnected' ? String(Date.now()) + ':' + Math.random() : previous?.epoch || 'initial';
  await chrome.storage.local.set({ [STATUS_KEY]: { version: 1, epoch, method: workerAuthConfigured() ? 'worker' : (await pkceConfiguration())?.clientId ? 'desktop-pkce' : 'native', status, code,
    updatedAt: Date.now(), expiresAt: null, expiryManagedBy: 'browser' } });
}
function classify(error) {
  if (error instanceof GoogleAuthError || error?.name === 'GoogleAuthError' && ['auth', 'retry', 'permission'].includes(error.kind)) return error;
  // Raw browser/provider text is inspected only; it is never persisted or shown.
  const message = String(error?.message || '');
  if (/network|offline|connection|timeout|timed out|temporar|server_error|service unavailable|fetch failed/i.test(message)) return failure('retry', 'transport');
  if (/429|rate.?limit|too many/i.test(message)) return new GoogleAuthError('retry', 'rate_limited', 'Google 认证请求限流，请稍后重试', 60000);
  if (/insufficient.scope|permission/i.test(message)) return failure('permission', 'scope');
  if (/turned off browser sign|browser sign.?in.*disabled|not supported|not implemented|custom uri scheme|invalid_request/i.test(message)) return failure('unsupported', 'native_unavailable');
  return failure('auth', 'reauthorize');
}
async function supportedIdentity() {
  const nav = globalThis.navigator;
  let brave = false;
  try { brave = !!(await nav?.brave?.isBrave?.()); } catch {}
  // API presence on a Chromium fork is not evidence of Google identity support.
  if (brave || /Brave|Firefox|Edg\/|OPR\//i.test(nav?.userAgent || '') ||
      nav?.userAgentData?.brands?.some(v => /Brave|Microsoft Edge|Opera/i.test(v.brand)) ||
      typeof chrome.identity?.getAuthToken !== 'function') throw failure('unsupported', 'native_unavailable');
  return chrome.identity;
}
async function persistFailure(error) {
  if (error.code === 'disconnected' || (await authenticationStatus()).status === 'disconnected') return;
  await record(error.code === 'native_unavailable' ? 'unsupported' : error.kind === 'retry' ? 'retry' : error.kind === 'permission' ? 'permission' : 'reauthorize', error.code);
}
async function acquire(interactive, started, epoch) {
  await prepare();
  if (started !== generation) throw failure('auth', 'disconnected');
  try {
    let identity = null;
    try { identity = await supportedIdentity(); } catch (error) { if (error.code !== 'native_unavailable') throw error; }
    const state = await authenticationStatus();
    if ((state.epoch || 'initial') !== epoch) throw failure('auth', 'disconnected');
    if (!interactive && (state.status === 'disconnected' || !workerAuthConfigured() && !(await pkceConfiguration())?.clientId && ['reauthorize', 'permission', 'unsupported'].includes(state.status))) {
      throw failure(state.status === 'permission' ? 'permission' : 'auth', state.code || 'reauthorize');
    }
    let result;
    if (workerAuthConfigured()) result = { token: await getWorkerToken(interactive) };
    else if ((await pkceConfiguration())?.clientId || !identity) result = { token: await getPkceToken(interactive) };
    else {
      try { result = await identity.getAuthToken({ interactive, scopes: SCOPES }); }
      catch (error) {
        if (classify(error).code !== 'native_unavailable') throw error;
        result = { token: await getPkceToken(interactive) };
      }
    }
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) throw failure('auth', 'empty_token');
    if (Array.isArray(result?.grantedScopes) && SCOPES.some(scope => !result.grantedScopes.includes(scope))) {
      await identity?.removeCachedAuthToken?.({ token });
      throw failure('permission', 'scope');
    }
    if (started !== generation || (await authenticationStatus()).status === 'disconnected' && !interactive) {
      await identity?.removeCachedAuthToken?.({ token });
      throw failure('auth', 'disconnected');
    }
    lastToken = token;
    // Native API reports no expiry. Do not invent one or cache forever in JS.
    await record('ready');
    return token;
  } catch (error) {
    const classified = classify(error);
    if (started === generation && classified.code !== 'disconnected') await persistFailure(classified);
    throw classified;
  }
}
function start(interactive) {
  const started = generation;
  const request = { interactive, promise: null };
  request.promise = (async () => {
    const epoch = (await authenticationStatus()).epoch || 'initial';
    return globalThis.navigator?.locks?.request
      ? navigator.locks.request('pageclip-google-auth', () => acquire(interactive, started, epoch))
      : acquire(interactive, started, epoch);
  })();
  pending = request;
  request.promise.then(() => { if (pending === request) pending = null; }, () => { if (pending === request) pending = null; });
  return request.promise;
}
export async function completeWorkerAuthorization() {
  if (!workerAuthConfigured()) return;
  const token = await getWorkerToken(false);
  // Broker redemption is an explicit user-authorized continuation, not a silent login.
  await record('ready');
  try { await getAuthenticatedAccount(token); }
  catch (error) { await persistFailure(classify(error)); throw error; }
}
export async function getToken(interactive = false) {
  if (upgrade) return upgrade;
  if (!pending) return start(interactive);
  if (!interactive || pending.interactive) return pending.promise;
  // Only an explicit user action may upgrade a failed silent acquisition.
  const started = generation;
  upgrade = pending.promise.catch(error => {
    if (started !== generation || error.code === 'disconnected' || error.kind !== 'auth') throw error;
    return start(true);
  });
  upgrade.then(() => { upgrade = null; }, () => { upgrade = null; });
  return upgrade;
}
export async function clearToken(rejectedToken = lastToken) {
  if (workerAuthConfigured()) await clearWorkerToken(rejectedToken);
  await clearPkceToken(rejectedToken);
  if (rejectedToken && chrome.identity?.removeCachedAuthToken) {
    try { await chrome.identity.removeCachedAuthToken({ token: rejectedToken }); }
    catch { throw failure('retry', 'eviction_failed'); }
  }
  if (lastToken === rejectedToken) lastToken = null;
}
export async function disconnectAuthentication() {
  generation++;
  const disconnect = async () => {
    await prepare();
    if (workerAuthConfigured()) {
      try { await disconnectWorkerAuth(); } catch { /* durable revocation alarm owns retry */ }
    }
    await disconnectPkce();
    await record('disconnected', 'disconnected');
    try { await clearToken(); } catch {} // Local disconnect must not depend on provider availability.
    try { await chrome.identity?.clearAllCachedAuthTokens?.(); } catch {}
  };
  if (globalThis.navigator?.locks?.request) await navigator.locks.request('pageclip-google-auth', disconnect);
  else await disconnect();
}
function retryAfter(response) {
  const value = response.headers?.get('Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || null;
}
async function verifyAccount(token) {

    const response = await fetch(USERINFO, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (response.status === 401) throw failure('auth', 'userinfo_unauthorized');
      if (response.status === 429 || response.status === 408 || response.status >= 500) throw new GoogleAuthError('retry', 'userinfo_transport', 'Google 账号验证暂不可用', retryAfter(response));
      throw failure('permission', 'userinfo_permission');
    }
    const body = await response.json();
    if (typeof body?.email !== 'string' || !body.email || body.email_verified === false) throw failure('auth', 'account_unverified');
    const bound = (await loadData())._sync?.account;
    if (bound && bound !== body.email) throw failure('auth', 'account_mismatch');
    if ((await authenticationStatus()).status === 'disconnected') throw failure('auth', 'disconnected');
    return { email: body.email, error: null };
}
async function verifiedTokenAccount(token = null) {
  token ||= await getToken(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { token, account: await verifyAccount(token) }; }
    catch (error) {
      if (error.code === 'userinfo_unauthorized' && attempt === 0) {
        await clearToken(token);
        token = await getToken(false);
        continue;
      }
      throw error;
    }
  }
}
export async function getAuthenticatedAccount(token = null) {
  try { return (await verifiedTokenAccount(token)).account; }
  catch (error) {
    const classified = error instanceof GoogleAuthError ? error : failure('retry', 'userinfo_transport');
    await persistFailure(classified);
    throw classified;
  }
}
// Sync sees only a verified session interface, never browser-specific OAuth logic.
export function createSyncSession(accountEmail) {
  let verifiedToken = null;
  return {
    clearToken: async (token) => { verifiedToken = null; await clearToken(token); },
    getToken: async () => {
      if (!accountEmail) throw failure('auth', 'account_unbound');
      let token = await getToken(false);
      if (token !== verifiedToken) {
        try {
          const verified = await verifiedTokenAccount(token);
          if (verified.account.email !== accountEmail) throw failure('auth', 'account_mismatch');
          token = verified.token;
          verifiedToken = token;
        } catch (error) {
          const classified = error instanceof GoogleAuthError ? error : failure('retry', 'userinfo_transport');
          await persistFailure(classified);
          throw classified;
        }
      }
      return token;
    },
  };
}
