import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const executable = source.replace(/^import[^;]+;\s*/gm, '');
const events = Object.fromEntries(['onCreated', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded', 'onRemoved'].map((key) => [key, { listeners: [], addListener(fn) { this.listeners.push(fn); } }]));
const alarmEvent = { listeners: [], addListener(fn) { this.listeners.push(fn); } };
const notificationEvent = { listeners: [], addListener(fn) { this.listeners.push(fn); } };
const storageEvent = { listeners: [], addListener(fn) { this.listeners.push(fn); } };
const runtime = { listeners: [], onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { runtime.listeners.push(fn); } }, getURL: (path) => path };
const data = {
  items: [], folders: [], quickAccess: [], inbox: [], recycleBin: [],
  settings: { bookmarkAutoImport: { enabled: true }, cloudBackup: { autoBackupEnabled: true } },
};
const alarms = [];
const clears = [];
const updates = [];
const createdTabs = [];
const updatedTabs = [];
const notifications = [];
const notificationClears = [];
let importCalls = 0;
let automaticBackupCalls = 0;
let automaticBackupResult = null;
const context = {
  chrome: {
    bookmarks: { ...events, async getTree() { return [{ id: '0', children: [] }]; } },
    alarms: {
      create(name, info) { alarms.push([name, info]); },
      clear: async (name) => { clears.push(name); return true; },
      get: async () => null,
      onAlarm: alarmEvent,
    },
    runtime,
    storage: { onChanged: storageEvent },
    tabs: { query: async () => [], create: async (options) => { createdTabs.push(options); }, update: async (id, options) => { updatedTabs.push([id, options]); } },
    notifications: {
      create: async (id, options) => { notifications.push([id, options]); return id; },
      clear: async (id) => { notificationClears.push(id); return true; },
      onClicked: notificationEvent,
    },
    action: { onClicked: { addListener() {} }, setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}, setTitle: async () => {} },
    contextMenus: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  },
  loadData: async () => structuredClone(data),
  updateSettings: async (patch) => { updates.push(patch); data.settings = { ...data.settings, ...patch }; },
  mergeBrowserBookmarks: async () => { importCalls++; return { foldersAdded: 1, itemsAdded: 2, duplicatesSkipped: 0, invalidSkipped: 0, mode: 'merge' }; },
  collectIntoStorage: async () => {}, addQuickItem: async () => {}, addInboxItem: async () => {}, isCollectableUrl: () => true,
  ensureDataInitialized: async () => {}, pruneRecycleBin: async () => {}, initI18n: async () => {}, t: (key) => key, getMessages: () => ({}),
  runAutomaticBackup: async () => { automaticBackupCalls++; return automaticBackupResult; }, AUTO_BACKUP_ALARM: 'backup', AUTO_BACKUP_DEBOUNCE_MS: 10 * 1000,
  hasBackupRelevantChange: (before, after) => JSON.stringify({ items: before?.items || [], folders: before?.folders || [], quickAccess: before?.quickAccess || [], inbox: before?.inbox || [], recycleBin: before?.recycleBin || [] }) !== JSON.stringify({ items: after?.items || [], folders: after?.folders || [], quickAccess: after?.quickAccess || [], inbox: after?.inbox || [], recycleBin: after?.recycleBin || [] }),
  setTimeout, Promise, structuredClone, console, Date,
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'background.js' });

assert.equal(events.onRemoved.listeners.length, 1);
for (const event of Object.values(events)) event.listeners[0]();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(alarms.filter(([name]) => name === 'pageclip-auto-bookmark-import').length, 6);

const handler = runtime.listeners[0];
const response = await new Promise((resolve) => handler({ type: 'run-bookmark-import' }, {}, resolve));
assert.equal(response.ok, true);
assert.equal(response.result.itemsAdded, 2);
assert.equal(importCalls, 1);
assert.equal(data.settings.bookmarkAutoImport.lastResult.trigger, 'manual');
const disable = await new Promise((resolve) => handler({ type: 'set-bookmark-auto-import', enabled: false }, {}, resolve));
assert.equal(disable.ok, true);
assert.equal(data.settings.bookmarkAutoImport.enabled, false);
assert.equal(clears.includes('pageclip-auto-bookmark-import'), true);
events.onRemoved.listeners[0]();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(alarms.filter(([name]) => name === 'pageclip-auto-bookmark-import').length, 6);
alarmEvent.listeners[0]({ name: 'pageclip-auto-bookmark-import' });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(importCalls, 1);

const storageChanged = storageEvent.listeners[0];
const before = structuredClone(data);
const after = structuredClone(data);
after.items.push({ id: 'new-item' });
data.items = after.items;
const backupAlarmsBefore = alarms.filter(([name]) => name === 'backup').length;
storageChanged({ bc_data: { oldValue: before, newValue: after } }, 'local');
storageChanged({ bc_data: { oldValue: before, newValue: after } }, 'local');
await new Promise((resolve) => setTimeout(resolve, 0));
const backupAlarms = alarms.filter(([name]) => name === 'backup');
assert.equal(backupAlarms.length - backupAlarmsBefore, 2);
assert.equal(backupAlarms.at(-1)[1].when >= Date.now() + 9 * 1000, true);

const settingsOnly = structuredClone(after);
settingsOnly.settings.cloudBackup.lastAutoBackupAt = Date.now();
storageChanged({ bc_data: { oldValue: after, newValue: settingsOnly } }, 'local');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(alarms.filter(([name]) => name === 'backup').length, backupAlarms.length);
const backupDisabled = structuredClone(settingsOnly);
backupDisabled.settings.cloudBackup.autoBackupEnabled = false;
data.settings.cloudBackup.autoBackupEnabled = false;
storageChanged({ bc_data: { oldValue: settingsOnly, newValue: backupDisabled } }, 'local');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(clears.includes('backup'), true);
alarmEvent.listeners[0]({ name: 'backup' });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(automaticBackupCalls, 1);

automaticBackupResult = { skipped: true, reason: 'authorization-required', justPaused: true };
alarmEvent.listeners[0]({ name: 'backup' });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(notifications.length, 1);
assert.equal(notifications[0][0], 'pageclip-auto-backup-reconnect');
assert.equal(notifications[0][1].type, 'basic');
assert.equal(notifications[0][1].title, 'notification.autoBackupPausedTitle');
assert.equal(clears.filter((name) => name === 'backup').length >= 2, true);
automaticBackupResult = { skipped: true, reason: 'authorization-required', justPaused: false };
alarmEvent.listeners[0]({ name: 'backup' });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(notifications.length, 1);
notificationEvent.listeners[0]('pageclip-auto-backup-reconnect');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(notificationClears.includes('pageclip-auto-backup-reconnect'), true);
assert.equal(createdTabs.some((options) => options.url === 'options.html'), true);
assert.equal(clears.includes('pageclip-auto-backup-reconnect'), false);

console.log('Automation controller tests passed: gated bookmark events, backup debounce, and OAuth recovery notification');
