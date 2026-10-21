// Immutable operation storage. Encryption is supplied by the caller via codecs;
// identity codecs are intentionally NOT suitable for private production data.
import { getToken as cloudGetToken, clearToken as cloudClearToken } from './google-auth.js';

export const SYNC_FILE_PREFIX = 'PageClip-sync-v1-';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TIMEOUT_MS = 20000;

export class SyncError extends Error {
  constructor(kind, message, { retryAfter = null } = {}) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

function operationName(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
      typeof operation.id !== 'string' || !operation.id.trim()) {
    throw new SyncError('format', 'Operation must have a nonempty string id');
  }
  try { return SYNC_FILE_PREFIX + encodeURIComponent(operation.id) + '.json'; }
  catch { throw new SyncError('format', 'Invalid operation id'); }
}

// Compare JSON data independent of object-key insertion order. An operation id
// is immutable: reusing it for different content is a format conflict.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function retryDelay(response) {
  const value = response.headers?.get('Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export class DriveSyncAdapter {
  constructor({ fetchImpl = globalThis.fetch, getToken = cloudGetToken,
    clearToken = cloudClearToken, encode = (value) => value, decode = (value) => value } = {}) {
    this.fetchImpl = fetchImpl;
    this.getToken = getToken;
    this.clearToken = clearToken;
    this.encode = encode;
    this.decode = decode;
  }

  async _token(interactive = false) {
    try {
      const token = await this.getToken(interactive);
      if (typeof token !== 'string' || !token) throw new Error();
      return token;
    } catch (error) {
      const kind = ['auth', 'retry', 'permission'].includes(error?.kind) ? error.kind : 'auth';
      const wrapped = new SyncError(kind, kind === 'retry' ? 'Google authorization temporarily unavailable' : 'Google Drive authorization required', { retryAfter: error?.retryAfter });
      wrapped.code = error?.code;
      throw wrapped;
    }
  }

  async initialize({ interactive = false } = {}) {
    await this._token(interactive);
  }

  async _request(url, options = {}) {
    // Renew at most once for this request, always silently. No automatic network
    // retries: the caller controls backoff, and append checks for prior publication.
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this._token(false);
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await this.fetchImpl(url, {
              ...options, signal: controller.signal,
              headers: { ...options.headers, Authorization: 'Bearer ' + token },
            });
            // Keep the deadline active through body download, not just headers.
            if (response.status === 401) return { unauthorized: true };
            if (!response.ok) {
              let rateLimited = false;
              if (response.status === 403) {
                try {
                  const body = JSON.parse(await response.text());
                  rateLimited = body?.error?.errors?.some((item) =>
                    ['rateLimitExceeded', 'userRateLimitExceeded'].includes(item.reason));
                } catch {}
              }
              const kind = response.status === 429 || response.status === 408 ||
                response.status >= 500 || rateLimited ? 'retry' :
                response.status === 403 ? 'permission' : 'format';
              throw new SyncError(kind, 'Google Drive request failed (HTTP ' + response.status + ')', {
                retryAfter: retryDelay(response),
              });
            }
            const text = await response.text();
            try { return { body: JSON.parse(text) }; }
            catch { throw new SyncError('format', 'Invalid Google Drive JSON'); }
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new SyncError('retry', 'Google Drive request timed out'));
            }, TIMEOUT_MS);
          }),
        ]);
        if (!result.unauthorized) return result.body;
        if (attempt === 1) throw new SyncError('auth', 'Google Drive authorization required');
        try { await this.clearToken(token); }
        catch (error) { throw new SyncError(error?.kind === 'retry' ? 'retry' : 'auth', 'Google Drive authorization reset failed', { retryAfter: error?.retryAfter }); }
      } catch (error) {
        if (error instanceof SyncError) throw error;
        // Never expose transport messages, tokens, or server response content.
        throw new SyncError('retry', 'Google Drive transport failed');
      } finally { clearTimeout(timer); }
    }
  }

  async list() {
    const entries = [];
    const seenPages = new Set();
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: "trashed = false and name contains '" + SYNC_FILE_PREFIX + "'",
        fields: 'nextPageToken,files(id,name,size)', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await this._request(API + '?' + params);
      if (!body || !Array.isArray(body.files)) throw new SyncError('format', 'Invalid Drive file list');
      for (const file of body.files) {
        if (typeof file?.name !== 'string' || !file.name.startsWith(SYNC_FILE_PREFIX)) continue;
        if (file.size === 0 || file.size === '0') continue; // Legacy partial uploads.
        if (typeof file.id !== 'string' || !file.id) throw new SyncError('format', 'Invalid Drive file entry');
        entries.push({ id: file.id, name: file.name });
      }
      pageToken = body.nextPageToken || '';
      if (typeof pageToken !== 'string' || (pageToken && seenPages.has(pageToken))) {
        throw new SyncError('format', 'Invalid Drive pagination');
      }
      if (pageToken) seenPages.add(pageToken);
    } while (pageToken);
    return entries;
  }

  async read(entry) {
    if (typeof entry?.id !== 'string' || !entry.id) throw new SyncError('format', 'Invalid Drive entry');
    const envelope = await this._request(API + '/' + encodeURIComponent(entry.id) + '?alt=media');
    try {
      const operation = await this.decode(envelope);
      const name = operationName(operation);
      if (entry.name && entry.name !== name) throw new Error();
      return operation;
    } catch { throw new SyncError('format', 'Invalid encoded sync operation'); }
  }

  async append(operation, { entries } = {}) {
    const name = operationName(operation);
    let expected;
    try { expected = canonical(JSON.parse(JSON.stringify(operation))); }
    catch { throw new SyncError('format', 'Operation must be JSON serializable'); }
    // Drive does not enforce name uniqueness. A retry must verify the actual
    // decoded id, not trust a matching filename alone. No history is deleted.
    const knownEntries = entries === undefined ? await this.list() : entries;
    if (!Array.isArray(knownEntries)) throw new SyncError('format', 'Invalid known Drive entries');
    const existing = knownEntries.filter((entry) => entry.name === name);
    for (const entry of existing) {
      const stored = await this.read(entry);
      if (stored.id !== operation.id || canonical(stored) !== expected) {
        throw new SyncError('format', 'Sync operation id or content mismatch');
      }
      return entry;
    }
    let serialized;
    try {
      serialized = JSON.stringify(await this.encode(operation));
      if (serialized === undefined) throw new Error();
    } catch { throw new SyncError('format', 'Unable to encode sync operation'); }
    let boundary;
    do { boundary = 'pageclip_sync_' + Math.random().toString(36).slice(2); }
    while (serialized.includes(boundary));
    const metadata = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      metadata + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
      serialized + '\r\n--' + boundary + '--\r\n';
    const result = await this._request(UPLOAD + '?uploadType=multipart&fields=id,name', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
    });
    if (typeof result?.id !== 'string' || !result.id || result.name !== name) {
      throw new SyncError('format', 'Invalid Drive publication result');
    }
    return { id: result.id, name: result.name };
  }
}
