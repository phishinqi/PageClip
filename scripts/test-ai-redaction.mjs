import assert from 'node:assert/strict';
import { normalizeRedactionRules, redactPayload, containsRedactionPlaceholder, AI_REDACTION_KEY } from '../js/ai-redaction.js';

assert.equal(AI_REDACTION_KEY, 'pageclip_ai_redaction');
assert.deepEqual(normalizeRedactionRules(), { enabled: false, words: [] });
const raw = { enabled: true, words: [' Secret ', '', 'SECRET', 'alpha', 'AlphaBeta', 'example.com', 'red', 'a.b', 'C++', '客户'] };
const rules = normalizeRedactionRules(raw);
assert.deepEqual(rules.words, ['Secret', 'alpha', 'AlphaBeta', 'example.com', 'red', 'a.b', 'C++', '客户']);
assert.ok(Object.isFrozen(rules)); assert.ok(Object.isFrozen(rules.words));
raw.words[0] = 'changed';
assert.equal(rules.words[0], 'Secret', 'task snapshot must not track later setting edits');
assert.throws(() => rules.words.push('later'), TypeError);
assert.deepEqual(normalizeRedactionRules({ enabled: true, words: ' secret\r\nSECRET\n客户\r\n ' }).words, ['secret', '客户']);
for (const input of [null, [], 'secret', { enabled: 'true' }, { words: {} }, { words: [42] }, { words: ['a\nb'] }]) {
  assert.throws(() => normalizeRedactionRules(input), { code: 'INVALID_REDACTION_RULES' });
}
assert.equal(normalizeRedactionRules({ words: Array.from({ length: 500 }, (_, i) => 'word' + i) }).words.length, 500);
assert.equal(normalizeRedactionRules({ words: Array(501).fill('duplicate') }).words.length, 1);
assert.throws(() => normalizeRedactionRules({ words: Array.from({ length: 501 }, (_, i) => 'word' + i) }), { code: 'REDACTION_TOO_MANY_WORDS' });
assert.equal(normalizeRedactionRules({ words: ['x'.repeat(100)] }).words[0].length, 100);
assert.throws(() => normalizeRedactionRules({ words: ['x'.repeat(101)] }), { code: 'REDACTION_WORD_TOO_LONG' });

const items = [{ itemId: 'Secret', id: 'Secret', folderId: 'Secret', parentId: 'Secret', tempId: 'Secret', parentFolderId: 'Secret',
  title: 'Secret SECRET project AlphaBeta', url: 'https://example.com/a/public/path', tags: ['Secret', 'public'],
  existingTags: ['alpha', 'Secret'], note: '客户 Secret', untouched: 'Secret', nested: { folderId: 'Secret' } }];
const folders = [{ id: 'Secret', parentId: 'Secret', path: 'Secret / AlphaBeta', name: 'Secret', system: false }];
const tags = ['Secret', 'C++', 'public'];
const candidates = [{ tempId: 'Secret', parentFolderId: 'Secret', name: '客户' }];
const before = structuredClone({ items, folders, tags, candidates });
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
freeze(items); freeze(folders); freeze(tags); freeze(candidates);
const result = redactPayload(items, folders, tags, candidates, rules);
assert.deepEqual(result.items[0], { ...items[0], title: '[已脱敏_1] [已脱敏_1] project [已脱敏_3]',
  url: '[已脱敏_4]', tags: ['[已脱敏_1]', 'public'], existingTags: ['[已脱敏_2]', '[已脱敏_1]'], note: '[已脱敏_8] [已脱敏_1]' });
assert.deepEqual(result.folders, [{ ...folders[0], path: '[已脱敏_1] / [已脱敏_3]', name: '[已脱敏_1]' }]);
assert.deepEqual(result.tags, ['[已脱敏_1]', '[已脱敏_7]', 'public']);
assert.deepEqual(result.newFolders, [{ ...candidates[0], name: '[已脱敏_8]' }]);
assert.deepEqual(result.stats, { replacements: 15, fields: 11 });
assert.deepEqual(Object.keys(result).sort(), ['folders', 'items', 'newFolders', 'stats', 'tags']);
assert.deepEqual({ items, folders, tags, candidates }, before);
assert.notEqual(result.items, items); assert.notEqual(result.items[0], items[0]); assert.notEqual(result.items[0].nested, items[0].nested);
assert.deepEqual(Object.keys(result.stats).sort(), ['fields', 'replacements']);
const disabled = redactPayload(items, folders, tags, candidates, { enabled: false, words: rules.words });
assert.deepEqual(disabled, { items, folders, tags, newFolders: candidates, stats: { replacements: 0, fields: 0 } });
assert.notEqual(disabled.items[0], items[0]);

// Literal punctuation, ASCII case folding, longest-first overlapping matches and a single pass.
const literalRules = normalizeRedactionRules({ enabled: true, words: ['a', 'abc', 'bc', 'a.b', 'C++', '$&', '[x]', '\\', '客户', 'é'] });
const literal = redactPayload([{ title: 'ABC a.b C++ $& [x] \\ 客户 axb É é' }], [], [], [], literalRules);
assert.equal(literal.items[0].title, '[已脱敏_2] [已脱敏_4] [已脱敏_5] [已脱敏_6] [已脱敏_7] [已脱敏_8] [已脱敏_9] [已脱敏_1]xb É [已脱敏_10]');
assert.equal(literal.stats.replacements, 9);
const opaqueRules = { enabled: true, words: ['secret', '已脱敏', '1', '[', '_'] };
const once = redactPayload([{ title: 'SECRET [已脱敏_1]', url: 'https://public.test/secret/path' }], [], [], [], opaqueRules);
assert.equal(once.items[0].title, '[已脱敏_1] [已脱敏_1]');
assert.deepEqual(redactPayload(once.items, [], [], [], opaqueRules).stats, { replacements: 0, fields: 0 });
assert.equal(once.items[0].url, '[已脱敏_1]');
// A matched URL never retains even its hostname/path; each URL is one replacement.
assert.deepEqual(redactPayload([{ url: 'https://secret.test/secret/secret' }], [], [], [], opaqueRules).stats, { replacements: 1, fields: 1 });
assert.equal(redactPayload([{ url: 'https://public.test/path' }], [], [], [], rules).items[0].url, 'https://public.test/path');

// Resumes and batch ordering produce the same tokens without saving a reverse mapping.
const resumed = JSON.parse(JSON.stringify(rules));
const batchA = redactPayload([{ title: 'Secret AlphaBeta' }], [], [], [], rules);
const batchB = redactPayload([{ title: 'AlphaBeta Secret' }], [], [], [], resumed);
assert.equal(batchA.items[0].title, '[已脱敏_1] [已脱敏_3]');
assert.equal(batchB.items[0].title, '[已脱敏_3] [已脱敏_1]');
assert.deepEqual(redactPayload([{ title: 'Secret AlphaBeta' }], [], [], [], resumed), batchA);
assert.equal(containsRedactionPlaceholder('x [已脱敏_12] y'), true);
assert.equal(containsRedactionPlaceholder({ folders: [{ name: '[已脱敏_1]' }] }), true);
for (const value of ['[已脱敏_0]', '[已脱敏_01]', '[已脱敏_x]', '[已脱敏_1', null, 42, { title: 'ordinary' }]) assert.equal(containsRedactionPlaceholder(value), false);
console.log('AI redaction tests passed: literal matching, privacy boundaries, immutable snapshots and deterministic resume.');
