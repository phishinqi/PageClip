// Vendor-independent causal protocol. Time is presentation only; revisions are UUIDs.
export const SYNC_PROTOCOL = 1;
export const SYNC_FIELDS = ['folders', 'items', 'quickAccess', 'inbox'];
export const clone = (v) => JSON.parse(JSON.stringify(v));
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function project(data) {
  const records = {};
  for (const field of SYNC_FIELDS) for (const raw of data[field] || []) {
    if (raw.system) continue;
    const value = clone(raw);
    delete value.chromeBookmarkIds; // Browser bookmark IDs never cross devices.
    records[field + '/' + value.id] = value;
  }
  for (const [url, tags] of Object.entries(data.urlTags || {})) records['urlTags/' + url] = tags;
  // Credentials, UI state, AI configuration and recycle retention are device-local.
  if (data.settings?.tagRules) records['rules/default'] = clone(data.settings.tagRules);
  return records;
}
export function stateOf(data) {
  return data._sync ||= { protocol: 1, device: crypto.randomUUID(), sequence: 0, ops: {}, outbox: [], view: {}, conflicts: {}, enabled: false, failures: 0 };
}
function headMap(state) {
  const groups = new Map(), ancestors = new Set();
  for (const op of Object.values(state.ops)) {
    if (!groups.has(op.key)) groups.set(op.key, []);
    groups.get(op.key).push(op);
    op.parents.forEach(id => ancestors.add(id));
  }
  for (const [key, values] of groups) groups.set(key, values.filter(op => !ancestors.has(op.id)).sort((a, b) => a.id.localeCompare(b.id)));
  return groups;
}
export function heads(state, key) { return headMap(state).get(key) || []; }
function makeOperation(state, key, value, parents) {
  const op = { protocol: 1, id: crypto.randomUUID(), device: state.device, sequence: ++state.sequence, key, parents, value: clone(value), modifiedAt: Date.now() };
  state.ops[op.id] = op;
  state.outbox.push(op.id);
  return op;
}
export function capture(data) {
  const state = stateOf(data);
  const records = project(data);
  const byKey = headMap(state);
  for (const key of new Set([...Object.keys(records), ...Object.keys(state.view)])) {
    const value = records[key] ?? null;
    const signature = canonical(value);
    if ((state.view[key] ?? 'null') === signature) continue;
    const current = byKey.get(key) || [];
    // Editing during a conflict advances only the locally displayed branch.
    const parents = current.filter(op => current.length === 1 || canonical(op.value) === state.view[key]).map(op => op.id);
    makeOperation(state, key, value, parents);
    state.view[key] = signature;
  }
  refreshConflicts(state);
  return state;
}
function refreshConflicts(state) {
  state.conflicts = {};
  for (const [key, tips] of headMap(state)) {
    if (new Set(tips.map(op => canonical(op.value))).size > 1) state.conflicts[key] = tips.map(op => op.id);
  }
}
export function validateOperation(op) {
  const fail = () => { const error = new Error('同步数据格式不兼容或损坏'); error.kind = 'format'; throw error; };
  if (!op || op.protocol !== 1 || typeof op.id !== 'string' || !/^[\w-]{1,100}$/.test(op.id) || typeof op.device !== 'string' || !Number.isSafeInteger(op.sequence) || op.sequence < 1 || !Array.isArray(op.parents) || op.parents.some(id => typeof id !== 'string' || id === op.id) || typeof op.key !== 'string' || !Object.hasOwn(op, 'value')) fail();
  const split = op.key.indexOf('/'); const field = op.key.slice(0, split); const id = op.key.slice(split + 1);
  if (split < 1 || !id || ![...SYNC_FIELDS, 'urlTags', 'rules'].includes(field)) fail();
  if (op.value !== null) {
    const v = op.value;
    if (SYNC_FIELDS.includes(field) && (!v || typeof v !== 'object' || Array.isArray(v) || v.id !== id || v.system || id === 'f_uncategorized')) fail();
    if (['items', 'inbox'].includes(field) && op.value && !safeUrl(v.url)) fail();
    if (field === 'quickAccess' && (v.type === 'group' ? !Array.isArray(v.tabs) || v.tabs.some(t => !safeUrl(t?.url)) : !safeUrl(v.url))) fail();
    if (field === 'folders' && (typeof v.name !== 'string' || (v.parentId !== null && typeof v.parentId !== 'string'))) fail();
    if (field === 'urlTags' && (!Array.isArray(v) || v.some(t => typeof t !== 'string'))) fail();
    if (field === 'rules' && (id !== 'default' || !v || typeof v !== 'object' || Array.isArray(v))) fail();
  }
}
function safeUrl(value) { try { return ['http:', 'https:', 'file:'].includes(new URL(value).protocol); } catch { return false; } }
function applyValue(data, key, value) {
  const split = key.indexOf('/'), field = key.slice(0, split), id = key.slice(split + 1);
  if (SYNC_FIELDS.includes(field)) {
    const local = (data[field] || []).find(v => v.id === id);
    data[field] = (data[field] || []).filter(v => v.id !== id);
    if (value !== null) data[field].push({ ...clone(value), ...(field === 'items' ? { chromeBookmarkIds: local?.chromeBookmarkIds || [] } : {}) });
  } else if (field === 'urlTags') {
    data.urlTags ||= {};
    if (value === null) delete data.urlTags[id]; else data.urlTags[id] = clone(value);
  } else {
    data.settings ||= {};
    if (value === null) delete data.settings.tagRules; else data.settings.tagRules = clone(value);
  }
}
export function ingest(data, incoming) {
  const state = capture(data);
  const merged = { ...state.ops };
  for (const op of incoming) {
    validateOperation(op);
    if (merged[op.id] && canonical(merged[op.id]) !== canonical(op)) throw Object.assign(new Error('同步版本身份冲突'), { kind: 'format' });
    merged[op.id] = clone(op);
  }
  // Missing dependencies are never interpreted as deletions. Retry a complete listing.
  for (const op of Object.values(merged)) for (const id of op.parents) {
    if (!merged[id] || merged[id].key !== op.key) throw Object.assign(new Error('同步日志缺少父版本，请重新校准'), { kind: 'retry' });
  }
  // Reject cycles before changing the materialized data.
  const done = new Set(), active = new Set();
  for (const root of Object.keys(merged)) {
    const stack = [[root, false]];
    while (stack.length) {
      const [id, leaving] = stack.pop();
      if (leaving) { active.delete(id); done.add(id); continue; }
      if (done.has(id)) continue;
      if (active.has(id)) throw Object.assign(new Error('同步日志存在循环'), { kind: 'format' });
      active.add(id); stack.push([id, true]);
      for (const parent of merged[id].parents) stack.push([parent, false]);
    }
  }
  state.ops = merged;
  refreshConflicts(state);
  const changes = new Map();
  for (const [key, tips] of headMap(state)) {
    if (state.conflicts[key]) continue;
    const value = tips[0].value;
    if (state.view[key] !== canonical(value)) changes.set(key, value);
    state.view[key] = canonical(value);
  }
  // One map/pass per collection rather than filter the full array for every op.
  for (const field of SYNC_FIELDS) {
    const values = new Map((data[field] || []).map(v => [v.id, v]));
    for (const [key, value] of changes) if (key.startsWith(field + '/')) {
      const id = key.slice(field.length + 1), local = values.get(id);
      if (value === null) values.delete(id);
      else values.set(id, { ...clone(value), ...(field === 'items' ? { chromeBookmarkIds: local?.chromeBookmarkIds || [] } : {}) });
    }
    data[field] = [...values.values()];
  }
  for (const [key, value] of changes) if (!SYNC_FIELDS.some(f => key.startsWith(f + '/'))) applyValue(data, key, value);
  repairRelationships(data, state);
  return state;
}
function repairRelationships(data, state) {
  const folders = new Map((data.folders || []).map(f => [f.id, f]));
  const repair = (field, value, property, fallback) => {
    const key = field + '/' + value.id;
    const projected = clone(value); delete projected.chromeBookmarkIds;
    const source = heads(state, key).find(op => canonical(op.value) === canonical(projected));
    if (!source) return;
    // A deterministic concurrent alternative preserves the original relation in
    // a visible conflict instead of silently discarding it or stalling all sync.
    const safe = { ...projected, [property]: fallback };
    const id = source.id + '-repair';
    if (!state.ops[id]) {
      state.ops[id] = { ...clone(source), id, parents: [], value: safe };
      state.outbox.push(id);
    }
    applyValue(data, key, safe);
    state.view[key] = canonical(safe);
  };
  for (const f of [...folders.values()].sort((a,b) => a.id.localeCompare(b.id))) {
    if (f.system || !f.parentId) continue;
    let current = f, seen = new Set();
    while (current && !seen.has(current.id)) { seen.add(current.id); current = folders.get(current.parentId); }
    if (!folders.has(f.parentId) || current) {
      repair('folders', f, 'parentId', null);
      folders.set(f.id, { ...f, parentId: null });
    }
  }
  for (const item of [...(data.items || [])]) if (!folders.has(item.folderId)) repair('items', item, 'folderId', 'f_uncategorized');
  refreshConflicts(state);
}
function validateFolderTree(data) {
  const byId = new Map((data.folders || []).map(f => [f.id, f]));
  for (const folder of byId.values()) {
    const seen = new Set(); let current = folder;
    while (current) {
      if (seen.has(current.id)) throw Object.assign(new Error('同步文件夹存在循环，已保留本地数据'), { kind: 'format' });
      seen.add(current.id); current = byId.get(current.parentId);
    }
  }
}
export function resolveConflict(data, key, revision) {
  const state = capture(data), tips = heads(state, key);
  const chosen = tips.find(op => op.id === revision);
  if (!chosen || !state.conflicts[key]) throw new Error('冲突版本已变化，请刷新');
  makeOperation(state, key, chosen.value, tips.map(op => op.id));
  applyValue(data, key, chosen.value);
  state.view[key] = canonical(chosen.value);
  refreshConflicts(state);
  validateFolderTree(data);
}
