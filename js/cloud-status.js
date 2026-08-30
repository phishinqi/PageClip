export function getCloudCardState(cloudStatus = {}, cloudSettings = {}) {
  const connected = Boolean(cloudStatus.connected);
  const account = connected ? (cloudStatus.account?.email || '') : '';
  const file = cloudStatus.file || null;
  const localLast = cloudSettings.lastBackupAt || null;
  const titleKey = account ? 'settings.connected' : connected ? 'settings.connectedNoAccount' : 'settings.notConnected';
  const titleValues = account ? { EMAIL: account } : {};
  let statusKey = 'settings.noCloud';
  let statusValues = {};
  if (cloudStatus.error) {
    statusKey = 'settings.cloudError';
    statusValues = { ERROR: cloudStatus.error };
  } else if (file && connected) {
    statusKey = 'settings.cloudFile';
    statusValues = { TIME: new Date(file.modifiedTime || Date.now()).toLocaleString() };
  } else if (file && !connected) {
    statusKey = 'settings.cloudFileNeedsConnection';
    statusValues = { TIME: new Date(file.modifiedTime || Date.now()).toLocaleString() };
  } else if (localLast) {
    statusKey = 'settings.localLast';
    statusValues = { TIME: new Date(localLast).toLocaleString() };
  }
  return { connected, account, titleKey, titleValues, statusKey, statusValues };
}
