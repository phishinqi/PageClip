// Private AI transport. Never import this module into an extension page.
import { MAGPIE_BASE_URL, gatewayDefaultKey } from './ai-defaults.js';
const CONFIG_KEY = 'pageclip_ai_config';
const REQUEST_LIMIT = 48 * 1024;
const RESPONSE_LIMIT = 128 * 1024;
const TYPES = new Set(['ai-config-status', 'ai-config-save', 'ai-config-clear-key', 'ai-test', 'ai-models', 'ai-analyze', 'ai-cancel']);
const ERRORS = {
  FORBIDDEN: 'This page cannot perform this AI operation.',
  INVALID_REQUEST: 'The AI request is invalid.',
  INVALID_CONFIG: 'Enter a valid API root, model and API key.',
  NOT_CONFIGURED: 'Configure an AI provider first.',
  REQUEST_TOO_LARGE: 'The AI request exceeds 48 KiB.',
  RESPONSE_TOO_LARGE: 'The AI response exceeds 128 KiB.',
  BUSY: 'Another AI analysis is running.',
  CANCELLED: 'The AI request was cancelled.',
  TIMEOUT: 'The AI provider timed out.',
  NETWORK: 'Unable to connect to the AI provider.',
  RATE_LIMIT: 'The AI provider is rate limited. Try again later.',
  PROVIDER: 'The AI provider rejected the request.',
  AUTH: 'The AI provider rejected the credentials.',
  BAD_REQUEST: 'The provider rejected the request parameters (HTTP 400/422). Check the model and gateway protocol compatibility.',
  JSON_MODE: 'The provider rejected JSON output mode. Try a model with JSON support.',
  INVALID_RESPONSE: 'The AI provider returned an invalid response.',
  INTERNAL: 'The AI operation could not be completed.',
};
const encoder = new TextEncoder();
const requests = new Map();
let activeAnalysis = null;
function fail(code) { const error = new Error(ERRORS[code]); error.code = code; return error; }
function status(config = {}) {
  return { baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : MAGPIE_BASE_URL, model: typeof config.model === 'string' ? config.model : '', hasKey: Boolean(config.apiKey) };
}
function validateRoot(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[?#\\]/.test(value)) throw fail('INVALID_CONFIG');
  let url;
  try { url = new URL(value); } catch { throw fail('INVALID_CONFIG'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw fail('INVALID_CONFIG');
  return url.href.replace(/\/+$/, '');
}
async function loadConfig() {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  return data[CONFIG_KEY] || {};
}
function authorized(sender, type) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  // Exact URL also prevents content scripts, lookalike paths and query/fragment variants.
  const options = sender.url === chrome.runtime.getURL('options.html');
  const organizer = sender.url === chrome.runtime.getURL('ai-organizer.html');
  if (type === 'ai-config-status') return options || organizer;
  if (type === 'ai-analyze' || type === 'ai-cancel') return organizer;
  return options;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(fail('CANCELLED'));
    const abort = () => { clearTimeout(timer); reject(fail('CANCELLED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function readLimited(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > RESPONSE_LIMIT) { await response.body?.cancel(); throw fail('RESPONSE_TOO_LARGE'); }
  if (!response.body?.getReader) throw fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) { await reader.cancel(); throw fail('RESPONSE_TOO_LARGE'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
function retryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}
async function completion(config, body, controller) {
  let retries = 0, formatRetried = false;
  for (;;) {
    if (controller.signal.aborted) throw fail('CANCELLED');
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    let timedOut = false, retryDelay = null;
    const timer = setTimeout(() => { timedOut = true; attempt.abort(); }, 25000);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body), signal: attempt.signal,
      });
      const text = await readLimited(response);
      if (!response.ok) {
        let detail;
        try { detail = JSON.parse(text)?.error; } catch {}
        const jsonModeError = [400, 422].includes(response.status) && body.response_format && /(?:messages?.{0,100}(?:contain|include).{0,100}json|json.{0,100}(?:text\.format|json_object)|(?:text\.format|json_object).{0,100}json)/i.test(detail?.message || '');
        const explicitUnsupported = [400, 422].includes(response.status) && body.response_format &&
          ((detail?.param === 'response_format' && /unsupported|not.supported|unknown|unrecognized/i.test(`${detail?.code || ''} ${detail?.message || ''}`)) ||
           /response_format.{0,100}(?:unsupported|not supported)|(?:unsupported|not supported).{0,100}response_format/i.test(detail?.message || ''));
        if ((explicitUnsupported || jsonModeError) && !formatRetried) {
          formatRetried = true;
          body = { ...body }; delete body.response_format;
          continue;
        }
        if (jsonModeError) throw fail('JSON_MODE');
        if ([400, 422].includes(response.status)) throw fail('BAD_REQUEST');
        if (response.status === 401 || response.status === 403) throw fail('AUTH');
        if (response.status === 429 || response.status >= 500) {
          const delay = [2000, 5000][retries];
          if (delay === undefined || retryAfter(response) > delay) throw fail(response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER');
          retries++; retryDelay = delay;
        } else throw fail('PROVIDER');
      } else {
        let json;
        try { json = JSON.parse(text); } catch { throw fail('INVALID_RESPONSE'); }
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim() || content.includes(config.apiKey)) throw fail('INVALID_RESPONSE');
        return content;
      }
    } catch (error) {
      if (controller.signal.aborted) throw fail('CANCELLED');
      if (timedOut) throw fail('TIMEOUT');
      if (error.code && ERRORS[error.code]) throw error;
      if (retries >= 2) throw fail('NETWORK');
      retryDelay = [2000, 5000][retries++];
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
    if (retryDelay !== null) await sleep(retryDelay, controller.signal);
  }
}
function prepareBody(message, config) {
  let source = message.body || { messages: message.messages };
  let serialized;
  try { serialized = JSON.stringify(source); } catch { throw fail('INVALID_REQUEST'); }
  if (!serialized || encoder.encode(serialized).length > REQUEST_LIMIT) throw fail('REQUEST_TOO_LARGE');
  // Only chat parameters are accepted; the caller cannot select another URL/model or enable streaming/tools.
  if (!source || !Array.isArray(source.messages) || !source.messages.length || source.messages.length > 100 ||
      source.messages.some((m) => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) throw fail('INVALID_REQUEST');
  const body = { model: config.model, messages: source.messages.map(({ role, content }) => ({ role, content })), stream: false };
  if (source.response_format?.type === 'json_object') {
    body.response_format = { type: 'json_object' };
    // Some OpenAI-compatible gateways require the literal lowercase word.
    body.messages.unshift({ role: 'system', content: 'Return a valid json object only.' });
  }
  if (typeof source.temperature === 'number' && Number.isFinite(source.temperature) && source.temperature >= 0 && source.temperature <= 2) body.temperature = source.temperature;
  if (Number.isInteger(source.max_tokens) && source.max_tokens > 0 && source.max_tokens <= 16384) body.max_tokens = source.max_tokens;
  if (encoder.encode(JSON.stringify(body)).length > REQUEST_LIMIT) throw fail('REQUEST_TOO_LARGE');
  return body;
}
async function execute(message, controller) {
  const current = await loadConfig();
  if (message.type === 'ai-config-clear-key') {
    const config = { baseUrl: current.baseUrl || '', model: current.model || '' };
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return status(config);
  }
  if (message.type === 'ai-config-status') return status(current);
  if (message.type === 'ai-config-save') {
    const input = message.config || message;
    const baseUrl = validateRoot(input.baseUrl);
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    const suppliedKey = input.apiKey ?? input.key;
    const apiKey = suppliedKey === undefined || suppliedKey === '' ? (current.baseUrl === baseUrl ? current.apiKey : null) || gatewayDefaultKey(baseUrl) : suppliedKey;
    if (!model || model.length > 200 || /[\r\n]/.test(model) || typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw fail('INVALID_CONFIG');
    const config = { baseUrl, model, apiKey: apiKey.trim() };
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return status(config);
  }
  if (message.type === 'ai-models') {
    const baseUrl = validateRoot(message.baseUrl || current.baseUrl || MAGPIE_BASE_URL);
    const suppliedKey = message.apiKey;
    const apiKey = suppliedKey || (current.baseUrl === baseUrl ? current.apiKey : '') || gatewayDefaultKey(baseUrl);
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw fail('INVALID_CONFIG');
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 25000);
    try {
      const response = await fetch(`${baseUrl}/models`, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal: attempt.signal });
      if (!response.ok) { await response.body?.cancel(); throw fail([401, 403].includes(response.status) ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER'); }
      let json; try { json = JSON.parse(await readLimited(response)); } catch (error) { if (error.code) throw error; throw fail('INVALID_RESPONSE'); }
      if (!Array.isArray(json?.data)) throw fail('INVALID_RESPONSE');
      const models = [...new Set(json.data.map(m => m?.id).filter(id => typeof id === 'string' && id.trim() && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id) && !id.includes(apiKey)))].sort().slice(0, 1000);
      return { models };
    } catch (error) { if (error.code) throw error; throw fail(attempt.signal.aborted ? 'TIMEOUT' : 'NETWORK'); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
  }
  if (!current.apiKey || !current.model) throw fail('NOT_CONFIGURED');
  const config = { ...current, baseUrl: validateRoot(current.baseUrl) };
  const body = message.type === 'ai-test' ? { model: config.model, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false, max_tokens: 8 } : prepareBody(message, config);
  const content = await completion(config, body, controller);
  return message.type === 'ai-test' ? { success: true } : { content };
}

/** Returns null for unknown messages. All failures use fixed, non-provider error text. */
export async function handleAiMessage(message, sender) {
  if (!TYPES.has(message?.type)) return null;
  const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128 ? message.requestId : null;
  const errorResponse = (code) => ({ ok: false, requestId, code, message: ERRORS[code] });
  if (!authorized(sender, message.type)) return errorResponse('FORBIDDEN');
  if (!requestId || !requestId.trim()) return errorResponse('INVALID_REQUEST');
  if (message.type === 'ai-cancel') {
    const target = message.targetRequestId || requestId;
    const cancelled = Boolean(activeAnalysis && activeAnalysis.requestId === target);
    if (cancelled) activeAnalysis.controller.abort();
    return { ok: true, requestId, result: { cancelled } };
  }
  const key = `${message.type}:${requestId}`;
  if (requests.has(key)) return requests.get(key).promise;
  if (message.type === 'ai-analyze' && activeAnalysis) return errorResponse('BUSY');
  const controller = new AbortController();
  const entry = { requestId, controller, promise: null, done: false };
  if (message.type === 'ai-analyze') activeAnalysis = entry;
  entry.promise = execute(message, controller)
    .then((result) => controller.signal.aborted ? errorResponse('CANCELLED') : { ok: true, requestId, result })
    .catch((error) => errorResponse(ERRORS[error?.code] ? error.code : 'INTERNAL'))
    .finally(() => {
      entry.done = true;
      if (activeAnalysis === entry) activeAnalysis = null;
      // Keep a bounded completed-request replay cache, never evict an in-flight entry.
      for (const [id, cached] of requests) {
        if (requests.size <= 100) break;
        if (cached.done) requests.delete(id);
      }
    });
  requests.set(key, entry);
  return entry.promise;
}
