import { GOOGLE_WORKER_ORIGIN } from './google-worker-config.js';
// This panel only talks to the worker; it never reads or handles credentials.
import { GOOGLE_AUTH_POLICY } from './google-auth-policy.js';
const panel = document.getElementById('sync-settings');

if (panel) {
  for (const id of ['sync-oauth-client', 'sync-auth-save']) {
    const element = document.getElementById(id);
    if (element) element.hidden = !!GOOGLE_WORKER_ORIGIN || !GOOGLE_AUTH_POLICY.desktopExperiment;
  }
  const configLabel = document.querySelector('label[for="sync-oauth-client"]');
  if (configLabel) configLabel.hidden = !!GOOGLE_WORKER_ORIGIN || !GOOGLE_AUTH_POLICY.desktopExperiment;
  const statusView = document.getElementById('sync-status');
  const feedback = document.getElementById('sync-feedback');
  const conflictView = document.getElementById('sync-conflicts');
  const connect = document.getElementById('sync-connect');
  const pause = document.getElementById('sync-pause');
  const run = document.getElementById('sync-run');
  const exportButton = document.getElementById('sync-export');
  document.getElementById('sync-auth-save')?.addEventListener('click', async () => {
    const clientId = document.getElementById('sync-oauth-client').value.trim();
    try { await request('configure-auth', { clientId }); notice('PKCE 客户端已保存；请点击连接／重新授权。'); }
    catch (error) { notice(error.message, true); }
  });
  let status = null;
  let busy = false;
  let reading = false;
  let refreshRequested = false;
  let fresh = false;
  let timer = null;
  let conflictSignature = null;

  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = String(value ?? '—');
    if (className) node.className = className;
    return node;
  }

  function time(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleString();
  }

  function notice(message, error = false) {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.style.color = error ? 'var(--danger)' : '';
  }

  async function request(action, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'cloud-sync', action, ...extra });
    if (!response?.ok) throw new Error(response?.message || '同步服务未返回成功结果，请稍后重试。');
    if (!response.status || typeof response.status !== 'object') {
      throw new Error('同步服务未返回有效状态。');
    }
    return response.status;
  }

  function updateControls() {
    connect.disabled = busy || reading || panel.dataset.connected !== 'true' || !!status?.enabled;
    pause.disabled = busy || reading || !fresh || !status?.enabled;
    run.disabled = busy || reading || !fresh || !status?.enabled || !!status?.running;
    exportButton.disabled = busy || !fresh || !status?.conflicts?.length;
    connect.textContent = status?.enabled ? '双向同步已启用' : '启用双向同步';
    conflictView.querySelectorAll('button').forEach((button) => {
      button.disabled = busy || reading || !fresh || !!status?.running;
    });
    panel.setAttribute('aria-busy', String(busy));
  }

  function render() {
    const state = status.running ? '同步进行中' : status.enabled ? '同步已启用' : '同步已暂停／尚未启用';
    statusView.replaceChildren(
      text('strong', `远端同步：${state}`),
      text('span', `最近成功：${time(status.lastSuccessAt)}（不代表之后的本地更改均已同步）`, 'desc'),
      text('span', `待同步：${status.pending ?? '未知'} · 冲突：${status.conflicts?.length ?? 0}`, 'desc'),
      text('span', `下次尝试：${status.enabled ? time(status.nextAttemptAt) : '已暂停'}`, 'desc')
    );
    if (status.lastError) {
      statusView.append(text('span', `最近错误：${status.lastError} · 类型：${status.errorKind || '未知'}。如授权失效，请重新授权。`, 'desc'));
    }
    const conflicts = Array.isArray(status.conflicts) ? status.conflicts : [];
    const signature = JSON.stringify(conflicts);
    // Preserve expanded details and keyboard focus during unchanged polling.
    if (signature !== conflictSignature) {
      conflictSignature = signature;
      conflictView.replaceChildren(text('strong', conflicts.length ? '冲突版本：请逐项明确选择，不会自动覆盖' : '当前没有待处理冲突'));
      for (const conflict of conflicts) {
        const group = text('section', '', 'cloud-status');
        group.append(text('strong', `冲突项：${conflict.key}`));
        for (const version of conflict.versions || []) {
          const details = document.createElement('details');
          details.open = true;
          details.append(text('summary', `版本 ${version.id} · 设备 ${version.device ?? '未知'} · ${time(version.modifiedAt)}`));
          const value = text('pre', JSON.stringify(version.value, null, 2) ?? '（无值）');
          value.style.whiteSpace = 'pre-wrap';
          value.style.overflowWrap = 'anywhere';
          value.style.maxHeight = '320px';
          value.style.overflow = 'auto';
          const choose = text('button', '选择此版本');
          choose.type = 'button';
          choose.addEventListener('click', () => {
            if (busy || reading || !fresh || status?.running) return;
            if (!window.confirm(`确认为“${conflict.key}”选择版本“${version.id}”（设备 ${version.device ?? '未知'}）？\n所有未选中的版本仍保留在审计历史中，不会被删除。`)) return;
            void perform('resolve', { key: conflict.key, revision: version.id });
          });
          details.append(value, choose);
          group.append(details);
        }
        conflictView.append(group);
      }
    }
    updateControls();
  }

  async function refresh() {
    if (document.hidden) return;
    if (busy || reading) {
      refreshRequested = true;
      return;
    }
    reading = true;
    updateControls();
    try {
      status = await request('status');
      fresh = true;
      render();
    } catch (error) {
      fresh = false;
      statusView.replaceChildren(text('strong', '远端同步状态未知（读取失败）；不能据此认为已同步。'), text('span', error.message || '读取失败', 'desc'));
    } finally {
      reading = false;
      updateControls();
      flushRefresh();
    }
  }

  function flushRefresh() {
    if (!refreshRequested || busy || reading) return;
    refreshRequested = false;
    if (!document.hidden) void refresh();
  }

  async function perform(action, extra) {
    if (busy || reading) return;
    busy = true;
    notice('正在请求同步服务…');
    updateControls();
    try {
      status = await request(action, extra);
      fresh = true;
      render();
      notice(action === 'disconnect' ? '已暂停同步；待同步操作和凭据保留。' : action === 'resolve' ? '已提交版本选择，请查看远端同步进度。' : '请求已受理，请以下方状态为准；不代表所有更改均已上传。');
    } catch (error) {
      fresh = false;
      notice(error.message || '同步请求失败，请重试。', true);
    } finally {
      busy = false;
      updateControls();
      refreshRequested = true;
      flushRefresh();
    }
  }

  connect.addEventListener('click', () => {
    if (panel.dataset.connected !== 'true') return;
    if (!window.confirm('启用后将合并当前设备与云端的数据。\n如果这是另一台设备，请先在上方导入同一份已有恢复密钥。确认启用双向同步？')) return;
    void perform('connect');
  });
  pause.addEventListener('click', () => void perform('disconnect'));
  run.addEventListener('click', () => void perform('run'));
  exportButton.addEventListener('click', () => {
    if (!fresh || !status?.conflicts?.length) return;
    if (!window.confirm('导出的冲突 JSON 是未加密的，可能含有网址、备注等私人数据。确认导出并妥善保管？')) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), conflicts: status.conflicts }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PageClip-sync-conflicts-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function visibilityChanged() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (!document.hidden) {
      void refresh();
      timer = setInterval(() => void refresh(), 5000);
    }
  }
  function storageChanged(changes, area) {
    // Inspect key names only; never inspect or log credential-bearing values.
    if (area === 'local' && ['bc_data', 'pageclipWorkerAuth', 'pageclipGoogleAuth'].some(key => Object.hasOwn(changes, key)) && !document.hidden) void refresh();
  }
  window.addEventListener('pageclip-cloud-status', updateControls);
  window.addEventListener('focus', () => { if (!document.hidden) void refresh(); });
  document.addEventListener('visibilitychange', visibilityChanged);
  chrome.storage.onChanged.addListener(storageChanged);
  window.addEventListener('online', () => {
    if (fresh && status?.enabled && (!status.errorKind || status.errorKind === 'retry')) {
      chrome.runtime.sendMessage({ type: 'cloud-sync', action: 'network-restored' }).catch(() => {});
    }
  });
  visibilityChanged();
}
