// Scan releasable client files without mistaking error codes or === for credentials.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const root = process.argv[2];
if (!root) throw Error('Usage: node check-release-secrets.mjs <stage>');
export const forbidden = [
  /mock-google-token|GOCSPX-[A-Za-z0-9_-]+/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:client_secret|clientSecret|accessToken|refreshToken)\s*(?::|=(?!=))\s*['"][^'"\r\n]+['"]/,
];
async function scan(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await scan(path));
    else if (/\.(?:js|json|html|css|svg|txt)$/i.test(entry.name)) {
      const lines = (await readFile(path, 'utf8')).split('\n');
      lines.forEach((line, i) => { if (forbidden.some(pattern => pattern.test(line))) found.push(`${relative(root, path)}:${i + 1}`); });
    }
  }
  return found;
}
const findings = await scan(root);
if (findings.length) { console.error('Potential credential literals/private keys at:\n' + findings.join('\n')); process.exitCode = 1; }
else console.log('Release credential-literal scan passed');
