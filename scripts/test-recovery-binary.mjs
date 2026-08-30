import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/crypto-backup.js', import.meta.url), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*/gm, '')
  .replace(/^export\s+/gm, '')
  + '\n globalThis.__recoveryTest = { encodeRecoveryKeyBinary, decodeRecoveryKeyBinary, RECOVERY_BINARY_MAGIC };';
const context = {
  TextEncoder,
  TextDecoder,
  Uint8Array,
  ArrayBuffer,
  DataView,
  atob,
  btoa,
  crypto: globalThis.crypto,
  console,
};
vm.createContext(context);
vm.runInContext(executable, context, { filename: 'crypto-backup.js' });
const { encodeRecoveryKeyBinary, decodeRecoveryKeyBinary, RECOVERY_BINARY_MAGIC } = context.__recoveryTest;
const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const iv = Uint8Array.from({ length: 12 }, (_, index) => 40 + index);
const encryptedKey = Uint8Array.from({ length: 48 }, (_, index) => 80 + index);
const binary = encodeRecoveryKeyBinary({ salt, iterations: 600000, iv, encryptedKey });
assert.equal(new TextDecoder().decode(binary.slice(0, 8)), RECOVERY_BINARY_MAGIC);
assert.equal(binary[8], 1);
assert.equal(binary[9], 1);
const envelope = decodeRecoveryKeyBinary(binary);
assert.equal(envelope.format, 'pageclip-device-key');
assert.equal(envelope.version, 1);
assert.equal(envelope.iterations, 600000);
assert.equal(envelope.salt.length > 0, true);
assert.equal(envelope.iv.length > 0, true);
assert.equal(envelope.encryptedKey.length > 0, true);
assert.throws(() => decodeRecoveryKeyBinary(binary.slice(1)), /不是有效|版本|长度/);
assert.throws(() => decodeRecoveryKeyBinary(Uint8Array.from([1, 2, 3])), /不是有效/);
console.log('Recovery binary tests passed: format, round-trip, and corruption checks');
