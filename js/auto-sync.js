// 自动化共用规则：只比较会进入云备份的 PageClip 内容，避免设置/状态写入触发备份循环。
export const AUTO_BACKUP_DEBOUNCE_MS = 10 * 1000;

function backupContent(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    folders: value.folders || [],
    items: value.items || [],
    quickAccess: value.quickAccess || [],
    inbox: value.inbox || [],
    recycleBin: value.recycleBin || [],
  };
}

export function hasBackupRelevantChange(before, after) {
  return JSON.stringify(backupContent(before)) !== JSON.stringify(backupContent(after));
}
