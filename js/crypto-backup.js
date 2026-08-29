// PageClip 云备份加密：只在客户端处理明文，云端只接收密文。
import { loadData } from './store.js';

export const BACKUP_FORMAT = 'pageclip-cloud-backup';
export const RECOVERY_FORMAT = 'pageclip-device-key';
export const CRYPTO_VERSION = 1;
export const KDF_ITERATIONS = 600000;
const DB_NAME = 'pageclip-secrets';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const DEVICE_KEY_ID = 'default-device-key';

function webCrypto() {
  const value = globalThis.crypto;
  if (!value?.subtle || !value.getRandomValues) throw new Error('当前环境不支持 Web Crypto');
  return value;
}
function encoder() { return new TextEncoder(); }
function decoder() { return new TextDecoder(); }
function randomBytes(size) { const bytes = new Uint8Array(size); webCrypto().getRandomValues(bytes); return bytes; }
function toBase64(bytes) { let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value) { const binary = atob(String(value || '')); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
function equalBytes(left, right) { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i]; return diff === 0; }
function ensurePassword(password, label = '密码') { if (typeof password !== 'string' || password.length < 8) throw new Error(label + '至少需要 8 个字符'); }
async function derivePasswordKey(password, salt, iterations = KDF_ITERATIONS) {
  ensurePassword(password);
  const base = await webCrypto().subtle.importKey('raw', encoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey', 'deriveBits']);
  return webCrypto().subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function deriveVerifier(password, salt, iterations = KDF_ITERATIONS) {
  ensurePassword(password);
  const base = await webCrypto().subtle.importKey('raw', encoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  return new Uint8Array(await webCrypto().subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256));
}

export async function createPasswordVerifier(password) {
  const salt = randomBytes(16);
  const verifier = await deriveVerifier(password, salt);
  return { verifier: toBase64(verifier), verifierSalt: toBase64(salt), kdf: 'PBKDF2-SHA-256', iterations: KDF_ITERATIONS };
}

export async function verifyBackupPassword(password) {
  const data = await loadData();
  const config = data.settings?.cloudBackup?.password;
  if (!config?.verifier || !config?.verifierSalt) return { configured: false, valid: false };
  try {
    const actual = await deriveVerifier(password, fromBase64(config.verifierSalt), Number(config.iterations) || KDF_ITERATIONS);
    return { configured: true, valid: equalBytes(actual, fromBase64(config.verifier)) };
  } catch { return { configured: true, valid: false }; }
}

function openSecretsDb() {
  if (!globalThis.indexedDB) throw new Error('当前环境不支持本机密钥存储');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本机密钥存储'));
  });
}
async function readDeviceKey() {
  const db = await openSecretsDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(DEVICE_KEY_ID);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error('无法读取本机密钥')); };
  });
}
async function writeDeviceKey(key) {
  const db = await openSecretsDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(key, DEVICE_KEY_ID);
    request.onsuccess = () => { db.close(); resolve(key); };
    request.onerror = () => { db.close(); reject(request.error || new Error('无法保存本机密钥')); };
  });
}

export async function getOrCreateDeviceKey() {
  const current = await readDeviceKey();
  if (current) return current;
  const key = await webCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return writeDeviceKey(key);
}

async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ciphertext = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}
async function decryptBytes(key, iv, ciphertext) {
  try { return new Uint8Array(await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext))); }
  catch { throw new Error('备份解密失败：密码、恢复密钥或备份内容不正确'); }
}

export async function encryptBackup(payload, options = {}) {
  const mode = options.mode || 'password';
  let key;
  let encryption;
  if (mode === 'password') {
    ensurePassword(options.password, '备份密码');
    const salt = randomBytes(16);
    key = await derivePasswordKey(options.password, salt);
    encryption = { mode, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', salt: toBase64(salt), iterations: KDF_ITERATIONS };
  } else if (mode === 'device-key') {
    key = options.key || await getOrCreateDeviceKey();
    encryption = { mode, cipher: 'AES-256-GCM', kdf: 'none', salt: '', iterations: 0, keyId: DEVICE_KEY_ID };
  } else throw new Error('不支持的加密模式');
  const encrypted = await encryptBytes(key, encoder().encode(JSON.stringify(payload)));
  return { format: BACKUP_FORMAT, version: CRYPTO_VERSION, schema: Number(payload?.schema) || 3, createdAt: Date.now(), encryption: { ...encryption, iv: encrypted.iv }, ciphertext: encrypted.ciphertext };
}

export async function decryptBackup(envelope, options = {}) {
  if (!envelope || envelope.format !== BACKUP_FORMAT || envelope.version !== CRYPTO_VERSION || !envelope.encryption || !envelope.ciphertext) throw new Error('云端备份格式不受支持');
  const config = envelope.encryption;
  let key;
  if (config.mode === 'password') {
    ensurePassword(options.password, '备份密码');
    key = await derivePasswordKey(options.password, fromBase64(config.salt), Number(config.iterations) || KDF_ITERATIONS);
  } else if (config.mode === 'device-key') {
    key = options.key || await getOrCreateDeviceKey();
  } else throw new Error('备份使用了不支持的加密模式');
  const plaintext = await decryptBytes(key, config.iv, envelope.ciphertext);
  let payload;
  try { payload = JSON.parse(decoder().decode(plaintext)); } catch { throw new Error('备份内容不是有效的 JSON'); }
  if (!payload || payload.schema !== 3 || !Array.isArray(payload.items) || !Array.isArray(payload.folders)) throw new Error('备份数据缺少 schema 3 必需字段');
  return payload;
}

export async function exportEncryptedRecoveryKey(password) {
  ensurePassword(password, '恢复密钥密码');
  const key = await getOrCreateDeviceKey();
  const raw = new Uint8Array(await webCrypto().subtle.exportKey('raw', key));
  const salt = randomBytes(16);
  const wrappingKey = await derivePasswordKey(password, salt);
  const encrypted = await encryptBytes(wrappingKey, raw);
  return { format: RECOVERY_FORMAT, version: CRYPTO_VERSION, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', salt: toBase64(salt), iterations: KDF_ITERATIONS, iv: encrypted.iv, encryptedKey: encrypted.ciphertext };
}

export async function importEncryptedRecoveryKey(file, password) {
  ensurePassword(password, '恢复密钥密码');
  let envelope = file;
  if (typeof file === 'string') envelope = JSON.parse(file);
  else if (file?.text) envelope = JSON.parse(await file.text());
  if (!envelope || envelope.format !== RECOVERY_FORMAT || envelope.version !== CRYPTO_VERSION) throw new Error('恢复密钥文件格式不受支持');
  const wrappingKey = await derivePasswordKey(password, fromBase64(envelope.salt), Number(envelope.iterations) || KDF_ITERATIONS);
  const raw = await decryptBytes(wrappingKey, envelope.iv, envelope.encryptedKey);
  if (raw.length !== 32) throw new Error('恢复密钥长度不正确');
  const key = await webCrypto().subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  await writeDeviceKey(key);
  return { imported: true, keyId: DEVICE_KEY_ID };
}
