import assert from 'node:assert/strict';
import { AUTO_BACKUP_DEBOUNCE_MS, hasBackupRelevantChange } from '../js/auto-sync.js';

const base = {
  folders: [{ id: 'f_uncategorized' }],
  items: [{ id: 'item-1', url: 'https://example.com' }],
  quickAccess: [{ id: 'quick-1' }],
  inbox: [{ id: 'inbox-1' }],
  recycleBin: [{ id: 'recycle-1' }],
  settings: {
    uiLocale: 'zh_CN',
    bookmarkAutoImport: { enabled: true, lastSuccessAt: 1 },
    cloudBackup: { autoBackupEnabled: true, lastBackupAt: 1, lastAutoBackupAt: 1, lastAutoBackupError: null, googleAccountEmail: 'test@example.com', driveFileId: 'file-1' },
  },
};

assert.equal(AUTO_BACKUP_DEBOUNCE_MS, 10 * 1000);
assert.equal(hasBackupRelevantChange(base, structuredClone(base)), false);
for (const domain of ['folders', 'items', 'quickAccess', 'inbox', 'recycleBin']) {
  const changed = structuredClone(base);
  changed[domain].push({ id: domain + '-changed' });
  assert.equal(hasBackupRelevantChange(base, changed), true, domain + ' changes should schedule a backup');
}

const settingsOnly = structuredClone(base);
settingsOnly.settings.uiLocale = 'en';
settingsOnly.settings.bookmarkAutoImport = { enabled: false, lastSuccessAt: 2, lastError: 'temporary error' };
settingsOnly.settings.cloudBackup = {
  ...settingsOnly.settings.cloudBackup,
  autoBackupEnabled: false,
  lastBackupAt: 2,
  lastAutoBackupAt: 2,
  lastAutoBackupError: 'temporary error',
  googleAccountEmail: 'other@example.com',
  driveFileId: 'file-2',
};
assert.equal(hasBackupRelevantChange(base, settingsOnly), false);

console.log('Auto-sync tests passed: content changes detected and settings-only writes ignored');
