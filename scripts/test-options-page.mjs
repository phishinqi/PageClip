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
