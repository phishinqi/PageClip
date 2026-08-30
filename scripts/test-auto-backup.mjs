import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud-backup.js', import.meta.url), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*/gm, '')
  .replace(/^export\s+/gm, '')
  + '\n globalThis.__backupTest = { runAutomaticBackup, listBackups, uploadLatestBackup };';

const data = {
  schema: 3,
  items: [{ id: 'i1', url: 'https://example.com', title: 'Example' }],
  folders: [{ id: 'f_uncategorized', name: '未分类', parentId: null, order: 0, system: true }],
  quickAccess: [], inbox: [], recycleBin: [],
  settings: { cloudBackup: { autoBackupEnabled: true, autoBackupIntervalHours: 24 } },
};
const files = [];
const calls = [];
let nextId = 1;
const identity = { async getAuthToken() { calls.push(['auth']); return { token: 'auto-token' }; }, getRedirectURL() { return 'https://fimhgjmocneioennilphfkdejdebkmfe.chromiumapp.org/'; } };
const context = {
  chrome: { identity, runtime: { id: 'fimhgjmocneioennilphfkdejdebkmfe' } },
  navigator: { userAgentData: { brands: [] }, userAgent: '' },
  URL, URLSearchParams, TextEncoder, console,
  loadData: async () => structuredClone(data),
  updateSettings: async (patch) => { calls.push(['settings', patch]); data.settings = { ...data.settings, ...patch }; },
  getCloudBackupPayload: (value) => value,
  getOrCreateDeviceKey: async () => 'device-key',
  encryptBackup: async (payload, options) => { calls.push(['encrypt', options.mode]); return { format: 'pageclip-cloud-backup', encryption: { mode: options.mode }, payload }; },
  fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push(['fetch', method, url.pathname]);
    if (url.pathname.endsWith('/files') && method === 'GET') return new Response(JSON.stringify({ files: files.filter((file) => !file.trashed) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/files') && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      const file = { id: 'f' + nextId++, name: body.name, size: '0', createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString(), mimeType: body.mimeType };
      files.push(file);
      return new Response(JSON.stringify(file), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const upload = url.pathname.match(/\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (upload && method === 'PATCH') {
      const file = files.find((item) => item.id === decodeURIComponent(upload[1]));
      Object.assign(file, { size: String(String(init.body).length), modifiedTime: new Date().toISOString() });
      return new Response(JSON.stringify(file), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const remove = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (remove && method === 'DELETE') {
      const file = files.find((item) => item.id === decodeURIComponent(remove[1]));
      if (file) file.trashed = true;
      return new Response('', { status: 204 });
    }
    throw new Error('Unexpected request: ' + method + ' ' + url);
  },
  Headers, Response,
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'cloud-backup.js' });
const result = await context.__backupTest.runAutomaticBackup();
assert.equal(result.skipped, false);
assert.equal(result.historyFile.name.startsWith('PageClip-backup-'), true);
assert.equal(files.some((file) => file.name === 'PageClip-latest.enc'), true);
assert.equal(files.some((file) => file.name.startsWith('PageClip-backup-')), true);
const listed = await context.__backupTest.listBackups(false);
assert.equal(listed.length, 2);
assert.deepEqual(calls.find((entry) => entry[0] === 'encrypt'), ['encrypt', 'device-key']);
assert.equal(data.settings.cloudBackup.lastAutoBackupError, null);

console.log('Automatic backup tests passed: device-key upload and history snapshot');
