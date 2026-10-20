import assert from 'node:assert/strict';
import { defaultData, STORAGE_KEY, withDataLock } from '../js/store.js';
import { applyAiOrganization, undoAiOrganization, getAiUndoStatus, getAiConfirmations, contentFingerprint, filterConfirmedItems } from '../js/ai-store.js';

const clone = value => structuredClone(value);
let saved, writes, writeLog, rejectWrite, clock = 1700000000000;
const realNow = Date.now;
Date.now = () => clock;
globalThis.chrome = { storage: { local: {
  async get(key) { return { [key]: clone(saved[key]) }; },
  async set(value) {
    if (rejectWrite) throw new Error('storage write failed');
    if ('bc_data' in value) assert.ok('pageclip_ai_confirmations' in value);
    writes++; writeLog.push(clone(value)); Object.assign(saved, clone(value));
  },
} } };
const item = id => saved.bc_data.items.find(i => i.id === id);
function reset() {
  clock = 1700000000000;
  const data = defaultData();
  data.folders.push(...['a', 'b'].map((id, order) => ({ id, name: id, parentId: null, order: order + 1 })));
  data.items = ['one', 'two', 'three'].map((id, order) => ({ id, url: `https://${id}.example/`, title: id,
    note: '', folderId: 'a', tags: [], order: order + 4, createdAt: 1, updatedAt: 2, pinned: false }));
  data.items.push({ ...clone(data.items[0]), id: 'resident', url: 'https://resident.example/', folderId: 'b', order: 20 });
  saved = { [STORAGE_KEY]: data }; writes = 0; writeLog = []; rejectWrite = false;
}
function entry(id, extra = {}) {
  const i = item(id);
  return { id, before: { url: i.url, title: i.title, note: i.note, folderId: i.folderId, tags: [...i.tags] }, addTags: [], ...extra };
}
const plan = (items, newFolders = [], operationId = 'op') => ({ operationId, items, newFolders });
async function test(name, fn) {
  reset(); await fn(); console.log(`PASS ${name}`);
}
try {
  await test('atomic apply, append original order, narrow undo and replay', async () => {
    const original = clone(saved.bc_data);
    const p = plan([entry('two', { targetFolderId: 'b', addTags: ['AI'] }), entry('one', { targetFolderId: 'b' })]);
    const result = await applyAiOrganization(p);
    assert.deepEqual(result, { operationId: 'op', moved: 2, tagged: 1, createdFolders: 0, confirmed: 0, skipped: 0, replayed: false,
      items: [{ id: 'two', moved: true, tagged: true, confirmed: false, skipped: 0 },
        { id: 'one', moved: true, tagged: false, confirmed: false, skipped: 0 }] });
    assert.equal(writes, 1); assert.equal(item('one').order, 21); assert.equal(item('two').order, 22);
    assert.deepEqual(item('resident'), original.items[3]); assert.deepEqual(item('three'), original.items[2]);
    assert.deepEqual(await getAiUndoStatus(), { operationId: 'op', expiresAt: clock + 86400000 });
    assert.equal((await applyAiOrganization(p)).replayed, true); assert.equal(writes, 1);
    item('one').pinned = true; item('one').updatedAt = 90;
    saved.bc_data.settings.userEdit = 'kept'; clock++;
    const undo = await undoAiOrganization('op');
    assert.deepEqual(undo, { operationId: 'op', restoredMoves: 2, restoredTags: 1, restoredConfirmations: 0, removedFolders: 0, skipped: 0 });
    assert.equal(item('one').folderId, 'a'); assert.equal(item('one').order, 4);
    assert.equal(item('one').pinned, true); assert.equal(item('one').updatedAt, clock);
    assert.equal(saved.bc_data.settings.userEdit, 'kept'); assert.equal(await getAiUndoStatus(), null);
    await undoAiOrganization('op'); await applyAiOrganization(p); assert.equal(writes, 2);
  });
  await test('classification and tags have independent preconditions', async () => {
    const a = entry('one', { targetFolderId: 'b', addTags: ['new'] });
    const b = entry('two', { targetFolderId: 'b', addTags: ['new'] });
    item('one').folderId = 'b'; item('two').tags = ['manual'];
    const result = await applyAiOrganization(plan([a, b]));
    assert.equal(result.moved, 1); assert.equal(result.tagged, 1); assert.equal(result.skipped, 2);
    assert.deepEqual(item('one').tags, ['new']); assert.deepEqual(item('two').tags, ['manual']);
  });
  for (const field of ['url', 'title', 'note']) {
    await test(`changed ${field} blocks both operations but persists a replay receipt`, async () => {
      const p = plan([entry('one', { targetFolderId: 'b', addTags: ['new'] })]);
      item('one')[field] += 'changed';
      assert.equal((await applyAiOrganization(p)).skipped, 2); assert.equal(writes, 1);
      assert.equal((await applyAiOrganization(p)).replayed, true); assert.equal(writes, 1);
    });
  }
  await test('unchecked classification and no-op persist receipts without changing data', async () => {
    const original = clone(saved.bc_data);
    await applyAiOrganization(plan([entry('one')])); assert.equal(writes, 1);
    assert.deepEqual(saved.bc_data, original);
    await applyAiOrganization(plan([entry('one', { addTags: ['tag'] })], [], 'op2'));
    assert.equal(item('one').folderId, 'a'); assert.equal(writes, 2);
  });
  await test('used folders only, reuse sibling name, cleanup empty unchanged folder', async () => {
    const folders = [{ tempId: 'used', name: 'Research', parentFolderId: 'a' }, { tempId: 'unused', name: 'Unused', parentFolderId: null }];
    const r = await applyAiOrganization(plan([entry('one', { newFolderTempId: 'used' }), entry('two', { newFolderTempId: 'used' })], folders));
    assert.equal(r.createdFolders, 1); const created = item('one').folderId;
    assert.equal(item('two').folderId, created); assert.equal(saved.bc_data.folders.some(f => f.name === 'Unused'), false);
    assert.equal((await undoAiOrganization('op')).removedFolders, 1);
    saved.bc_data.folders.push({ id: 'existing', name: 'Research', parentId: 'a', order: 4 });
    assert.equal((await applyAiOrganization(plan([entry('one', { newFolderTempId: 'used' })], folders, 'op2'))).createdFolders, 0);
    assert.equal(item('one').folderId, 'existing');
  });
  for (const modification of ['rename', 'child', 'occupant']) {
    await test(`created folder preserved with ${modification}`, async () => {
      await applyAiOrganization(plan([entry('one', { newFolderTempId: 'new' })], [{ tempId: 'new', name: 'New', parentFolderId: null }]));
      const id = item('one').folderId;
      if (modification === 'rename') saved.bc_data.folders.find(f => f.id === id).name = 'Edited';
      if (modification === 'child') saved.bc_data.folders.push({ id: 'child', name: 'Child', parentId: id });
      if (modification === 'occupant') item('three').folderId = id;
      assert.equal((await undoAiOrganization('op')).removedFolders, 0);
      assert.ok(saved.bc_data.folders.some(f => f.id === id));
    });
  }
  await test('invalid parent or removed destination skips without creating folders', async () => {
    const folders = [{ tempId: 'bad', name: 'Bad', parentFolderId: 'f_uncategorized' }];
    const r = await applyAiOrganization(plan([entry('one', { newFolderTempId: 'bad' }), entry('two', { targetFolderId: 'missing' })], folders));
    assert.equal(r.skipped, 2); assert.equal(writes, 1);
  });
  await test('URL shared tags, 12 limit and restore all owners', async () => {
    item('two').url = item('one').url; item('one').tags = Array.from({ length: 11 }, (_, i) => `tag${i}`); item('two').tags = [...item('one').tags];
    await applyAiOrganization(plan([entry('one', { addTags: ['new', 'overflow', 'third'] })]));
    assert.equal(item('one').tags.length, 12); assert.deepEqual(item('two').tags, item('one').tags);
    assert.equal((await undoAiOrganization('op')).restoredTags, 1); assert.equal(item('two').tags.length, 11);
  });
  await test('undo independently skips folder conflict but restores tags', async () => {
    await applyAiOrganization(plan([entry('one', { targetFolderId: 'b', addTags: ['new'] })]));
    item('one').folderId = 'f_uncategorized';
    const r = await undoAiOrganization('op'); assert.equal(r.restoredMoves, 0); assert.equal(r.restoredTags, 1);
    assert.equal(item('one').folderId, 'f_uncategorized');
  });
  await test('undo missing original folder and edited tags are no-op', async () => {
    await applyAiOrganization(plan([entry('one', { targetFolderId: 'b', addTags: ['new'] })]));
    saved.bc_data.folders = saved.bc_data.folders.filter(f => f.id !== 'a'); item('one').tags.push('manual');
    const r = await undoAiOrganization('op'); assert.equal(r.skipped, 2); assert.equal(writes, 2);
  });
  await test('undo detects shared URL owner changes', async () => {
    item('two').url = item('one').url;
    await applyAiOrganization(plan([entry('one', { addTags: ['new'] })]));
    item('two').title = 'edited';
    assert.equal((await undoAiOrganization('op')).restoredTags, 0); assert.equal(writes, 2);
  });
  await test('latest persisted operation, wrong id, 24h expiry', async () => {
    await applyAiOrganization(plan([entry('one', { addTags: ['first'] })]));
    await applyAiOrganization(plan([entry('two', { addTags: ['second'] })], [], 'latest'));
    assert.equal((await getAiUndoStatus()).operationId, 'latest');
    await undoAiOrganization('op'); assert.equal(writes, 2);
    clock += 86400000; assert.equal(await getAiUndoStatus(), null);
    await undoAiOrganization('latest'); assert.equal(writes, 2);
  });
  await test('concurrent repeats serialized by store lock', async () => {
    const p = plan([entry('one', { addTags: ['new'] })]);
    const [a, b] = await Promise.all([applyAiOrganization(p), applyAiOrganization(p)]);
    assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(writes, 1);
    await withDataLock(async () => { item('three').note = 'user'; });
    await undoAiOrganization('op'); assert.equal(item('three').note, 'user');
  });
  await test('confirmation-only transaction persists, filters, replays after reload and undoes', async () => {
    const original = clone(saved.bc_data);
    const p = plan([entry('one', { confirm: true }), entry('two', { confirm: false }), entry('three')]);
    const result = await applyAiOrganization(p);
    assert.equal(result.confirmed, 1); assert.equal(result.items[0].confirmed, true);
    assert.equal(result.items[1].confirmed, false); assert.equal(result.items[2].confirmed, false);
    assert.deepEqual(saved.bc_data, original);
    assert.deepEqual(Object.keys(writeLog[0]).sort(), ['bc_data', 'pageclip_ai_confirmations', 'pageclip_ai_receipts', 'pageclip_ai_undo']);
    const records = await getAiConfirmations();
    assert.deepEqual(records.one, { version: 1, operationId: 'op', confirmedAt: clock,
      fingerprint: contentFingerprint(item('one'), []) });
    assert.deepEqual(filterConfirmedItems(saved.bc_data, records).map(i => i.id), ['two', 'three', 'resident']);
    const reloaded = await import(`../js/ai-store.js?reload=${clock}`);
    assert.equal((await reloaded.applyAiOrganization(p)).replayed, true); assert.equal(writes, 1);
    const undo = await reloaded.undoAiOrganization('op');
    assert.equal(undo.restoredConfirmations, 1); assert.deepEqual(await getAiConfirmations(), {});
    assert.deepEqual(saved.bc_data, original); assert.equal(await getAiUndoStatus(), null);
    assert.equal((await applyAiOrganization(p)).replayed, true);
    assert.deepEqual(await getAiConfirmations(), {}); assert.equal(writes, 2);
  });
  await test('fingerprint includes full content and normalized tags but ignores presentation metadata', async () => {
    const base = { ...item('one'), url: 'https://one.example/?secret=value#fragment', tags: ['Work', ' Other ', '#WORK'] };
    const fingerprint = contentFingerprint(base);
    assert.equal(contentFingerprint({ ...base, order: 999, updatedAt: 99, pinned: true }, ['other', 'work']), fingerprint);
    for (const field of ['url', 'title', 'note', 'folderId']) {
      assert.notEqual(contentFingerprint({ ...base, [field]: `${base[field]}edited` }), fingerprint);
    }
    assert.notEqual(contentFingerprint(base, ['work']), fingerprint);
    await applyAiOrganization(plan([entry('one', { confirm: true })]));
    const records = await getAiConfirmations();
    item('one').order = 999; item('one').updatedAt = 99; item('one').pinned = true;
    assert.equal(filterConfirmedItems(saved.bc_data, records).some(i => i.id === 'one'), false);
    item('one').url += '?q=changed';
    assert.equal(filterConfirmedItems(saved.bc_data, records).some(i => i.id === 'one'), true);
  });
  for (const field of ['url', 'title', 'note', 'folderId', 'tags']) {
    await test(`confirmation rejects stale ${field} including when no fields were selected`, async () => {
      const p = plan([entry('one', { confirm: true })]);
      if (field === 'tags') item('one').tags.push('manual');
      else item('one')[field] += 'edited';
      const result = await applyAiOrganization(p);
      assert.equal(result.confirmed, 0); assert.equal(result.items[0].reason, 'content-conflict');
      assert.deepEqual(await getAiConfirmations(), {});
    });
  }
  await test('explicit analysis fingerprint and snapshot prevent refreshed before from hiding stale analysis', async () => {
    const snapshot = entry('one').before, fingerprint = contentFingerprint(snapshot, snapshot.tags);
    item('one').title = 'manual edit';
    let result = await applyAiOrganization(plan([entry('one', { confirm: true, analysisFingerprint: fingerprint })]));
    assert.equal(result.confirmed, 0);
    result = await applyAiOrganization(plan([entry('one', { confirm: true, analysisSnapshot: snapshot })], [], 'snapshot'));
    assert.equal(result.confirmed, 0);
    const current = entry('one').before;
    result = await applyAiOrganization(plan([entry('one', { confirm: true, analysisSnapshot: current,
      analysisFingerprint: contentFingerprint(current, current.tags) })], [], 'current'));
    assert.equal(result.confirmed, 1);
  });
  await test('confirmation accepts normalized tag order differences without modifying content', async () => {
    item('one').tags = ['Work', 'Other'];
    const p = plan([entry('one', { confirm: true })]);
    item('one').tags = ['other', '#Work']; item('one').updatedAt++;
    assert.equal((await applyAiOrganization(p)).confirmed, 1);
  });
  await test('selected-field conflicts block confirmation while successful independent fields still apply', async () => {
    const one = entry('one', { confirm: true, targetFolderId: 'b', addTags: ['new'] });
    const two = entry('two', { confirm: true, targetFolderId: 'b', addTags: ['new'] });
    item('one').folderId = 'f_uncategorized'; item('two').tags = ['manual'];
    const result = await applyAiOrganization(plan([one, two]));
    assert.equal(result.confirmed, 0); assert.equal(result.moved, 1); assert.equal(result.tagged, 1);
    assert.equal(result.items[0].tagged, true); assert.equal(result.items[1].moved, true);
    assert.deepEqual(await getAiConfirmations(), {});
  });
  await test('shared URL confirmations fingerprint the final effective tags after all modifications', async () => {
    item('two').url = item('one').url;
    const result = await applyAiOrganization(plan([entry('one', { confirm: true }),
      entry('two', { confirm: true, targetFolderId: 'b', addTags: ['Shared'] })]));
    assert.equal(result.confirmed, 2);
    const records = await getAiConfirmations();
    for (const id of ['one', 'two']) assert.equal(records[id].fingerprint, contentFingerprint(item(id), ['Shared']));
    assert.equal(filterConfirmedItems(saved.bc_data, records).length, 2);
    const undo = await undoAiOrganization('op');
    assert.equal(undo.restoredConfirmations, 2); assert.equal(undo.restoredTags, 1); assert.equal(undo.restoredMoves, 1);
    assert.deepEqual(await getAiConfirmations(), {});
  });
  await test('effective shared URL tags override a duplicate owner own tags when checking confirmations', async () => {
    item('two').url = item('one').url; item('one').tags = ['effective']; item('two').tags = ['stale'];
    const e = entry('two', { confirm: true }); e.before.tags = ['effective'];
    assert.equal((await applyAiOrganization(plan([e]))).confirmed, 1);
    const records = await getAiConfirmations();
    assert.equal(filterConfirmedItems(saved.bc_data, records).some(i => i.id === 'two'), false);
    item('one').tags = ['changed'];
    assert.equal(filterConfirmedItems(saved.bc_data, records).some(i => i.id === 'two'), true);
    assert.equal((await undoAiOrganization('op')).restoredConfirmations, 0);
  });
  await test('undo restores a previous confirmation with its original content after move and tag rollback', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true })], [], 'previous'));
    const previous = clone((await getAiConfirmations()).one); clock++;
    await applyAiOrganization(plan([entry('one', { confirm: true, targetFolderId: 'b', addTags: ['new'] })]));
    assert.equal((await getAiConfirmations()).one.operationId, 'op');
    const undo = await undoAiOrganization('op');
    assert.equal(undo.restoredConfirmations, 1); assert.equal(undo.restoredMoves, 1); assert.equal(undo.restoredTags, 1);
    assert.deepEqual((await getAiConfirmations()).one, previous);
    assert.equal(filterConfirmedItems(saved.bc_data, await getAiConfirmations()).some(i => i.id === 'one'), false);
  });
  await test('undo skips confirmations after a later content edit and cannot revive them on retry', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true })]));
    item('one').note = 'manual edit';
    const current = clone((await getAiConfirmations()).one);
    const undo = await undoAiOrganization('op');
    assert.equal(undo.restoredConfirmations, 0); assert.equal(undo.skipped, 1);
    assert.deepEqual((await getAiConfirmations()).one, current);
    item('one').note = '';
    assert.equal((await undoAiOrganization('op')).restoredConfirmations, 0);
    assert.deepEqual((await getAiConfirmations()).one, current);
  });
  await test('undo does not overwrite a later confirmation record for the same content', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true })]));
    const later = { ...saved.pageclip_ai_confirmations.records.one, operationId: 'later', confirmedAt: clock + 1 };
    saved.pageclip_ai_confirmations.records.one = later;
    assert.equal((await undoAiOrganization('op')).restoredConfirmations, 0);
    assert.deepEqual((await getAiConfirmations()).one, later);
  });
  await test('orphan confirmation cleanup is locked, local and preserves valid records', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true }), entry('two', { confirm: true })]));
    const before = writes;
    const deleting = withDataLock(async () => { saved.bc_data.items = saved.bc_data.items.filter(i => i.id !== 'one'); });
    const reading = getAiConfirmations(); await deleting;
    const records = await reading;
    assert.deepEqual(Object.keys(records), ['two']); assert.equal(writes, before + 1);
    assert.deepEqual(Object.keys(writeLog.at(-1)), ['pageclip_ai_confirmations']);
    records.two.operationId = 'external mutation';
    assert.equal((await getAiConfirmations()).two.operationId, 'op'); assert.equal(writes, before + 1);
  });
  await test('receipts survive intervening transactions and undone replays never recreate confirmations', async () => {
    const first = plan([entry('one', { confirm: true, addTags: ['first'] })], [], 'first');
    await applyAiOrganization(first); await undoAiOrganization('first');
    await applyAiOrganization(plan([entry('two', { confirm: true })], [], 'second'));
    const before = clone(saved), count = writes;
    assert.equal((await applyAiOrganization(first)).replayed, true);
    assert.equal(writes, count); assert.deepEqual(saved, before); assert.deepEqual(item('one').tags, []);
  });
  await test('no-change receipts prevent later edits from turning a replay into a new apply', async () => {
    const p = plan([entry('one', { targetFolderId: 'a' })]);
    const result = await applyAiOrganization(p); assert.equal(result.moved, 0);
    item('one').folderId = 'b';
    const replay = await applyAiOrganization(p);
    assert.equal(replay.replayed, true); assert.equal(item('one').folderId, 'b'); assert.equal(writes, 1);
  });
  await test('a no-change receipt preserves the last effective undo operation', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true })]));
    await applyAiOrganization(plan([entry('two')], [], 'empty'));
    assert.equal((await getAiUndoStatus()).operationId, 'op');
    assert.equal((await undoAiOrganization('op')).restoredConfirmations, 1);
  });
  await test('operation receipts are bounded while retaining the most recent operation', async () => {
    for (let n = 0; n < 205; n++) {
      clock++; await applyAiOrganization(plan([], [], `op-${n}`));
    }
    assert.equal(Object.keys(saved.pageclip_ai_receipts.records).length, 200);
    assert.equal(saved.pageclip_ai_receipts.records['op-0'], undefined);
    const count = writes;
    assert.equal((await applyAiOrganization(plan([], [], 'op-204'))).replayed, true); assert.equal(writes, count);
  });
  await test('storage failure leaves data, confirmation, undo and receipt unchanged and retryable', async () => {
    const before = clone(saved), p = plan([entry('one', { confirm: true, targetFolderId: 'b', addTags: ['new'] })]);
    rejectWrite = true;
    await assert.rejects(() => applyAiOrganization(p), /storage write failed/);
    assert.deepEqual(saved, before); assert.equal(writes, 0);
    rejectWrite = false;
    assert.equal((await applyAiOrganization(p)).confirmed, 1); assert.equal(writes, 1);
  });
  await test('plan is copied before waiting for the transaction lock', async () => {
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const locked = withDataLock(() => barrier);
    const p = plan([entry('one', { confirm: true })]);
    const applying = applyAiOrganization(p); p.items[0].confirm = false; p.items[0].before.title = 'mutated';
    release(); await locked;
    assert.equal((await applying).confirmed, 1);
  });
  await test('redacted placeholders in selected output or supplied reason never confirm', async () => {
    for (const [n, extra] of [
      { addTags: ['[REDACTED]'] }, { reason: '[REDACTED]' }, { reason: 'PAGECLIP_REDACTED_1' },
      { addTags: ['[已脱敏_1]'] }, { reason: '包含[已脱敏_12]理由' },
      { newFolderTempId: 'redacted' },
    ].entries()) {
      const r = await applyAiOrganization(plan([entry('one', { confirm: true, ...extra })],
        [{ tempId: 'redacted', name: '[REDACTED]', parentFolderId: null }], `redacted-${n}`));
      assert.equal(r.confirmed, 0); assert.equal(r.items[0].reason, 'redacted-output');
      assert.equal(r.tagged, 0); assert.equal(r.createdFolders, 0);
      assert.deepEqual(item('one').tags, []);
    }
    assert.deepEqual(await getAiConfirmations(), {});
    // An unselected new folder does not prevent an unchanged item being confirmed.
    assert.equal((await applyAiOrganization(plan([entry('two', { confirm: true })],
      [{ tempId: 'unused', name: '[REDACTED]', parentFolderId: null }], 'unselected'))).confirmed, 1);
  });
  await test('confirmation maps handle IDs inherited by ordinary objects', async () => {
    item('one').id = 'toString';
    assert.equal((await applyAiOrganization(plan([entry('toString', { confirm: true })]))).confirmed, 1);
    assert.equal((await getAiConfirmations()).toString.operationId, 'op');
    assert.equal((await undoAiOrganization('op')).restoredConfirmations, 1);
    assert.deepEqual(await getAiConfirmations(), {});
  });
  await test('failed undo is atomic and remains retryable', async () => {
    await applyAiOrganization(plan([entry('one', { confirm: true, targetFolderId: 'b', addTags: ['new'] })]));
    const before = clone(saved); rejectWrite = true;
    await assert.rejects(() => undoAiOrganization('op'), /storage write failed/);
    assert.deepEqual(saved, before);
    rejectWrite = false;
    const result = await undoAiOrganization('op');
    assert.equal(result.restoredConfirmations, 1); assert.equal(result.restoredMoves, 1); assert.equal(result.restoredTags, 1);
  });
  await test('legacy version one undo remains usable after adding confirmation transactions', async () => {
    await applyAiOrganization(plan([entry('one', { targetFolderId: 'b', addTags: ['new'] })]));
    saved.pageclip_ai_undo.version = 1; delete saved.pageclip_ai_undo.confirmations;
    delete saved.pageclip_ai_receipts; delete saved.pageclip_ai_confirmations;
    const result = await undoAiOrganization('op');
    assert.equal(result.restoredMoves, 1); assert.equal(result.restoredTags, 1);
    assert.equal(result.restoredConfirmations, 0);
    assert.equal((await applyAiOrganization(plan([entry('one')]))).replayed, true);
  });
  await test('reject malformed and malicious plans without writes', async () => {
    const base = plan([entry('one')]);
    const bad = [null, [], { ...base, operationId: '__proto__' }, { ...base, injected: true },
      { ...base, items: [...base.items, ...base.items] },
      ...[null, 1, 'true', undefined].map(confirm => ({ ...base, items: [entry('one', { confirm })] })),
      ...[null, 42, '', 'x'.repeat(32769)].map(analysisFingerprint => ({ ...base, items: [entry('one', { analysisFingerprint })] })),
      ...[null, 42, 'x'.repeat(201)].map(reason => ({ ...base, items: [entry('one', { reason })] })),
      { ...base, items: [entry('one', { analysisSnapshot: { ...entry('one').before, unexpected: true } })] },
      { ...base, items: [entry('one', { analysisSnapshot: { ...entry('one').before, tags: [42] } })] },
      { ...base, items: [entry('one', { addTags: new Array(1) })] },
      { ...base, newFolders: Array.from({ length: 11 }, (_, i) => ({ tempId: `t${i}`, name: 'x', parentFolderId: null })) },
      { ...base, items: [entry('one', { addTags: ['a', 'b', 'c', 'd'] })] },
      { ...base, items: [entry('one', { targetFolderId: {}, newFolderTempId: 'x' })] },
      { ...base, newFolders: [{ tempId: 'x', name: 'x'.repeat(51), parentFolderId: null }] },
      { ...base, items: [entry('one', { before: { ...entry('one').before, url: 'javascript:alert(1)' } })] },
      JSON.parse('{"operationId":"x","items":[],"newFolders":[],"__proto__":{}}'),
      Object.defineProperty({}, 'operationId', { enumerable: true, get() { throw new Error('getter executed'); } }),
    ];
    for (const p of bad) await assert.rejects(() => applyAiOrganization(p), TypeError);
    assert.equal(writes, 0); assert.equal({}.polluted, undefined);
  });
  console.log('AI store tests passed');
} finally { Date.now = realNow; }
