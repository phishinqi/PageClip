// MV3 orchestration: only durable storage is authoritative; no timer owns work.
import { workerAuthConfigured, workerAuthDiagnostics, requestWorkerSyncActivation, clearWorkerSyncActivation } from './google-worker-auth.js';
import { pkceDiagnostics } from './google-pkce.js';
import { loadData, withDataLock, saveData } from './store.js';
import { capture, ingest, stateOf, resolveConflict, clone, validateOperation } from './sync-model.js';
import { DriveSyncAdapter } from './sync-drive.js';
import { connectGoogle } from './cloud-backup.js';
import { getAuthenticatedAccount, createSyncSession, pkceConfiguration, completeWorkerAuthorization } from './google-auth.js';
import { encryptBackup, decryptBackup, getOrCreateDeviceKey } from './crypto-backup.js';

export const SYNC_ALARM = 'pageclip-causal-sync';
export const SYNC_RETRY_ALARM = 'pageclip-causal-sync-retry';
let running = null;
async function transaction(fn) {
  return withDataLock(async () => {
    const data = await loadData();
    const result = await fn(data, stateOf(data));
    await saveData(data);
    return result;
  });
}
async function keyFingerprint() {
  const key = await getOrCreateDeviceKey();
  const raw = await crypto.subtle.exportKey('raw', key);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function adapter(accountEmail) {
  return new DriveSyncAdapter({
    ...createSyncSession(accountEmail),
    encode: async (op) => encryptBackup({ schema: 3, folders: [], items: [], syncOperation: op }, { mode: 'device-key', key: await getOrCreateDeviceKey() }),
    decode: async (envelope) => (await decryptBackup(envelope, { key: await getOrCreateDeviceKey() })).syncOperation,
  });
}
export async function syncStatus() {
  const data = await loadData(), state = stateOf(data);
  return {
    authentication: workerAuthConfigured() ? { ...(await workerAuthDiagnostics()), method: 'worker' } : await pkceDiagnostics(),
    enabled: state.enabled, running: !!running, lastSuccessAt: state.lastSuccessAt || null,
    lastError: state.lastError || null, errorKind: state.errorKind || null,
    nextAttemptAt: state.nextAttemptAt || null, pending: state.outbox.length,
    conflicts: Object.entries(state.conflicts).map(([key, ids]) => ({ key, versions: ids.map(id => clone(state.ops[id])) })),
  };
}
export async function configureSync() {
  if (!chrome.alarms?.create) return;
  const state = stateOf(await loadData());
  if (!state.enabled) {
    await chrome.alarms.clear(SYNC_ALARM);
    await chrome.alarms.clear(SYNC_RETRY_ALARM);
    return;
  }
  // Periodic calibration also discovers remote-only edits and repairs lost alarms.
  chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  await chrome.alarms.clear(SYNC_RETRY_ALARM);
  if (state.nextAttemptAt) chrome.alarms.create(SYNC_RETRY_ALARM, { when: Math.max(Date.now() + 1000, state.nextAttemptAt) });
}
export async function scheduleSync() {
  const state = stateOf(await loadData());
  if (!state.enabled || state.errorKind && state.errorKind !== 'retry') return;
  const alarm = await chrome.alarms?.get?.(SYNC_RETRY_ALARM);
  if (alarm) return; // Never postpone an existing wakeup under continuous edits.
  chrome.alarms?.create?.(SYNC_RETRY_ALARM, { when: Math.max(Date.now() + 10000, state.nextAttemptAt || 0) });
}
export async function runSync({ manual = false, storageAdapter = null } = {}) {
  if (running) return running;
  running = (async () => {
    if (!(await loadData())._sync?.enabled) return { skipped: true };
    let state = await transaction((data) => clone(capture(data)));
    if (!state.enabled) return { skipped: true };
    if (!manual && ((state.errorKind && state.errorKind !== 'retry') || state.nextAttemptAt > Date.now())) return { skipped: true };
    const remote = storageAdapter || adapter(state.account);
    try {
      await remote.initialize({ interactive: false });
      if (!storageAdapter) {
        const fingerprint = await keyFingerprint();
        if (state.keyVerified && state.keyFingerprint && fingerprint !== state.keyFingerprint) throw Object.assign(new Error('Key changed'), { kind: 'format' });
        await transaction((_data, current) => { current.keyFingerprint = fingerprint; });
      }
      const entries = await remote.list();
      let incoming = [];
      // Bounded batches, not unbounded Promise.all. Immutable entries are cached
      // only after full validation + local commit, never before downloading them.
      const known = state.files || {};
      for (let i = 0; i < entries.length; i += 4) {
        const batch = entries.slice(i, i + 4).filter(e => !known[e.id] && !state.downloads?.[e.id]);
        if (!batch.length) continue;
        const downloaded = await Promise.all(batch.map(e => remote.read(e)));
        downloaded.forEach(validateOperation);
        await transaction((_data, current) => {
          current.downloads ||= {};
          batch.forEach((e, n) => { current.downloads[e.id] = downloaded[n]; });
        });
      }
      await transaction((data, current) => {
        incoming = Object.values(current.downloads || {});
        ingest(data, incoming);
        current.downloads = {};
        if (!storageAdapter) current.keyVerified = true;
        current.files ||= {};
        entries.forEach(e => { current.files[e.id] = true; });
      });
      state = stateOf(await loadData());
      // Parents are published first, so an interrupted batch is recoverable.
      // Each acknowledgement is an independent durable commit.
      let acknowledgements = [];
      const checkpoint = async () => {
        if (!acknowledgements.length) return;
        const batch = acknowledgements;
        await transaction((_data, current) => {
          const completed = new Set(batch.map(v => v.id));
          current.outbox = current.outbox.filter(id => !completed.has(id));
          batch.forEach(v => { (current.files ||= {})[v.entry.id] = true; });
        });
        acknowledgements = [];
      };
      for (const id of [...state.outbox].sort((a, b) => state.ops[a].sequence - state.ops[b].sequence).slice(0, 100)) {
        if (!stateOf(await loadData()).enabled) break;
        const entry = await remote.append(state.ops[id], { entries });
        entries.push(entry);
        acknowledgements.push({ id, entry });
        if (acknowledgements.length >= 20) await checkpoint();
      }
      await checkpoint();
      // A concurrent remote writer may appear on the next periodic calibration;
      // success means this observed snapshot and all captured uploads committed.
      await transaction((_data, current) => {
        current.failures = 0; current.nextAttemptAt = null; current.lastError = null; current.errorKind = null;
        if (!current.outbox.length && !Object.keys(current.conflicts).length) current.lastSuccessAt = Date.now();
      });
      if (stateOf(await loadData()).outbox.length) await scheduleSync();
      return { ok: true };
    } catch (error) {
      const kind = ['auth', 'permission', 'format', 'retry'].includes(error.kind) ? error.kind : 'retry';
      await transaction((_data, current) => {
        current.failures = Math.min((current.failures || 0) + 1, 20);
        current.errorKind = kind;
        // Do not persist provider response bodies or decrypted business data.
        current.lastError = ['native_unavailable', 'desktop_client_required', 'client_type'].includes(error.code) ? '请配置 Google Desktop app Client ID，使用无 secret 的 PKCE 授权；核对客户端类型和回调能力。' : { auth: '需要重新授权 Google Drive', permission: 'Google Drive 权限不足', format: '同步数据或密钥不兼容，已停止自动同步；本地数据保留', retry: '网络或云服务暂不可用，将退避重试' }[kind];
        const delay = Math.min(6 * 60 * 60 * 1000, 30000 * 2 ** Math.min(current.failures - 1, 10));
        current.nextAttemptAt = kind === 'retry' ? Date.now() + Math.max(Number(error.retryAfter) || 0, delay * (0.5 + Math.random() * 0.5)) : null;
      });
      await configureSync();
      return { ok: false, kind };
    }
  })();
  try { return await running; } finally { running = null; }
}
export async function handleSyncMessage(message) {
  try {
    if (message.action === 'configure-auth') {
      await pkceConfiguration(message.clientId);
    } else if (message.action === 'connect' || message.action === 'complete-auth') {
      if (message.action === 'connect') {
        await requestWorkerSyncActivation();
        await connectGoogle();
      }
      else await completeWorkerAuthorization();
      const account = await getAuthenticatedAccount();
      if (!account.email) throw new Error('无法验证账号身份');
      const fingerprint = await keyFingerprint();
      await transaction((_data, state) => {
        if (state.account && account.email && state.account !== account.email) throw new Error('同步已绑定另一 Google 账号；请使用原账号，避免混合同步空间');
        if (state.keyVerified && state.keyFingerprint && state.keyFingerprint !== fingerprint) throw new Error('恢复密钥与同步空间不一致');
        if (!state.keyVerified && state.keyFingerprint !== fingerprint) { state.downloads = {}; state.files = {}; }
        state.keyFingerprint = fingerprint;
        state.account ||= account.email || null;
        state.enabled = true; state.errorKind = null; state.lastError = null; state.nextAttemptAt = null;
      });
      await configureSync();
      await runSync({ manual: true });
      await clearWorkerSyncActivation();
    } else if (message.action === 'authorized') {
      const data = await loadData();
      if (data._sync?.enabled) {
        const account = await getAuthenticatedAccount();
        if (account.email !== data._sync.account) throw new Error('Account mismatch');
        await transaction((_data, state) => {
          if (state.errorKind === 'auth' || state.errorKind === 'permission') {
            state.errorKind = null; state.lastError = null; state.nextAttemptAt = null;
          }
        });
        await configureSync();
        await runSync();
      }
    } else if (message.action === 'disconnect') {
      await clearWorkerSyncActivation();
      await transaction((_data, state) => { state.enabled = false; });
      await configureSync();
    } else if (message.action === 'run') {
      await runSync({ manual: true });
    } else if (message.action === 'network-restored') {
      await runSync(); // Honors Retry-After/backoff, never bypasses rate limits.
    } else if (message.action === 'resolve') {
      await transaction((data) => resolveConflict(data, message.key, message.revision));
      await scheduleSync();
    } else if (message.action !== 'status') throw new Error('未知同步操作');
    return { ok: true, status: await syncStatus() };
  } catch (error) {
    if (message.action === 'connect' && error?.code !== 'authorization_pending') await clearWorkerSyncActivation();
    return { ok: false, message: error?.name === 'GoogleAuthError' ? error.message : '同步操作失败：请检查 Google 账号、恢复密钥和同步状态；本地数据未删除。' };
  }
}
