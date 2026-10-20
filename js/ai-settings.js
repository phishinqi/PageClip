// Options-only AI settings. Never read the persisted API key into this page.
// Keep these labels local: the main locale catalogs are shared with content pages.
import { MAGPIE_BASE_URL, gatewayDefaultKey } from './ai-defaults.js';
import { AI_REDACTION_KEY, normalizeRedactionRules } from './ai-redaction.js';
import { AI_TOPICS_KEY, normalizeTopicRules } from './ai-topics.js';
const labels = {
  topicsTitle: ['Local topic categorization', '本地主题类目化'],
  topicsEnabled: ['Send neutral topic categories and structured hints', '发送中性主题类目和结构化提示'],
  topicsHint: ['Off by default. In software, game, binary or network contexts, topic phrases become neutral categories while platforms, product names and resource types remain in the title. Ordinary expressions such as reverse thinking stay unchanged. Only the outgoing copy changes; privacy word redaction runs afterwards. New tasks freeze these local rules. Review the request preview before applying results.', '默认关闭。在软件、游戏、二进制或网络语境中，将主题表述归一为中性类目，保留标题中的平台、产品名和资源类型；“逆向思维”等普通表达不改。仅修改发送副本，随后仍执行隐私词表脱敏。新任务冻结本地规则，请预览请求和建议后再应用。'],
  topicsSave: ['Apply local topic setting', '保存本地主题设置'],
  topicsSaved: ['Topic setting saved locally. Existing tasks keep their frozen rules.', '主题设置已保存到本机；已有任务继续使用冻结的规则。'],
  topicsFailed: ['Could not read or save the local topic setting. Retry.', '无法读取或保存本地主题设置，请重试。'],
  topicsRetry: ['Reload topic setting', '重新读取主题设置'],
  redactionTitle: ['Local AI redaction', 'AI 本地脱敏'],
  redactionEnabled: ['Redact matching text before sending to AI', '发送至 AI 前脱敏匹配内容'],
  redactionWords: ['Redaction words (one per line)', '脱敏词（每行一个）'],
  redactionHint: ['Rules stay only in this browser, separate from provider settings and backups. Literal matches ignore English letter case; longer words match first. Maximum 500 unique words, 100 characters each. Matching URLs are replaced entirely. A task freezes its rules when analysis starts; edits apply to new tasks.', '规则仅保存在当前浏览器，与服务商设置和备份分开。按字面匹配，忽略英文字母大小写，优先匹配长词；最多 500 个去重词，每词最多 100 字符。网址命中时整条替换。任务在分析开始时冻结规则，修改仅对新任务生效。'],
  redactionSave: ['Apply local redaction rules', '保存本地脱敏规则'],
  redactionSaved: ['Redaction rules saved locally. Existing tasks keep their frozen rules.', '脱敏规则已保存到本机；已有任务继续使用冻结的规则。'],
  redactionLoading: ['Loading local redaction rules…', '正在读取本地脱敏规则…'],
  redactionLoadFailed: ['Could not load local redaction rules. Retry before editing.', '无法读取本地脱敏规则，请重试后再编辑。'],
  redactionSaveFailed: ['Could not save local redaction rules. Retry.', '无法保存本地脱敏规则，请重试。'],
  redactionTooMany: ['Use at most 500 unique words. No rules were saved.', '去重后最多 500 个词；本次规则未保存。'],
  redactionTooLong: ['Each word must be at most 100 characters. No rules were saved.', '每个词最多 100 字符；本次规则未保存。'],
  redactionInvalid: ['Invalid redaction rules. Use one word per line. No rules were saved.', '脱敏规则无效，请每行填写一个词；本次规则未保存。'],
  fetchModels: ['Fetch available models', '获取可用模型'],
  chooseModel: ['Choose a model (or enter manually below)', '选择模型（也可在下方手动填写）'],
  modelCount: ['Available models: ', '可用模型数：'],
  magpieHint: ['Defaults to the local Magpie gateway. Its placeholder token is used when the key is blank; other providers require your own key. Fetching models uses the current URL and sends no bookmarks.', '默认使用本机 Magpie 网关；密钥留空时使用网关占位值，其他服务商需填写自己的密钥。获取模型使用当前地址，不发送书签。'],
  section: ['AI settings', 'AI 设置'],
  title: ['AI provider (optional)', 'AI 服务商（可选）'],
  hint: ['Use your own OpenAI-compatible provider. AI is opt-in; saving settings does not send bookmarks.', '使用自选的 OpenAI 兼容服务商。AI 需主动使用；保存设置不会发送书签。'],
  baseUrl: ['Base URL (API root, including /v1)', 'Base URL（API 根地址，包含 /v1）'],
  model: ['Model', '模型'],
  apiKey: ['API key (optional; blank preserves saved key)', 'API 密钥（可选；留空保留已存密钥）'],
  keyPlaceholder: ['Enter a key only to add or replace it', '仅在添加或更换密钥时输入'],
  save: ['Save AI settings', '保存 AI 设置'],
  test: ['Test saved connection', '测试已保存的连接'],
  clear: ['Clear saved API key', '清除已存 API 密钥'],
  retry: ['Retry loading settings', '重新读取设置'],
  loading: ['Loading AI settings…', '正在读取 AI 设置…'],
  busy: ['Working…', '正在处理…'],
  hasKey: ['An API key is saved locally. Its value is never displayed.', '已在本机保存 API 密钥，不会显示其内容。'],
  noKey: ['No API key is saved.', '尚未保存 API 密钥。'],
  saved: ['AI settings saved locally.', 'AI 设置已保存到本机。'],
  cleared: ['Saved API key cleared.', '已清除本机保存的 API 密钥。'],
  tested: ['Connection test succeeded.', '连接测试成功。'],
  failed: ['AI request failed. Check your provider URL, model, key and network, then retry.', 'AI 请求失败，请检查服务地址、模型、密钥及网络后重试。'],
  loadFailed: ['Could not load AI settings. Retry before editing.', '无法读取 AI 设置，请重试后再编辑。'],
  required: ['Enter an API root URL and model.', '请填写 API 根地址和模型。'],
  unsaved: ['Save changes before testing. The test uses only saved settings.', '请先保存修改再测试；测试仅使用已保存的设置。'],
  privacy: ['When you explicitly use AI, bookmark metadata (such as titles, URLs and existing labels) is sent to the provider you select; labels are shared by URL across PageClip collections and Chrome bookmarks. Review your provider’s privacy policy before using AI.', '主动使用 AI 时，书签元数据（如标题、网址和已有标签）会发送给你选择的服务商；标签按网址在 PageClip 收藏和 Chrome 书签间共享。使用前请了解服务商的隐私政策。'],
  localKey: ['Saving a key opts into persistent local storage in this browser (pageclip_ai_config), separate from PageClip data. It is not included in exports or cloud backups, is not synced, and is not an encrypted secret vault. Clear it here when no longer needed.', '保存密钥即选择将其持久保存在当前浏览器本机（pageclip_ai_config），与 PageClip 数据分开。不包含在导出或云备份中，不同步，也不是加密密钥保险库。不再使用时可在此清除。'],
  testHint: ['The test sends a tiny request to your saved provider, may incur a small charge, and sends no bookmarks. Save changes first; testing is manual only.', '测试向已保存的服务商发送一个极小请求，可能产生少量费用，不发送任何书签。请先保存修改；仅点击测试时执行。'],
};

export function aiText(key) {
  return labels[key][document.documentElement.lang.toLowerCase().startsWith('en') ? 0 : 1];
}

export function createAISettingsCard({ h, card, actions, button }) {
  const baseUrl = h('input', { type: 'url', placeholder: MAGPIE_BASE_URL, autocomplete: 'off', spellcheck: 'false', required: true });
  const model = h('input', { type: 'text', placeholder: 'model-id', autocomplete: 'off', spellcheck: 'false', required: true });
  const apiKey = h('input', { type: 'password', placeholder: aiText('keyPlaceholder'), autocomplete: 'new-password', spellcheck: 'false' });
  const modelSelect = h('select', { class: 'ai-model-select', 'aria-label': aiText('chooseModel') }, h('option', { value: '', text: aiText('chooseModel') }));
  modelSelect.id = 'ai-model-picker';
  modelSelect.addEventListener('change', () => { if (modelSelect.value) model.value = modelSelect.value; });
  const resetModels = () => { modelSelect.replaceChildren(h('option', { value: '', text: aiText('chooseModel') })); };
  baseUrl.addEventListener('input', resetModels);
  apiKey.addEventListener('input', resetModels);
  const keyStatus = h('p', { class: 'desc' });
  const status = h('p', { class: 'desc', role: 'status', 'aria-live': 'polite', text: aiText('loading') });
  let loaded = false;
  let hasKey = false;
  let saved = { baseUrl: '', model: '' };
  const field = (key, input) => h('label', { class: 'form-field' }, h('span', { class: 'form-label', text: aiText(key) }), input);
  const request = async (type, payload = {}) => {
    const response = await chrome.runtime.sendMessage({ type, requestId: globalThis.crypto.randomUUID(), ...payload });
    if (!response?.ok) throw new Error(response?.code || 'AI_REQUEST_FAILED');
    return response.result;
  };
  const updateKeyStatus = () => { keyStatus.textContent = aiText(hasKey ? 'hasKey' : 'noKey'); };
  const save = button(aiText('save'), 'primary', () => run(async () => {
    const config = { baseUrl: baseUrl.value.trim(), model: model.value.trim() };
    if (!config.baseUrl || !config.model) { status.textContent = aiText('required'); return; }
    if (!baseUrl.reportValidity()) return;
    if (apiKey.value.trim()) config.apiKey = apiKey.value.trim();
    await request('ai-config-save', { config });
    hasKey = !!(config.apiKey || gatewayDefaultKey(config.baseUrl) || hasKey);
    apiKey.value = '';
    saved = { baseUrl: config.baseUrl, model: config.model };
    baseUrl.value = saved.baseUrl;
    model.value = saved.model;
    updateKeyStatus();
    status.textContent = aiText('saved');
  }));
  const test = button(aiText('test'), '', () => run(async () => {
    if (baseUrl.value.trim() !== saved.baseUrl || model.value.trim() !== saved.model || apiKey.value) {
      status.textContent = aiText('unsaved'); return;
    }
    await request('ai-test');
    status.textContent = aiText('tested');
  }));
  const clear = button(aiText('clear'), 'danger', () => run(async () => {
    await request('ai-config-clear-key');
    apiKey.value = '';
    hasKey = false;
    updateKeyStatus();
    status.textContent = aiText('cleared');
  }));
  const fetchModels = button(aiText('fetchModels'), '', () => run(async () => {
    if (!baseUrl.reportValidity()) return;
    const payload = { baseUrl: baseUrl.value.trim() };
    if (apiKey.value.trim()) payload.apiKey = apiKey.value.trim();
    const result = await request('ai-models', payload);
    resetModels();
    for (const id of result.models) modelSelect.append(h('option', { value: id, text: id }));
    if (result.models.includes(model.value)) modelSelect.value = model.value;
    status.textContent = aiText('modelCount') + result.models.length;
  }));
  const retry = button(aiText('retry'), '', () => load());
  const controls = [baseUrl, model, modelSelect, apiKey, fetchModels, save, test, clear];
  const setBusy = (busy) => {
    for (const control of controls) control.disabled = busy || !loaded;
    clear.disabled = busy || !loaded || !hasKey;
    retry.disabled = busy;
  };
  async function run(operation) {
    setBusy(true);
    status.classList.remove('ai-status-error'); status.setAttribute('role', 'status');
    status.textContent = aiText('busy');
    try { await operation(); }
    catch (error) {
      const errors = {
        AUTH: ['Authentication failed. Check the API key or gateway authorization.', '认证失败，请检查 API 密钥或网关授权。'],
        NETWORK: ['Cannot connect. Check that Magpie is running.', '无法连接网关，请确认 Magpie 已启动。'],
        TIMEOUT: ['Request timed out. Check gateway routing or change models.', '请求超时，请检查网关路由或切换模型。'],
        BAD_REQUEST: ['Model rejected request parameters (400/422). Check API compatibility.', '模型拒绝请求参数（400/422），请检查接口兼容性。'],
        RATE_LIMIT: ['Rate limited. Retry later or select another model.', '模型限流，请稍后重试或换模型。'],
        PROVIDER: ['Gateway/upstream failed. Check Magpie routing status.', '网关或上游模型失败，请查看 Magpie 路由状态。'],
      };
      const safeCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'AI_REQUEST_FAILED';
      status.textContent = (errors[safeCode]?.[document.documentElement.lang.startsWith('en') ? 0 : 1] || aiText('failed')) + ` (${safeCode})`;
      status.classList.add('ai-status-error'); status.setAttribute('role', 'alert');
    }
    finally { setBusy(false); }
  }
  async function load() {
    setBusy(true);
    status.textContent = aiText('loading');
    try {
      const config = await request('ai-config-status');
      // Whitelist public status fields. Never assign a returned key to the DOM.
      saved = { baseUrl: String(config?.baseUrl || MAGPIE_BASE_URL), model: String(config?.model || '') };
      baseUrl.value = saved.baseUrl;
      model.value = saved.model;
      hasKey = config?.hasKey === true;
      loaded = true;
      updateKeyStatus();
      status.textContent = '';
      retry.hidden = true;
    } catch { status.textContent = aiText('loadFailed'); retry.hidden = false; }
    finally { setBusy(false); }
  }
  const body = h('div', { class: 'cloud-form' },
    h('p', { class: 'desc', text: aiText('privacy') }),
    h('p', { class: 'desc', text: aiText('localKey') }),
    h('p', { class: 'desc', text: aiText('magpieHint') }),
    field('baseUrl', baseUrl), field('apiKey', apiKey), keyStatus,
    h('div', { class: 'form-field' },
      h('label', { class: 'form-label', for: 'ai-model-picker', text: aiText('chooseModel') }),
      h('div', { class: 'ai-model-picker' }, modelSelect, fetchModels)),
    field('model', model),
    actions(save, test, clear, retry),
    h('p', { class: 'desc', text: aiText('testHint') }), status,
    createAIRedactionSettings({ h, actions, button }),
    createAITopicSettings({ h, actions, button }));
  const element = card(aiText('title'), aiText('hint'), body, {
    full: true,
    search: Object.values(labels).flat().join(' ') + ' AI OpenAI API provider 模型 服务商 密钥 隐私 标签'
  });
  // No secret input values are included in the settings search index.
  void load();
  return element;
}

// Local-only controls deliberately bypass the provider messaging/configuration path.
export function createAIRedactionSettings({ h, actions, button }) {
  const enabled = h('input', { type: 'checkbox', id: 'ai-redaction-enabled' });
  const words = h('textarea', {
    id: 'ai-redaction-words', rows: '8', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'ai-redaction-hint',
  });
  const status = h('p', { class: 'desc', role: 'status', 'aria-live': 'polite', text: aiText('redactionLoading') });
  let loaded = false;
  let busy = false;
  const save = button(aiText('redactionSave'), '', async () => {
    if (!loaded || busy) return;
    setBusy(true);
    showStatus('', false);
    try {
      const rules = normalizeRedactionRules({ enabled: enabled.checked, words: words.value });
      await chrome.storage.local.set({ [AI_REDACTION_KEY]: rules });
      // Show the normalized dictionary only after persistence succeeds.
      words.value = rules.words.join('\n');
      showStatus(aiText('redactionSaved'), false);
    } catch (error) {
      const label = {
        REDACTION_TOO_MANY_WORDS: 'redactionTooMany',
        REDACTION_WORD_TOO_LONG: 'redactionTooLong',
        INVALID_REDACTION_RULES: 'redactionInvalid',
      }[error.code] || 'redactionSaveFailed';
      showStatus(aiText(label), true);
    } finally { setBusy(false); }
  });
  const retry = button(aiText('retry'), '', () => load());
  function setBusy(value) {
    busy = value;
    for (const control of [enabled, words, save]) control.disabled = busy || !loaded;
    retry.disabled = busy;
  }
  function showStatus(text, error) {
    status.textContent = text;
    status.classList.toggle('ai-status-error', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }
  async function load() {
    if (busy) return;
    setBusy(true);
    showStatus(aiText('redactionLoading'), false);
    try {
      const local = await chrome.storage.local.get(AI_REDACTION_KEY);
      const rules = normalizeRedactionRules(local[AI_REDACTION_KEY]);
      enabled.checked = rules.enabled;
      words.value = rules.words.join('\n');
      loaded = true;
      retry.hidden = true;
      showStatus('', false);
    } catch {
      loaded = false;
      retry.hidden = false;
      showStatus(aiText('redactionLoadFailed'), true);
    } finally { setBusy(false); }
  }
  const section = h('section', { class: 'cloud-form', 'aria-labelledby': 'ai-redaction-title' },
    h('h3', { id: 'ai-redaction-title', text: aiText('redactionTitle') }),
    h('p', { id: 'ai-redaction-hint', class: 'desc', text: aiText('redactionHint') }),
    h('label', { class: 'form-field', for: 'ai-redaction-enabled' }, enabled, h('span', { text: aiText('redactionEnabled') })),
    h('label', { class: 'form-field', for: 'ai-redaction-words' }, h('span', { class: 'form-label', text: aiText('redactionWords') }), words),
    actions(save, retry), status);
  void load();
  return section;
}

export function createAITopicSettings({ h, actions, button }) {
  const enabled = h('input', { type: 'checkbox', id: 'ai-topics-enabled' });
  const status = h('p', { class: 'desc', role: 'status', 'aria-live': 'polite' });
  let loaded = false, busy = false;
  const setBusy = value => { busy = value; enabled.disabled = save.disabled = busy || !loaded; retry.disabled = busy; };
  const show = (label, error = false) => {
    status.textContent = label ? aiText(label) : '';
    status.classList.toggle('ai-status-error', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  };
  const save = button(aiText('topicsSave'), '', async () => {
    if (!loaded || busy) return;
    setBusy(true);
    try {
      await chrome.storage.local.set({ [AI_TOPICS_KEY]: normalizeTopicRules({ enabled: enabled.checked }) });
      show('topicsSaved');
    } catch { show('topicsFailed', true); }
    finally { setBusy(false); }
  });
  const retry = button(aiText('topicsRetry'), '', () => load());
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      const local = await chrome.storage.local.get(AI_TOPICS_KEY);
      enabled.checked = normalizeTopicRules(local[AI_TOPICS_KEY]).enabled;
      loaded = true; retry.hidden = true; show('');
    } catch { loaded = false; retry.hidden = false; show('topicsFailed', true); }
    finally { setBusy(false); }
  }
  const section = h('section', { class: 'cloud-form', 'aria-labelledby': 'ai-topics-title' },
    h('h3', { id: 'ai-topics-title', text: aiText('topicsTitle') }),
    h('p', { id: 'ai-topics-hint', class: 'desc', text: aiText('topicsHint') }),
    h('label', { class: 'form-field', for: 'ai-topics-enabled' }, enabled,
      h('span', { text: aiText('topicsEnabled') })), actions(save, retry), status);
  enabled.setAttribute('aria-describedby', 'ai-topics-hint');
  void load();
  return section;
}
