import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const executable = source.replace(/^import[^;]+;\s*/gm, '');
const events = Object.fromEntries(['onCreated', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded', 'onRemoved'].map((key) => [key, { listeners: [], addListener(fn) { this.listeners.push(fn); } }]));
const alarmEvent = { listeners: [], addListener(fn) { this.listeners.push(fn); } };
const runtime = { listeners: [], onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { runtime.listeners.push(fn); } }, getURL: (path) => path };
const data = { settings: { bookmarkAutoImport: { enabled: true } } };
const alarms = [];
const updates = [];
let importCalls = 0;
const context = {
  chrome: {
    bookmarks: { ...events, async getTree() { return [{ id: '0', children: [] }]; } },
    alarms: { create(name, info) { alarms.push([name, info]); }, clear: async () => true, onAlarm: alarmEvent },
    runtime,
    storage: { onChanged: { addListener() {} } },
    tabs: { query: async () => [], create: async () => {}, update: async () => {} },
    action: { onClicked: { addListener() {} }, setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}, setTitle: async () => {} },
    contextMenus: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  },
  loadData: async () => structuredClone(data),
  updateSettings: async (patch) => { updates.push(patch); data.settings = { ...data.settings, ...patch }; },
  mergeBrowserBookmarks: async () => { importCalls++; return { foldersAdded: 1, itemsAdded: 2, duplicatesSkipped: 0, invalidSkipped: 0, mode: 'merge' }; },
  collectIntoStorage: async () => {}, addQuickItem: async () => {}, addInboxItem: async () => {}, isCollectableUrl: () => true,
  ensureDataInitialized: async () => {}, pruneRecycleBin: async () => {}, initI18n: async () => {}, t: (key) => key, getMessages: () => ({}),
  runAutomaticBackup: async () => {}, AUTO_BACKUP_ALARM: 'backup', AUTO_BACKUP_DEFAULT_HOURS: 24, AUTO_BACKUP_INTERVALS: [24],
  setTimeout, Promise, structuredClone, console,
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'background.js' });
assert.equal(events.onRemoved.listeners.length, 0);
assert.equal(events.onCreated.listeners.length, 1);
events.onCreated.listeners[0]();
events.onChanged.listeners[0]();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(alarms.filter(([name]) => name === 'pageclip-auto-bookmark-import').length, 2);
const handler = runtime.listeners[0];
const response = await new Promise((resolve) => {
  handler({ type: 'run-bookmark-import' }, {}, resolve);
});
assert.equal(response.ok, true);
assert.equal(response.result.itemsAdded, 2);
assert.equal(importCalls, 1);
assert.equal(data.settings.bookmarkAutoImport.lastResult.trigger, 'manual');
const disable = await new Promise((resolve) => handler({ type: 'set-bookmark-auto-import', enabled: false }, {}, resolve));
assert.equal(disable.ok, true);
assert.equal(data.settings.bookmarkAutoImport.enabled, false);
console.log('Automatic bookmark import controller tests passed: events, merge-only execution, status, and disable');
