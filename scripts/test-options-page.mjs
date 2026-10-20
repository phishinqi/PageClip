import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { ZH, EN } from '../js/i18n.js';

const source = await readFile(new URL('../options.js', import.meta.url), 'utf8');
// Match <script type="module"> even when Node treats .js files as ambiguous.
const parsed = spawnSync(process.execPath, ['--input-type=module', '--check'], {
  input: source,
  encoding: 'utf8',
});
assert.ifError(parsed.error);
assert.equal(parsed.status, 0, `Settings module failed to parse:\n${parsed.stderr}`);

// The page uses the JS catalogs, not Chrome's _locales files. Include indirect
// label keys (e.g. navigation entries) as well as direct t('...') calls.
const keys = [...new Set([...source.matchAll(/['"]((?:settings|tags)\.[A-Za-z0-9]+)['"]/g)].map(match => match[1]))];
for (const [locale, catalog] of [['zh_CN', ZH], ['en', EN]]) {
  for (const key of keys) {
    assert(Object.hasOwn(catalog, key), `${locale}: missing settings-page translation ${key}`);
    assert.equal(typeof catalog[key], 'string', `${locale}: invalid translation ${key}`);
    assert(catalog[key].trim(), `${locale}: empty translation ${key}`);
    assert.notEqual(catalog[key], key, `${locale}: untranslated key ${key}`);
  }
}
for (const key of keys) {
  const placeholders = text => [...text.matchAll(/\$[A-Z0-9_]+\$/g)].map(match => match[0]).sort();
  assert.deepEqual(placeholders(ZH[key]), placeholders(EN[key]), `Placeholder mismatch: ${key}`);
}
console.log(`Settings-page regression passed: ES module syntax and ${keys.length} translated keys in both locales`);

// Exercise local-only redaction controls without a browser or additional dependencies.
const { aiText, createAIRedactionSettings, createAITopicSettings } = await import('../js/ai-settings.js');
const previousDocument = globalThis.document;
const previousChrome = globalThis.chrome;
const previousFetch = globalThis.fetch;
class Control {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.children = children; this.listeners = {}; this.attributes = { ...attrs };
    this.id = attrs.id; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false;
    this.textContent = attrs.text || '';
    this.classes = new Set();
    this.classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(key, value) { this.attributes[key] = value; }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
}
const h = (tag, attrs = {}, ...children) => new Control(tag, attrs, children);
const ui = {
  h, actions: (...children) => h('div', {}, ...children),
  button(text, cls, fn) { const node = h('button', { text }); node.addEventListener('click', fn); return node; },
};
function descendants(node) { return [node, ...node.children.filter(child => child instanceof Control).flatMap(descendants)]; }
const flush = () => new Promise(resolve => setImmediate(resolve));
const stored = {};
const reads = [], writes = [];
let failGet = false, failSet = false;
try {
  globalThis.document = { documentElement: { lang: 'en' } };
  globalThis.chrome = {
    storage: { local: {
      async get(key) { reads.push(key); if (failGet) throw new Error('storage failed'); return { [key]: structuredClone(stored[key]) }; },
      async set(patch) { if (failSet) throw new Error('storage failed'); writes.push(structuredClone(patch)); Object.assign(stored, structuredClone(patch)); },
    } },
    runtime: { sendMessage() { throw new Error('Redaction settings must not message the provider'); } },
  };
  globalThis.fetch = () => { throw new Error('Redaction settings must not access the network'); };
  const section = createAIRedactionSettings(ui);
  const controls = descendants(section);
  const enabled = controls.find(node => node.id === 'ai-redaction-enabled');
  const words = controls.find(node => node.id === 'ai-redaction-words');
  const save = controls.find(node => node.textContent === aiText('redactionSave'));
  const status = controls.find(node => node.attributes['aria-live'] === 'polite');
  assert.equal(enabled.disabled, true);
  await flush();
  assert.equal(enabled.disabled, false); assert.equal(enabled.checked, false); assert.equal(words.value, '');
  assert.deepEqual(reads, ['pageclip_ai_redaction']);
  assert.deepEqual(writes, [], 'loading defaults must not persist anything');
  enabled.checked = true; words.value = ' Secret\nSECRET\n客户\n';
  await save.click();
  assert.deepEqual(stored.pageclip_ai_redaction, { enabled: true, words: ['Secret', '客户'] });
  assert.equal(words.value, 'Secret\n客户');
  assert.equal(status.textContent, aiText('redactionSaved'));
  assert.deepEqual(Object.keys(writes[0]), ['pageclip_ai_redaction']);
  words.value = 'x'.repeat(101);
  await save.click();
  assert.equal(status.textContent, aiText('redactionTooLong'));
  assert.equal(status.attributes.role, 'alert'); assert.equal(words.value.length, 101);
  assert.equal(writes.length, 1, 'invalid rules must not overwrite previous rules');
  words.value = Array.from({ length: 501 }, (_, i) => 'word' + i).join('\n');
  await save.click();
  assert.equal(status.textContent, aiText('redactionTooMany')); assert.equal(writes.length, 1);
  words.value = 'changed'; failSet = true;
  await save.click();
  assert.equal(status.textContent, aiText('redactionSaveFailed')); assert.equal(words.value, 'changed');
  assert.deepEqual(stored.pageclip_ai_redaction.words, ['Secret', '客户']);
  failSet = false; enabled.checked = false;
  await save.click();
  assert.deepEqual(stored.pageclip_ai_redaction, { enabled: false, words: ['changed'] });
  assert.equal(status.attributes.role, 'status');
  const reloaded = descendants(createAIRedactionSettings(ui));
  await flush();
  assert.equal(reloaded.find(node => node.id === 'ai-redaction-words').value, 'changed');
  assert.equal(reloaded.find(node => node.id === 'ai-redaction-enabled').checked, false);
  failGet = true;
  const failed = descendants(createAIRedactionSettings(ui));
  await flush();
  assert.equal(failed.find(node => node.id === 'ai-redaction-words').disabled, true);
  const retry = failed.find(node => node.textContent === aiText('retry'));
  assert.equal(retry.hidden, false);
  failGet = false; await retry.click(); await flush();
  assert.equal(retry.hidden, true); assert.equal(failed.find(node => node.id === 'ai-redaction-words').disabled, false);
  const english = ['redactionTitle', 'redactionEnabled', 'redactionWords', 'redactionHint', 'redactionSave'].map(aiText);
  globalThis.document.documentElement.lang = 'zh-CN';
  for (const [i, key] of ['redactionTitle', 'redactionEnabled', 'redactionWords', 'redactionHint', 'redactionSave'].entries()) {
    assert.match(aiText(key), /[\u4e00-\u9fff]/); assert.notEqual(aiText(key), english[i]);
  }
  assert.ok(reads.every(key => key === 'pageclip_ai_redaction'));
  const topicControls=descendants(createAITopicSettings(ui));
  const topicEnabled=topicControls.find(node=>node.id==='ai-topics-enabled');
  const topicSave=topicControls.find(node=>node.textContent===aiText('topicsSave'));
  const topicStatus=topicControls.find(node=>node.attributes['aria-live']==='polite');
  await flush();assert.equal(topicEnabled.checked,false);assert.equal(topicEnabled.disabled,false);
  const privacyBefore=structuredClone(stored.pageclip_ai_redaction);
  topicEnabled.checked=true;await topicSave.click();
  assert.deepEqual(stored.pageclip_ai_topics,{version:1,enabled:true});
  assert.deepEqual(stored.pageclip_ai_redaction,privacyBefore);
  assert.equal(topicStatus.textContent,aiText('topicsSaved'));
  failSet=true;topicEnabled.checked=false;await topicSave.click();
  assert.equal(topicStatus.textContent,aiText('topicsFailed'));assert.equal(stored.pageclip_ai_topics.enabled,true);
  failSet=false;await topicSave.click();assert.equal(stored.pageclip_ai_topics.enabled,false);
  failGet=true;const failedTopics=descendants(createAITopicSettings(ui));await flush();
  assert.equal(failedTopics.find(node=>node.id==='ai-topics-enabled').disabled,true);
  const topicRetry=failedTopics.find(node=>node.textContent===aiText('topicsRetry'));assert.equal(topicRetry.hidden,false);
  failGet=false;await topicRetry.click();await flush();assert.equal(topicRetry.hidden,true);
  stored.pageclip_ai_topics={version:2,enabled:true};
  const invalidTopics=descendants(createAITopicSettings(ui));await flush();
  assert.equal(invalidTopics.find(node=>node.id==='ai-topics-enabled').disabled,true);
  for(const key of ['topicsTitle','topicsEnabled','topicsHint','topicsSave','topicsSaved','topicsFailed','topicsRetry']){
    const zh=aiText(key);assert.match(zh,/[\u4e00-\u9fff]/);
    globalThis.document.documentElement.lang='en';assert.notEqual(aiText(key),zh);assert.notEqual(aiText(key),key);
    globalThis.document.documentElement.lang='zh-CN';
  }
  console.log('Local AI settings passed: bilingual controls, separate storage, strict validation, save/load recovery and no provider calls.');
} finally {
  globalThis.document = previousDocument;
  globalThis.chrome = previousChrome;
  globalThis.fetch = previousFetch;
}
