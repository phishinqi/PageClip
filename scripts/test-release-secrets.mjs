import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'pageclip-release-scan-'));
try {
  const file = join(dir, 'sample.js');
  const run = () => spawnSync(process.execPath, [new URL('./check-release-secrets.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), dir], { encoding: 'utf8' });
  await writeFile(file, "if (state.accessToken===rejected) clear();\nthrow new Error('client_secret_required');\n");
  assert.equal(run().status, 0);
  for (const value of ["const client_secret = 'fixed-secret';", "const clientSecret = 'fixed-secret';", "const accessToken = 'fixed-token';", "const c = {refreshToken:'fixed-token'};", '-----BEGIN PRIVATE KEY-----', 'GOCSPX-fixture-value', 'mock-google-token']) {
    await writeFile(file, value);
    const result = run(); assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('fixed-secret'), 'scanner must not print secret value');
  }
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Release scanner tests passed: literal credentials rejected; error identifiers and comparisons accepted');
