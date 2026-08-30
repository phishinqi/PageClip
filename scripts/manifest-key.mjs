import crypto from 'node:crypto';
import fs from 'node:fs';

const [, , command, manifestPath, privateKeyPath] = process.argv;

function usage() {
  throw new Error('Usage: node scripts/manifest-key.mjs <set|verify|strip> <manifest.json> [private-key.pem]');
}

function readManifest(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read manifest ${path}: ${error.message}`);
  }
}

function writeManifest(path, manifest) {
  fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function derivePublicKey(path) {
  if (!path || !fs.existsSync(path)) throw new Error(`Private key PEM not found: ${path || '(missing)'}`);
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(path));
  } catch (error) {
    throw new Error(`Unable to parse private key PEM ${path}: ${error.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error(`Chrome extension signing key must be RSA, got ${privateKey.asymmetricKeyType || 'unknown'}`);
  }
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
}

function addKeyAfterVersion(manifest, key) {
  const ordered = {};
  let inserted = false;
  for (const [name, value] of Object.entries(manifest)) {
    ordered[name] = value;
    if (name === 'version') {
      ordered.key = key;
      inserted = true;
    }
  }
  if (!inserted) ordered.key = key;
  return ordered;
}

try {
  if (!['set', 'verify', 'strip'].includes(command) || !manifestPath) usage();
  const manifest = readManifest(manifestPath);

  if (command === 'strip') {
    if (Object.prototype.hasOwnProperty.call(manifest, 'key')) {
      delete manifest.key;
      writeManifest(manifestPath, manifest);
    }
    process.stdout.write(`Manifest key removed: ${manifestPath}\n`);
    process.exit(0);
  }

  const expectedKey = derivePublicKey(privateKeyPath);
  if (typeof manifest.key === 'string' && manifest.key !== expectedKey) {
    throw new Error(`Manifest key does not match private key PEM: ${manifestPath}`);
  }

  if (command === 'set' && manifest.key !== expectedKey) {
    writeManifest(manifestPath, addKeyAfterVersion(manifest, expectedKey));
    process.stdout.write(`Manifest key fixed: ${manifestPath}\n`);
  } else {
    process.stdout.write(`Manifest key verified: ${manifestPath}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
