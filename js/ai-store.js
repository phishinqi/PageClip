// AI organization is a field-level transaction, never a database snapshot rollback.
import { loadData, withDataLock, STORAGE_KEY, genId } from './store.js';
import { urlKey, tagsOf, writeTags, addTags, itemsByUrlKey } from './tag-model.js';
import { contentFingerprint, isConfirmationRecord } from './ai-confirmation.js';
export { contentFingerprint, filterConfirmedItems } from './ai-confirmation.js';

const UNDO_KEY = 'pageclip_ai_undo';
const CONFIRMATIONS_KEY = 'pageclip_ai_confirmations';
const RECEIPTS_KEY = 'pageclip_ai_receipts';
const MAX_RECEIPTS = 200;
const TTL = 24 * 60 * 60 * 1000;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = () => { throw new TypeError('Invalid AI organization plan'); };
function object(o, keys) {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail();
  for (const key of Reflect.ownKeys(o)) {
    if (!keys.includes(key) || !own(Object.getOwnPropertyDescriptor(o, key), 'value')) fail();
  }
}
function text(s, max, empty = false) {
  if (typeof s !== 'string' || s.length > max || (!empty && !s.trim()) || /[\u0000-\u001f\u007f]/.test(s)) fail();
  return s;
}
function id(s) {
  text(s, 200);
  if (['__proto__', 'prototype', 'constructor'].includes(s)) fail();
}
function tags(list, max) {
  if (!Array.isArray(list) || list.length > max) fail();
  for (const t of list) text(t, 24);
}
function snapshot(value) {
  object(value, ['url', 'title', 'note', 'folderId', 'tags']);
  text(value.url, 2048); text(value.title, 500, true);
  // Notes may contain line breaks; they are compared, never interpreted.
  if (typeof value.note !== 'string' || value.note.length > 2000) fail();
  id(value.folderId); tags(value.tags, 12);
  try { if (!['http:', 'https:', 'file:'].includes(new URL(value.url).protocol)) fail(); } catch { fail(); }
}
function validate(plan) {
  object(plan, ['operationId', 'items', 'newFolders']);
  id(plan.operationId);
  if (!Array.isArray(plan.items) || plan.items.length > 10000 || !Array.isArray(plan.newFolders) || plan.newFolders.length > 10) fail();
  const temps = new Set(), ids = new Set();
  for (const f of plan.newFolders) {
    object(f, ['tempId', 'name', 'parentFolderId']);
    id(f.tempId); text(f.name, 50);
    if (f.parentFolderId !== null) id(f.parentFolderId);
    if (temps.has(f.tempId)) fail();
    temps.add(f.tempId);
  }
  for (const entry of plan.items) {
    object(entry, ['id', 'before', 'targetFolderId', 'newFolderTempId', 'addTags', 'confirm', 'analysisFingerprint', 'analysisSnapshot', 'reason']);
    id(entry.id);
    if (ids.has(entry.id)) fail();
    ids.add(entry.id);
    snapshot(entry.before); tags(entry.addTags, 3);
    if (own(entry, 'confirm') && typeof entry.confirm !== 'boolean') fail();
    if (own(entry, 'analysisFingerprint')) text(entry.analysisFingerprint, 32768);
    if (own(entry, 'analysisSnapshot')) snapshot(entry.analysisSnapshot);
    if (own(entry, 'reason')) text(entry.reason, 200, true);
    if (own(entry, 'targetFolderId')) id(entry.targetFolderId);
    if (own(entry, 'newFolderTempId')) { id(entry.newFolderTempId); if (!temps.has(entry.newFolderTempId)) fail(); }
    if (own(entry, 'targetFolderId') && own(entry, 'newFolderTempId')) fail();
  }
}
const core = item => ({ url: item.url, title: item.title, note: item.note || '' });
const matches = (item, before) => equal(core(item), core(before));
const moveState = item => ({ ...core(item), folderId: item.folderId, order: item.order });
const live = record => record && [1, 2].includes(record.version) && !record.undone && record.expiresAt > Date.now();
async function readRecord() { return (await chrome.storage.local.get(UNDO_KEY))[UNDO_KEY]; }
async function readMap(key) {
  const value = (await chrome.storage.local.get(key))[key];
  return value?.version === 1 && value.records && typeof value.records === 'object' && !Array.isArray(value.records)
    ? { ...value.records } : {};
}
const envelope = records => ({ version: 1, records });
const placeholder = value => /(?:\[已脱敏_\d*|\[\s*REDACTED\s*\]|<\s*REDACTED\s*>|\bPAGECLIP_REDACTED(?:_[A-Z0-9]+)*\b|\bREDACTED_\d+\b|__PC_REDACTED_[A-Z0-9_]+__)/i.test(value);
function cleanConfirmations(data, records) {
  const ids = new Set(data.items.map(i => i.id));
  return Object.fromEntries(Object.entries(records).filter(([key, value]) => ids.has(key) && isConfirmationRecord(value)));
}

export async function getAiConfirmations() {
  return withDataLock(async () => {
    const data = await loadData(), before = await readMap(CONFIRMATIONS_KEY);
    const records = cleanConfirmations(data, before);
    if (!equal(before, records)) await chrome.storage.local.set({ [CONFIRMATIONS_KEY]: envelope(records) });
    return records;
  });
}

export async function getAiUndoStatus() {
  return withDataLock(async () => {
    const r = await readRecord();
    return live(r) ? { operationId: r.operationId, expiresAt: r.expiresAt } : null;
  });
}

export async function applyAiOrganization(plan) {
  validate(plan);
  // Copy before the first await so callers cannot change a validated plan mid-flight.
  plan = JSON.parse(JSON.stringify(plan));
  return withDataLock(async () => {
    const previous = await readRecord(), receipts = await readMap(RECEIPTS_KEY);
    if (own(receipts, plan.operationId)) return { ...receipts[plan.operationId].result, replayed: true };
    // The old undo format also serves as a receipt during migration.
    if (previous?.operationId === plan.operationId && previous.result) return { ...previous.result, replayed: true };
    const data = await loadData(), now = Date.now(), index = itemsByUrlKey(data);
    const confirmations = cleanConfirmations(data, await readMap(CONFIRMATIONS_KEY));
    const byId = new Map(data.items.map(i => [i.id, i]));
    const record = { version: 2, operationId: plan.operationId, expiresAt: now + TTL, undone: false,
      moves: [], tags: [], folders: [], confirmations: [] };
    const result = { operationId: plan.operationId, moved: 0, tagged: 0, createdFolders: 0,
      confirmed: 0, skipped: 0, replayed: false, items: [] };
    const pendingConfirmations = [];

    const destinations = new Map(), tagRequests = new Map();
    const resolveFolder = entry => {
      if (own(entry, 'targetFolderId')) return data.folders.find(f => f.id === entry.targetFolderId)?.id;
      if (!own(entry, 'newFolderTempId')) return undefined;
      if (destinations.has(entry.newFolderTempId)) return destinations.get(entry.newFolderTempId);
      const spec = plan.newFolders.find(f => f.tempId === entry.newFolderTempId);
      if (spec.parentFolderId !== null && !data.folders.some(f => f.id === spec.parentFolderId && !f.system)) return undefined;
      let folder = data.folders.find(f => !f.system && (f.parentId || null) === spec.parentFolderId && f.name === spec.name.trim());
      if (!folder) {
        folder = { id: genId('f'), name: spec.name.trim(), parentId: spec.parentFolderId,
          order: Math.max(-1, ...data.folders.filter(f => (f.parentId || null) === spec.parentFolderId).map(f => Number(f.order) || 0)) + 1, createdAt: now };
        data.folders.push(folder); record.folders.push({ ...folder }); result.createdFolders++;
      }
      destinations.set(entry.newFolderTempId, folder.id);
      return folder.id;
    };
    const moves = [];
    for (const entry of plan.items) {
      const status = { id: entry.id, moved: false, tagged: false, confirmed: false, skipped: 0 };
      result.items.push(status);
      const skip = reason => { result.skipped++; status.skipped++; status.reason ||= reason; };
      const item = byId.get(entry.id);
      if (!item) { skip('missing'); continue; }
      // Capture the analysis guard before any selected move or shared-tag write runs.
      const beforeFingerprint = contentFingerprint(entry.before, entry.before.tags);
      const analysisFingerprint = entry.analysisFingerprint ?? (entry.analysisSnapshot
        ? contentFingerprint(entry.analysisSnapshot, entry.analysisSnapshot.tags) : beforeFingerprint);
      const snapshotMatches = analysisFingerprint === beforeFingerprint &&
        (!entry.analysisSnapshot || contentFingerprint(entry.analysisSnapshot, entry.analysisSnapshot.tags) === analysisFingerprint) &&
        contentFingerprint(item, tagsOf(data, item.url, index)) === analysisFingerprint;
      let unsafe = entry.addTags.some(placeholder) || (own(entry, 'reason') && placeholder(entry.reason));
      if (own(entry, 'newFolderTempId')) {
        unsafe ||= placeholder(plan.newFolders.find(f => f.tempId === entry.newFolderTempId).name);
      }
      // Reject selected placeholder-bearing writes before creating folders or
      // collecting moves/tags, even for entries not selected for confirmation.
      if (unsafe) { skip('redacted-output'); continue; }
      if (own(entry, 'targetFolderId') || own(entry, 'newFolderTempId')) {
        if (!matches(item, entry.before) || item.folderId !== entry.before.folderId) skip('folder-conflict');
        else {
          const target = resolveFolder(entry);
          if (!target) skip('missing-folder');
          else if (target !== item.folderId) moves.push({ item, target, status });
        }
      }
      if (entry.addTags.length) {
        const key = urlKey(item.url);
        if (!matches(item, entry.before) || !equal(tagsOf(data, key, index), entry.before.tags)) skip('tags-conflict');
        else {
          const request = tagRequests.get(key) || { additions: [], statuses: [] };
          request.additions.push(...entry.addTags); request.statuses.push(status); tagRequests.set(key, request);
        }
      }
      if (entry.confirm === true) {
        if (!snapshotMatches) { if (!status.skipped) skip('content-conflict'); }
        else if (unsafe) { if (!status.skipped) skip('redacted-output'); }
        else if (!status.skipped) pendingConfirmations.push({ item, status });
      }
    }
    // Sort by original order, not by the AI response's ordering. Only moved entries get new orders.
    moves.sort((a, b) => (Number(a.item.order) || 0) - (Number(b.item.order) || 0) || data.items.indexOf(a.item) - data.items.indexOf(b.item));
    for (const { item, target, status } of moves) {
      const before = moveState(item);
      const order = Math.max(-1, ...data.items.filter(i => i.folderId === target).map(i => Number(i.order) || 0)) + 1;
      item.folderId = target; item.order = order; item.updatedAt = now;
      record.moves.push({ id: item.id, before, after: moveState(item) }); result.moved++; status.moved = true;
    }
    for (const [key, { additions, statuses }] of tagRequests) {
      const before = [...tagsOf(data, key, index)], after = addTags(before, additions.slice(0, 3)).tags;
      if (equal(before, after)) continue;
      const owners = (index.get(key) || []).map(i => ({ id: i.id, ...core(i), tags: [...(i.tags || [])] }));
      writeTags(data, key, after, index, now);
      record.tags.push({ key, before, after, owners }); result.tagged++;
      statuses.forEach(status => { status.tagged = true; });
    }
    // Shared URL tags can change several items. Fingerprint only after all writes.
    for (const { item, status } of pendingConfirmations) {
      const after = { version: 1, operationId: plan.operationId, confirmedAt: now,
        fingerprint: contentFingerprint(item, tagsOf(data, item.url, index)) };
      record.confirmations.push({ id: item.id, before: own(confirmations, item.id) ? confirmations[item.id] : null, after });
      confirmations[item.id] = after; status.confirmed = true; result.confirmed++;
    }
    record.result = result;
    receipts[plan.operationId] = { at: now, result };
    for (const key of Object.keys(receipts).slice(0, Math.max(0, Object.keys(receipts).length - MAX_RECEIPTS))) delete receipts[key];
    // No-change receipts must survive restarts without consuming the previous undo.
    const undo = result.moved || result.tagged || result.confirmed ? record : previous;
    await chrome.storage.local.set({ [STORAGE_KEY]: data, [CONFIRMATIONS_KEY]: envelope(confirmations),
      [RECEIPTS_KEY]: envelope(receipts), [UNDO_KEY]: undo || null });

    return result;
  });
}

export async function undoAiOrganization(operationId) {
  id(operationId);
  return withDataLock(async () => {
    const r = await readRecord();
    const result = { operationId, restoredMoves: 0, restoredTags: 0, restoredConfirmations: 0, removedFolders: 0, skipped: 0 };
    if (!live(r) || r.operationId !== operationId) return result;
    const data = await loadData(), now = Date.now(), index = itemsByUrlKey(data);
    const confirmations = cleanConfirmations(data, await readMap(CONFIRMATIONS_KEY));
    // Check against the operation's post-state before undoing any moves or tags.
    const restorable = [];
    for (const change of r.confirmations || []) {
      const item = data.items.find(i => i.id === change.id);
      if (!item || !equal(confirmations[change.id], change.after) ||
          confirmations[change.id]?.operationId !== operationId ||
          contentFingerprint(item, tagsOf(data, item.url, index)) !== change.after.fingerprint) {
        result.skipped++; continue;
      }
      restorable.push(change);
    }
    for (const change of r.moves) {
      const item = data.items.find(i => i.id === change.id);
      if (!item || !equal(moveState(item), change.after) || !data.folders.some(f => f.id === change.before.folderId)) { result.skipped++; continue; }
      item.folderId = change.before.folderId; item.order = change.before.order; item.updatedAt = now; result.restoredMoves++;
    }
    for (const change of r.tags) {
      const owners = index.get(change.key) || [];
      if (owners.length !== change.owners.length || !equal(tagsOf(data, change.key, index), change.after) ||
          change.owners.some(old => !owners.some(i => i.id === old.id && matches(i, old) && equal(i.tags || [], change.after)))) {
        result.skipped++; continue;
      }
      // Duplicate URL owners may have had different tags; restore each one's own fields.
      for (const old of change.owners) {
        const item = owners.find(i => i.id === old.id);
        if (!equal(item.tags || [], old.tags)) { item.tags = [...old.tags]; item.updatedAt = now; }
      }
      result.restoredTags++;
    }
    for (const created of r.folders) {
      const folder = data.folders.find(f => f.id === created.id);
      if (folder && equal(folder, created) && !data.items.some(i => i.folderId === folder.id) && !data.folders.some(f => f.parentId === folder.id)) {
        data.folders.splice(data.folders.indexOf(folder), 1); result.removedFolders++;
      }
    }
    for (const change of restorable) {
      if (change.before) confirmations[change.id] = change.before;
      else delete confirmations[change.id];
      result.restoredConfirmations++;
    }
    // Consume even a conflicted undo: retries cannot resurrect an operation later.
    r.undone = true;
    await chrome.storage.local.set({ [STORAGE_KEY]: data, [CONFIRMATIONS_KEY]: envelope(confirmations), [UNDO_KEY]: r });
    return result;
  });
}
