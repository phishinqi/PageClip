import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/cloud-status.js', import.meta.url), 'utf8');
const { getCloudCardState } = await import('data:text/javascript,' + encodeURIComponent(source));

{
  const view = getCloudCardState({
    connected: true,
    account: { email: 'abczhaozhe1@gmail.com' },
    file: { modifiedTime: '2026-08-30T02:57:22.000Z' },
  });
  assert.equal(view.connected, true);
  assert.equal(view.account, 'abczhaozhe1@gmail.com');
  assert.equal(view.titleKey, 'settings.connected');
  assert.equal(view.statusKey, 'settings.cloudFile');
}

{
  const view = getCloudCardState({
    connected: true,
    account: null,
    file: { modifiedTime: '2026-08-30T02:57:22.000Z' },
  });
  assert.equal(view.connected, true);
  assert.equal(view.titleKey, 'settings.connectedNoAccount');
  assert.equal(view.statusKey, 'settings.cloudFile');
}

{
  const view = getCloudCardState({
    connected: false,
    account: { email: 'stale@example.com' },
    file: { modifiedTime: '2026-08-30T02:57:22.000Z' },
  });
  assert.equal(view.connected, false);
  assert.equal(view.account, '');
  assert.equal(view.titleKey, 'settings.notConnected');
  assert.equal(view.statusKey, 'settings.cloudFileNeedsConnection');
}

{
  const view = getCloudCardState({ connected: false, account: null, file: null }, { lastBackupAt: 1724983042000 });
  assert.equal(view.titleKey, 'settings.notConnected');
  assert.equal(view.statusKey, 'settings.localLast');
}

console.log('Cloud status tests passed: 4 scenarios');
