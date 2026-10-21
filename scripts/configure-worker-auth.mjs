// Publisher build step. No secrets accepted; ordinary users never run this.
import {readFile,writeFile} from 'node:fs/promises';
const [origin]=process.argv.slice(2);
if(!origin)throw Error('Usage: node scripts/configure-worker-auth.mjs https://oauth.your-domain.example');
const url=new URL(origin);
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/localhost|\.invalid$|\.example$/.test(url.hostname))throw Error('Use actual publisher HTTPS origin, not example/localhost');
const configUrl=new URL('../js/google-worker-config.js',import.meta.url),manifestUrl=new URL('../manifest.json',import.meta.url);
const manifest=JSON.parse(await readFile(manifestUrl,'utf8'));
const old=await readFile(configUrl,'utf8');const previous=/GOOGLE_WORKER_ORIGIN = '([^']*)'/.exec(old)?.[1];
manifest.host_permissions=(manifest.host_permissions||[]).filter(v=>!previous||v!==previous+'/*');
if(!manifest.host_permissions.includes(url.origin+'/*'))manifest.host_permissions.push(url.origin+'/*');
await writeFile(configUrl,`// Publisher public endpoint. No secrets belong in the extension.\nexport const GOOGLE_WORKER_ORIGIN = '${url.origin}';\n`);
await writeFile(manifestUrl,JSON.stringify(manifest,null,2)+'\n');
console.log('Configured public Worker origin and host permission. Review, deploy, and validate real OAuth before publishing.');
