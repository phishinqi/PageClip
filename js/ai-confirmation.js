// Confirmation identity is local and independent of display order and timestamps.
import { normalizeTags, tagKey, tagsOf, itemsByUrlKey } from './tag-model.js';

export function contentFingerprint(item, effectiveTags = item.tags || []) {
  return `v1:${JSON.stringify([
    item.url || '', item.title || '', item.note || '', item.folderId || '',
    normalizeTags(effectiveTags).map(tagKey).sort(),
  ])}`;
}

export function isConfirmationRecord(record) {
  return !!record && record.version === 1 && typeof record.operationId === 'string' &&
    !!record.operationId && Number.isFinite(record.confirmedAt) &&
    typeof record.fingerprint === 'string' && record.fingerprint.startsWith('v1:');
}

// Return the items still needing analysis; stale confirmations never hide edits.
export function filterConfirmedItems(data, records = {}) {
  const index = itemsByUrlKey(data);
  return (data.items || []).filter(item => {
    const record = Object.prototype.hasOwnProperty.call(records, item.id) ? records[item.id] : null;
    return !isConfirmationRecord(record) || record.fingerprint !== contentFingerprint(item, tagsOf(data, item.url, index));
  });
}
