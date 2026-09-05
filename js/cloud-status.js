export function getCloudCardState(cloudStatus = {}, cloudSettings = {}) {
  const authorizationRequired = Boolean(cloudStatus.authorizationRequired);
  const connected = Boolean(cloudStatus.connected);
  const account = (connected || authorizationRequired) ? (cloudStatus.account?.email || '') : '';
  const file = cloudStatus.file || null;
  const localLast = cloudSettings.lastBackupAt || null;
  const titleKey = authorizationRequired ? 'settings.authorizationRequired' : account ? 'settings.connected' : connected ? 'settings.connectedNoAccount' : 'settings.notConnected';
  const titleValues = account && !authorizationRequired ? { EMAIL: account } : {};
  let statusKey = 'settings.noCloud';
  let statusValues = {};
  if (authorizationRequired) {
    statusKey = account ? 'settings.authorizationRequiredAccount' : 'settings.authorizationRequiredHint';
    statusValues = account ? { EMAIL: account } : {};
  } else if (cloudStatus.error) {
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
  return { connected, authorizationRequired, account, titleKey, titleValues, statusKey, statusValues };
}
