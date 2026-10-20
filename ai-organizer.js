import { loadData, UNCATEGORIZED_ID, genId } from './js/store.js';
import { initI18n, getLocale } from './js/i18n.js';
import { aiText as tr } from './js/ai-launcher.js';
import { prepareItems, folderCatalog, snapshotItem, nextBatch, validateOutput } from './js/ai-model.js';
import { applyAiOrganization, undoAiOrganization, getAiUndoStatus, getAiConfirmations } from './js/ai-store.js';
import { contentFingerprint } from './js/ai-confirmation.js';
import { normalizeRedactionRules, containsRedactionPlaceholder } from './js/ai-redaction.js';
import { AI_TOPICS_KEY, normalizeTopicRules } from './js/ai-topics.js';
import { tagsOf, itemsByUrlKey } from './js/tag-model.js';
import { progressOf, beginProgressRun, beginProgressBatch, finishProgressBatch } from './js/ai-progress.js';

const TASK_KEY = 'pageclip_ai_task';
const app = document.getElementById('app');
let data, task, config, busy = false, cancelled = false, activeRequest = null, page = 0, filter = 'all', status = '', undoStatus, confirmations = {}, progressTimer = null;
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(x => x != null)); return node;
};
const btn = (text, action, disabled = false, primary = false) => el('button', { text, onclick: () => safely(action), disabled, className: primary ? 'primary' : '' });
const msg = async (type, extra = {}) => {
  const response = await chrome.runtime.sendMessage({ type, requestId: genId('ai'), ...extra });
  if (!response?.ok) throw new Error(response?.code || 'AI_REQUEST_FAILED');
  return response.result;
};
function errorText(error) {
  const code = String(error?.message || 'AI_ERROR');
  const messages = {
    AUTH: ['认证失败，请检查 API 密钥或网关授权。', 'Authentication failed. Check your API key or gateway authorization.'],
    BAD_REQUEST: ['模型或网关拒绝请求参数（400/422），请检查模型和接口兼容性。', 'Model or gateway rejected request parameters (400/422). Check model/API compatibility.'],
    JSON_MODE: ['模型不支持当前 JSON 输出模式，请切换模型后重试。', 'The model rejected JSON output mode. Switch models and retry.'],
    PROVIDER: ['网关或上游模型返回错误，请检查 Magpie 路由状态后重试。', 'Gateway or upstream model failed. Check Magpie routing and retry.'],
    NETWORK: ['无法连接 AI 网关，请确认网关已启动及网络正常。', 'Cannot reach the AI gateway. Check that it is running and reachable.'],
    TIMEOUT: ['AI 请求超时，请检查网关路由或换模型重试。', 'AI request timed out. Check gateway routing or try another model.'],
    RATE_LIMIT: ['模型当前限流或额度不足，请稍后重试或切换模型。', 'The model is rate limited. Retry later or change models.'],
    NOT_CONFIGURED: ['请先到 AI 设置保存服务地址、模型和密钥。', 'Save provider, model and key in AI settings first.'],
    AI_INVALID_JSON: ['模型未返回有效 JSON，请重试或切换模型。', 'The model did not return valid JSON. Retry or change models.'],
    AI_MISSING_ITEMS: ['模型结果缺少部分收藏，此批次未采用，请重试。', 'The model omitted some bookmarks. This batch was rejected; retry.'],
  };
  const safe = /^[A-Z][A-Z_]+$/.test(code) ? code : 'AI_ERROR';
  const message = messages[safe];
  return (message ? tr(...message) : tr('操作未完成，请检查配置或重试。', 'Operation did not complete. Check configuration or retry.')) + ` (${safe})`;
}
async function safely(action) { try { await action(); } catch (error) { status = errorText(error); } render(); }
async function persist() { if (task) await chrome.storage.session.set({ [TASK_KEY]: task }); }
function folderName(id) { return folderCatalog(data).find(f => f.id === id)?.path || tr('已删除分类', 'Deleted folder'); }
function selectedSource(scope) {
  const ids = new Set(task.launchIds || []);
  return data.items.filter(i => scope === 'all' || (scope === 'uncategorized' ? i.folderId === UNCATEGORIZED_ID : ids.has(i.id)));
}
function isConfirmed(item, index = itemsByUrlKey(data)) {
  const record = confirmations[item.id];
  return record?.version === 1 && record.fingerprint === contentFingerprint(item, tagsOf(data, item.url, index));
}
function sourceForAnalysis(source) {
  const index = itemsByUrlKey(data);
  return task.includeOrganized ? source : source.filter(item => !isConfirmed(item, index));
}
function effectiveSource(source) {
  const index = itemsByUrlKey(data);
  return source.map(item => ({ ...item, tags: tagsOf(data, item.url, index) }));
}
async function resetScope(scope) {
  task.id = genId('organization'); task.createdAt = Date.now();
  task.scope = scope; task.suggestions = []; task.newFolders = []; task.pending = []; task.failed = []; task.started = false; task.applied = false; task.before = {}; task.phase = 'idle';
  task.batchIndex = 0; task.activeBatchSize = 0; task.total = 0; task.requestStartedAt = null;
  delete task.redactionRules; delete task.topicRules; delete task.topicStats; delete task.requestPreview; delete task.redactionStats; delete task.result; delete task.previousResult;
  status = ''; page = 0;
  data = await loadData(); confirmations = await getAiConfirmations();
  await persist();
}
function checklist(label, checked, change, disabled = false) {
  return el('label', {}, el('input', { type: 'checkbox', checked, disabled, onchange: e => safely(() => change(e.target.checked)) }), label);
}
function folderSelect(value, change, allowNew = true) {
  const select = el('select', { 'aria-label': tr('目标分类', 'Target folder'), onchange: e => safely(() => change(e.target.value)), disabled: busy || task.applied });
  select.append(el('option', { value: '', text: tr('保持原分类', 'Keep current folder') }));
  for (const f of folderCatalog(data)) select.append(el('option', { value: f.id, text: f.path }));
  if (allowNew) for (const f of task.newFolders) select.append(el('option', { value: 'new:' + f.tempId, text: tr('新建：', 'New: ') + f.name }));
  select.value = value || ''; return select;
}
function changed(s) { return (s.acceptFolder && (s.targetFolderId || s.newFolderTempId)) || (s.acceptTags && s.addTags.length); }
function updateProgress() {
  if (!task) return;
  const p = progressOf(task);
  const states = {
    idle: tr('就绪', 'Ready'), analyzing: tr('分析中', 'Analyzing'), paused: tr('错误暂停，可恢复或重试', 'Paused after error; resume or retry'),
    cancelled: tr('已取消，结果已保留', 'Cancelled; results kept'), review: tr('分析完成待确认', 'Analysis complete; awaiting confirmation'),
    failed: tr('处理结束有失败；100% 不代表全部成功', 'Finished with failures; 100% does not mean all succeeded'), confirmed: tr('已确认', 'Confirmed')
  };
  const write = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };
  write('progress-state', states[p.state] || states.idle);
  write('progress-counts', `${tr('本轮总数', 'Total')} ${p.total} · ${tr('已处理', 'Processed')} ${p.processed} · ${tr('成功', 'Succeeded')} ${p.succeeded} · ${tr('失败', 'Failed')} ${p.failed} · ${tr('待处理', 'Pending')} ${p.pending} · ${Math.floor(p.percent * 10) / 10}%`);
  write('progress-timing', `${tr('当前批次', 'Current batch')} ${p.batchIndex} · ${tr('本批条数', 'Batch items')} ${p.batchSize} · ${tr('等待', 'Waiting')} ${p.waitSeconds}s · ${p.remainingSeconds == null ? tr('剩余时间待首批完成后估算', 'ETA available after a completed batch') : tr('预计剩余约 ', 'Estimated remaining about ') + p.remainingSeconds + 's'}`);
  const bar = document.getElementById('progress-bar'); if (bar) bar.value = p.percent;
}
function stopProgressTimer() { if (progressTimer !== null) clearInterval(progressTimer); progressTimer = null; }
function startProgressTimer() { stopProgressTimer(); progressTimer = setInterval(updateProgress, 1000); }
function render() {
  if (!data || !task) return;
  const active = document.activeElement;
  const editing = active?.id?.startsWith('reason-') ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  const source = selectedSource(task.scope); const prepared = prepareItems(effectiveSource(sourceForAnalysis(source)), task.includeNotes);
  app.replaceChildren(el('h1', { text: tr('AI 整理收藏', 'AI bookmark organizer') }));
  app.append(el('p', { className: 'muted', text: tr('建议先预览再应用。不移动 Chrome 原生书签；同网址的标签仍会共享。', 'Preview before applying. Chrome bookmark folders are not moved; tags remain shared by URL.') }));
  const scope = el('select', { disabled: busy || task.started, 'aria-label': tr('整理范围', 'Scope'), onchange: e => safely(() => resetScope(e.target.value)) },
    el('option', { value: 'launch', text: tr('选中项 / 打开时的列表', 'Selection / original list') }),
    el('option', { value: 'uncategorized', text: tr('未分类', 'Uncategorized') }), el('option', { value: 'all', text: tr('全部收藏', 'All collections') })); scope.value = task.scope;
  const setup = el('section', { className: 'panel' }, el('div', { className: 'row' }, scope, checklist(tr('包含备注（默认不发送）', 'Include notes (off by default)'), task.includeNotes, async value => { task.includeNotes = value; await persist(); }, busy || task.started)));
  setup.append(checklist(tr('包含已整理（主动重跑）', 'Include organized (run again)'), !!task.includeOrganized, async value => { task.includeOrganized = value; await persist(); }, busy || task.started));
  setup.append(el('p', { text: `${tr('范围内 / 可发送 / 隐私排除 / 已整理跳过：', 'In scope / eligible / privacy excluded / organized skipped: ')}${source.length} / ${prepared.eligible.length} / ${prepared.excluded.length} / ${source.length - sourceForAnalysis(source).length}` }));
  setup.append(el('p', { className: 'notice', text: tr('将发送标题、去除登录信息/查询参数/片段的网址、分类和标签给你配置的 AI 服务；可选发送备注。不抓取正文。路径和标题仍可能含个人信息。排除本地文件、IP 和内网主机。', 'Sends titles, URLs without credentials/query/fragment, folders and tags to your configured provider; notes are optional. No page fetching. Paths and titles may still contain personal information. Local files, IPs and intranet hosts are excluded.') }));
  setup.append(el('p', { text: config ? `${tr('服务：', 'Provider: ')}${config.baseUrl || '—'} · ${config.model || '—'}` : tr('无法读取 AI 配置', 'Could not load AI configuration') }));
  setup.append(el('div', { className: 'row' }, btn(tr('设置 AI 服务', 'AI settings'), () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })),
    btn(task.started ? tr('继续未完成批次', 'Resume pending batches') : tr('确认发送并分析', 'Confirm send & analyze'), start, busy || (task.applied && !task.pending.length) || !prepared.eligible.length || !config?.model || !config?.baseUrl || (task.started && !task.pending.length), true),
    btn(tr('重试失败批次', 'Retry failed batches'), async () => { task.pending.push(...task.failed.flatMap(f => f.items)); task.failed = []; await start(); }, busy || !task.failed.length),
    btn(tr('取消分析', 'Cancel analysis'), cancel, !busy), btn(tr('重新选择范围', 'Reset scope'), () => resetScope(task.scope), busy)));
  if (task.offeredLaunch) setup.append(btn(tr('使用新选择（替换当前预览）', 'Use new selection (replace preview)'), async () => {
    task.launchIds = task.offeredLaunch.ids; delete task.offeredLaunch; await resetScope('launch');
  }, busy));
  app.append(setup);
  app.append(el('section', { className: 'panel', id: 'progress-card', 'aria-label': tr('整理进度', 'Organization progress') },
    el('p', { id: 'progress-state', role: 'status', 'aria-live': 'polite' }),
    el('progress', { id: 'progress-bar', max: 100, value: 0, 'aria-label': tr('已处理百分比', 'Processed percentage') }),
    el('p', { id: 'progress-counts' }), el('p', { id: 'progress-timing', className: 'muted' })));
  updateProgress();
  if (task.requestPreview && (task.redactionRules?.enabled || task.topicRules?.enabled)) {
    app.append(el('details', { className: 'panel' }, el('summary', { text: task.redactionRules?.enabled ? tr('脱敏请求预览（最近一批）', 'Redacted request preview (latest batch)') : tr('主题类目化请求预览（最近一批）', 'Categorized request preview (latest batch)') }),
      ...(task.topicRules?.enabled ? [el('p', { text: `${tr('主题类目化条目 / 替换次数 / 字段：', 'Categorized bookmarks / replacements / fields: ')}${task.topicStats?.bookmarks || 0} / ${task.topicStats?.replacements || 0} / ${task.topicStats?.fields || 0}` })] : []),
      el('p', { text: `${tr('替换次数 / 命中字段：', 'Replacements / matched fields: ')}${task.redactionStats?.replacements || 0} / ${task.redactionStats?.fields || 0}` }),
      el('pre', { text: task.requestPreview })));
  }
  const hasFailures = task.failed.length > 0;
  app.append(el('p', { id: 'status', role: hasFailures ? 'alert' : 'status', className: hasFailures ? 'error-notice' : '', text: status || tr('就绪', 'Ready') }));
  if (hasFailures) app.append(el('section', { className: 'error-notice', role: 'alert' },
    el('strong', { text: `${tr('分析失败：', 'Analysis failed: ')}${task.failed.reduce((sum, f) => sum + f.items.length, 0)} ${tr('条收藏；失败批次未修改任何数据。', 'bookmarks; failed batches changed no data.')}` }),
    ...task.failed.slice(0, 5).map(f => el('p', { text: f.code })),
    btn(tr('查看全部失败批次', 'View all failed batches'), () => { filter = 'failed'; page = 0; }),
    btn(tr('重试失败批次', 'Retry failed batches'), async () => { task.pending.push(...task.failed.flatMap(f => f.items)); task.failed = []; await start(); }, busy)));

  if (task.applied) {
    const result = task.result || {};
    app.append(el('section', { className: 'panel' }, el('h2', { text: tr('整理完成摘要（只读）', 'Completed organization (read-only)') }),
      el('p', { text: `${tr('确认 / 移动 / 标签网址 / 跳过：', 'Confirmed / moved / tagged URLs / skipped: ')}${result.confirmed || 0} / ${result.moved || 0} / ${result.tagged || 0} / ${result.skipped || 0}` }),
      btn(tr('撤销上次整理（24小时内）', 'Undo last organization (24 hours)'), undo, busy || !undoStatus)));
    return;
  }
  if (task.previousResult) app.append(el('p', { className: 'muted', text: `${tr('上次已确认（只读摘要）：', 'Previously confirmed (read-only summary): ')}${task.previousResult.confirmed || 0}` }));
  if (task.newFolders.length) {
    const folders = el('section', { className: 'panel' }, el('h2', { text: tr('拟新建分类（仅实际使用时创建）', 'Proposed new folders (created only if used)') }));
    for (const f of task.newFolders) {
      const parent = el('select', { disabled: busy || task.applied, 'aria-label': tr('父分类', 'Parent folder'), onchange: e => safely(async () => { f.parentFolderId = e.target.value || null; await persist(); }) }, el('option', { value: '', text: tr('根目录', 'Root') }));
      for (const existing of folderCatalog(data).filter(x => !x.system)) parent.append(el('option', { value: existing.id, text: existing.path }));
      parent.value = f.parentFolderId || '';
      folders.append(el('div', { className: 'folder-edit' }, el('input', { type: 'text', value: f.name, maxLength: 50, disabled: busy || task.applied, 'aria-label': tr('新分类名称', 'New folder name'), onchange: e => safely(async () => { f.name = e.target.value.trim() || f.name; await persist(); }) }), parent));
    }
    app.append(folders);
  }
  const filters = el('select', { 'aria-label': tr('预览筛选', 'Preview filter'), onchange: e => { filter = e.target.value; page = 0; render(); } });
  for (const [value, zh, en] of [['all','全部','All'],['changed','待修改','Changes'],['same','保持不变','Unchanged'],['failed','失败','Failed']]) filters.append(el('option', { value, text: tr(zh,en) })); filters.value = filter;
  app.append(el('div', { className: 'row' }, el('h2', { text: tr('整理预览', 'Preview') }), filters));
  if (filter === 'failed') for (const failed of task.failed) app.append(el('p', { text: `${failed.items.length} · ${failed.code}` }));
  const list = filter === 'failed' ? [] : task.suggestions.filter(s => filter === 'all' || (filter === 'changed' ? changed(s) : !changed(s)));
  page = Math.max(0, Math.min(page, Math.ceil(list.length / 50) - 1));
  for (const s of list.slice(page * 50, page * 50 + 50)) {
    const item = data.items.find(i => i.id === s.itemId); const before = task.before[s.itemId];
    const card = el('article', {}, el('h3', { text: item?.title || before?.title || s.itemId }), el('p', { className: 'muted', text: folderName(before?.folderId) }));
    card.append(checklist(tr('确认此条已整理', 'Confirm this bookmark organized'), s.confirm !== false, async value => { s.confirm = value; await persist(); }, busy || task.applied));
    card.append(checklist(tr('明确保持原样', 'Explicitly keep unchanged'), !!s.keepOriginal, async value => { s.keepOriginal = value; if (value) { s.acceptFolder = false; s.acceptTags = false; } await persist(); }, busy || task.applied));
    card.append(el('div', { className: 'row' }, checklist(tr('调整分类', 'Move folder'), s.acceptFolder, async v => { s.acceptFolder = v; await persist(); }, busy || task.applied), folderSelect(s.newFolderTempId ? 'new:' + s.newFolderTempId : s.targetFolderId, async value => {
      s.targetFolderId = value && !value.startsWith('new:') ? value : null; s.newFolderTempId = value.startsWith('new:') ? value.slice(4) : null; s.acceptFolder = !!value; await persist();
    })));
    card.append(checklist(tr('补充标签', 'Add tags'), s.acceptTags, async v => { s.acceptTags = v; await persist(); }, busy || task.applied || !s.addTags.length));
    for (const tag of s.addTags) card.append(el('span', { className: 'tag' }, el('span', { text: (data.items.some(i => i.tags?.includes(tag)) ? '' : tr('新标签：', 'New tag: ')) + tag }), btn('×', async () => { s.addTags = s.addTags.filter(t => t !== tag); await persist(); }, busy || task.applied)));
    card.append(el('label', { className: 'reason-edit' }, tr('理由（可编辑）', 'Reason (editable)'), el('textarea', { id: 'reason-' + s.itemId, value: s.reason, maxLength: 200, disabled: task.applied, onchange: e => safely(async () => { s.reason = e.target.value; await persist(); }) })));
    if (s.limited || s.needsReview) card.append(el('p', { className: 'muted', text: tr('存在被上限跳过的建议，请人工确认。', 'Some suggestions exceeded limits. Please review manually.') }));
    app.append(card);
  }
  if (list.length) app.append(el('div', { className: 'row' }, btn(tr('上一页', 'Previous'), () => { page--; }, page === 0), el('span', { text: `${page + 1} / ${Math.ceil(list.length / 50)}` }), btn(tr('下一页', 'Next'), () => { page++; }, (page + 1) * 50 >= list.length)));
  const moving = task.suggestions.filter(s => s.acceptFolder && (s.newFolderTempId || s.targetFolderId && s.targetFolderId !== task.before[s.itemId]?.folderId));
  const tagging = task.suggestions.filter(s => s.acceptTags && s.addTags.length);
  const newUsed = new Set(moving.map(s => s.newFolderTempId).filter(Boolean));
  app.append(el('section', { className: 'panel' }, el('p', { text: `${tr('移动 / 新分类 / 标签网址：', 'Moves / new folders / tagged URLs: ')}${moving.length} / ${newUsed.size} / ${new Set(tagging.map(s => task.before[s.itemId]?.url)).size}. ${tr('未完成：', 'Unfinished: ')}${task.pending.length + task.failed.reduce((n,f) => n + f.items.length,0)}` }),
    el('div', { className: 'row' }, btn(tr('确认整理并应用所选修改', 'Confirm organization & apply selected changes'), apply, busy || task.applied || !task.suggestions.some(s => s.confirm !== false || (!s.keepOriginal && changed(s))), true), btn(tr('撤销上次整理（24小时内）', 'Undo last organization (24 hours)'), undo, busy || !undoStatus))));
  if (editing) {
    const restored = document.getElementById(editing.id);
    if (restored) { restored.value = editing.value; restored.focus({ preventScroll: true }); restored.setSelectionRange(editing.start, editing.end); }
  }
}
async function start() {
  await navigator.locks.request('pageclip-ai-run', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('AI_BUSY');
    data = await loadData(); config = await msg('ai-config-status'); confirmations = await getAiConfirmations();
    if (task.applied) {
      // Retry remaining entries under a fresh transaction, preserving the old
      // analysis snapshots and frozen privacy rules without replaying successes.
      task.previousResult = task.result; delete task.result;
      task.id = genId('organization'); task.applied = false; task.suggestions = []; task.newFolders = [];
      task.total = new Set([...task.pending, ...task.failed.flatMap(f => f.items)].map(i => i.itemId)).size;
    }
    if (!task.started) {
      const source = effectiveSource(sourceForAnalysis(selectedSource(task.scope)));
      const prepared = prepareItems(source, task.includeNotes);
      task.pending = prepared.eligible; task.before = Object.fromEntries(source.map(i => [i.id, snapshotItem(i)]));
      task.total = task.pending.length; task.started = true;
      const local = await chrome.storage.local.get(['pageclip_ai_redaction', AI_TOPICS_KEY]);
      task.redactionRules = normalizeRedactionRules(local.pageclip_ai_redaction || { enabled: false, words: [] });
      task.topicRules = normalizeTopicRules(local[AI_TOPICS_KEY]);
    }
    // Historic tasks did not freeze rules; never apply newly enabled rules to them.
    task.redactionRules ||= { enabled: false, words: [] };
    task.topicRules ||= { version: 1, enabled: false };
    busy = true; cancelled = false; task.phase = 'analyzing'; beginProgressRun(task); startProgressTimer();
    try {
      while (task.pending.length && !cancelled) {
        // Recheck confirmations before every new send, including a resumed historic queue.
        data = await loadData(); confirmations = await getAiConfirmations();
        if (!task.includeOrganized) {
          const index = itemsByUrlKey(data);
          const skipped = task.pending.filter(p => { const item = data.items.find(i => i.id === p.itemId); return item && isConfirmed(item, index); });
          if (skipped.length) {
            const ids = new Set(skipped.map(p => p.itemId)); task.pending = task.pending.filter(p => !ids.has(p.itemId)); task.total = Math.max(0, task.total - skipped.length);
          }
          if (!task.pending.length) break;
        }
        const { batch, body, redaction, topics, sentCandidates } = nextBatch(task.pending, folderCatalog(data), [...new Set(data.items.flatMap(i => i.tags || []).concat(Object.values(data.urlTags || {}).flat()))], task.newFolders, getLocale(), task.redactionRules, task.topicRules);
        beginProgressBatch(task, batch.length);
        task.redactionStats = redaction; task.topicStats = topics; task.requestPreview = task.redactionRules.enabled || task.topicRules.enabled ? body.messages[1].content : null;
        activeRequest = genId('request'); await persist();
        status = tr('正在分析；剩余 ', 'Analyzing; remaining ') + task.pending.length; render();
        try {
          const response = await chrome.runtime.sendMessage({ type: 'ai-analyze', requestId: activeRequest, body });
          if (cancelled) break;
          if (!response?.ok) throw new Error(response?.code || 'AI_REQUEST_FAILED');
          const result = validateOutput(response.result.content, batch, data, task.newFolders, sentCandidates);
          task.newFolders = result.newFolders; task.suggestions.push(...result.suggestions.map(s => ({ ...s, confirm: true })));
        } catch (error) {
          if (cancelled) break;
          task.failed.push({ items: batch, code: errorText(error) });
          task.pending.splice(0, batch.length); finishProgressBatch(task, batch.length); await persist();
          if (/AUTH|CONFIG|KEY|CONTEXT|PROVIDER|FORBIDDEN|REQUEST_TOO_LARGE|BAD_REQUEST|JSON_MODE|TIMEOUT|NETWORK|RATE_LIMIT/.test(error.message)) throw error;
          continue;
        } finally { activeRequest = null; }
        task.pending.splice(0, batch.length); finishProgressBatch(task, batch.length); await persist();
      }
      task.phase = cancelled ? 'cancelled' : task.failed.length ? 'failed' : 'review';
      status = cancelled ? tr('已取消，已完成结果保留。', 'Cancelled. Completed results kept.') : task.failed.length ? tr('分析结束，但有失败批次。请查看下方错误并重试；成功建议可单独应用。', 'Analysis finished with failed batches. Review errors and retry; successful suggestions can be applied separately.') : tr('分析完成，请预览。', 'Analysis complete. Review suggestions.');
    } catch (error) { task.phase = cancelled ? 'cancelled' : task.pending.length ? 'paused' : 'failed'; throw error; }
    finally { busy = false; activeRequest = null; task.requestStartedAt = null; stopProgressTimer(); await persist(); render(); }
  });
}
async function cancel() { cancelled = true; if (activeRequest) await msg('ai-cancel', { targetRequestId: activeRequest }); }
async function apply() {
  const selected = task.suggestions.filter(s => s.confirm !== false || (!s.keepOriginal && changed(s)));
  for (const s of selected) {
    const newFolder = task.newFolders.find(f => f.tempId === s.newFolderTempId);
    const blocked = containsRedactionPlaceholder(s.reason) || (s.acceptTags && s.addTags.some(containsRedactionPlaceholder)) || (s.acceptFolder && newFolder && containsRedactionPlaceholder(newFolder.name));
    if (blocked && !s.keepOriginal) { status = tr('建议包含脱敏占位符，请人工修正，或明确选择保持原样后再确认。', 'A suggestion contains redaction placeholders. Edit it or explicitly keep the bookmark unchanged before confirming.'); return; }
  }
  const usedFolders = new Set(selected.filter(s => !s.keepOriginal && s.acceptFolder).map(s => s.newFolderTempId));
  const plan = { operationId: task.id, newFolders: task.newFolders.filter(f => usedFolders.has(f.tempId)), items: selected.map(s => ({ id: s.itemId, before: task.before[s.itemId], confirm: s.confirm !== false, ...(!s.keepOriginal ? { reason: s.reason.replace(/[\r\n\t]/g, ' ') } : {}), ...(!s.keepOriginal && s.acceptFolder && s.targetFolderId ? { targetFolderId: s.targetFolderId } : {}), ...(!s.keepOriginal && s.acceptFolder && s.newFolderTempId ? { newFolderTempId: s.newFolderTempId } : {}), addTags: !s.keepOriginal && s.acceptTags ? s.addTags : [] })) };
  busy = true; render();
  try {
    const result = await applyAiOrganization(plan); task.applied = true; task.phase = 'confirmed'; task.result = result; await persist(); data = await loadData(); confirmations = await getAiConfirmations(); undoStatus = await getAiUndoStatus();
    status = tr('应用完成（冲突项会跳过）：', 'Applied (conflicts skipped): ') + `${tr('已确认', 'Confirmed')} ${result.confirmed}; ${tr('移动', 'Moved')} ${result.moved}; ${tr('标签网址', 'Tagged URLs')} ${result.tagged}; ${tr('新分类', 'New folders')} ${result.createdFolders}; ${tr('跳过', 'Skipped')} ${result.skipped}`;
  } finally { busy = false; }
}
async function undo() { const result = await undoAiOrganization(undoStatus.operationId); data = await loadData(); confirmations = await getAiConfirmations(); undoStatus = await getAiUndoStatus(); status = tr('撤销结果：', 'Undo result: ') + JSON.stringify(result); }
window.addEventListener('pagehide', () => { cancelled = true; stopProgressTimer(); if (activeRequest) chrome.runtime.sendMessage({ type: 'ai-cancel', requestId: genId('cancel'), targetRequestId: activeRequest }).catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pageclip_ai_config) safely(async () => { config = await msg('ai-config-status'); });
  if (area === 'session' && changes.pageclip_ai_launch?.newValue && task) safely(async () => {
    task.offeredLaunch = changes.pageclip_ai_launch.newValue;
    status = tr('收到新的选择范围。完成或取消当前操作后，点击“使用新选择”切换。', 'A new selection is available. Finish or cancel the current operation, then choose Use new selection.');
    await persist();
  });
});
async function init() {
  await initI18n({ root: document }); data = await loadData();
  const saved = await chrome.storage.session.get([TASK_KEY, 'pageclip_ai_launch']);
  task = saved[TASK_KEY];
  if (task && saved.pageclip_ai_launch?.createdAt > (task.createdAt || 0)) task.offeredLaunch = saved.pageclip_ai_launch;
  if (!task) {
    task = { id: genId('organization'), createdAt: Date.now(), launchIds: saved.pageclip_ai_launch?.ids || [], scope: 'launch', includeNotes: false, started: false, applied: false, pending: [], failed: [], suggestions: [], newFolders: [], before: {} }; await persist();
  }
  try { config = await msg('ai-config-status'); } catch { config = null; }
  confirmations = await getAiConfirmations();
  if (task.phase === 'analyzing') task.phase = 'cancelled';
  task.requestStartedAt = null;
  undoStatus = await getAiUndoStatus(); render();
}
init().catch(error => { app.textContent = errorText(error); });
