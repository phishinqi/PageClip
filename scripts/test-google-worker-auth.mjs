import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const src=(await readFile(new URL('../js/google-worker-auth.js',import.meta.url),'utf8')).replace(/^import[^;]+;\s*/gm,'').replace(/^export\s+/gm,'');
const state={},alarms=new Map();let redeemed=false, offline=false,wrong=false,force=false,closed=0,refreshes=0,invalidCredential=false,pendingRedeemed=false;
const make=()=>{
 const context={GOOGLE_WORKER_ORIGIN:'https://oauth.publisher.test',loadData:async()=>({_sync:{account:'a@example.com'}}),crypto:webcrypto,Uint8Array,TextEncoder,btoa,URL,Date,Math,AbortSignal,
 navigator:{},chrome:{storage:{local:{setAccessLevel:async()=>{},get:async k=>({[k]:structuredClone(state[k])}),set:async v=>Object.assign(state,structuredClone(v)),remove:async k=>delete state[k]}},alarms:{create:async(n,a)=>alarms.set(n,a),clear:async n=>alarms.delete(n)},tabs:{create:async()=>{closed++;}}},
 fetch:async(url,opts)=>{
  assert.equal(url.startsWith('https://oauth.publisher.test/'),true);
  if(offline)throw Error('offline');
  const body=opts.body?JSON.parse(opts.body):{};
  const ok=v=>new Response(JSON.stringify(v));
  const token={accessToken:'short-access',expiresAt:Date.now()+3600000,email:wrong?'b@example.com':'a@example.com',subject:'google-subject'};
  if(url.endsWith('/v1/start')){assert.equal(body.challenge.length,43);assert.equal(body.account,'a@example.com');return ok({id:'session',authorizeUrl:'https://oauth.publisher.test/authorize?id=session',expiresAt:Date.now()+600000});}
  if(url.endsWith('/v1/redeem')){assert.ok(body.verifier&&body.credential);if(!redeemed)return new Response(JSON.stringify({error:'pending'}),{status:409});return ok(token);}
  if(url.endsWith('/v1/token')){if(invalidCredential)return new Response(JSON.stringify({error:'invalid_credential'}),{status:401});refreshes++;force=body.force;assert.match(opts.headers.Authorization,/Bearer /);return ok(token);}
  if(url.endsWith('/v1/cancel'))return pendingRedeemed?new Response(JSON.stringify({error:'already_redeemed'}),{status:409}):new Response(null,{status:204});
  if(url.endsWith('/v1/connection')){assert.equal(opts.method,'DELETE');if(invalidCredential)return new Response(JSON.stringify({error:'invalid_credential'}),{status:401});return new Response(null,{status:204});}
  throw Error('unexpected route');}};
 vm.createContext(context);vm.runInContext(src+'\nglobalThis.api={getWorkerToken,resumeWorkerAuthorization,workerAuthDiagnostics,clearWorkerToken,disconnectWorkerAuth,acknowledgeWorkerActivation,requestWorkerSyncActivation,clearWorkerSyncActivation,workerSyncActivationRequested};',context);return context.api;
};
let api=make();
await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');assert.equal(closed,1);assert.ok(state.pageclipWorkerAuth.pending);assert.equal(alarms.size,1);
await assert.rejects(api.resumeWorkerAuthorization(),e=>e.code==='pending');assert.ok(state.pageclipWorkerAuth.pending);
// New JS context emulates service-worker loss: persisted handshake remains authoritative.
api=make();redeemed=true;await api.resumeWorkerAuthorization();assert.equal(state.pageclipWorkerAuth.pending,undefined);assert.ok(state.pageclipWorkerAuth.credential);assert.equal(alarms.size,1);await api.acknowledgeWorkerActivation();assert.equal(alarms.size,0);
assert.equal(await api.getWorkerToken(false),'short-access');assert.equal(refreshes,0);
await api.clearWorkerToken('short-access');api=make();assert.equal(await api.getWorkerToken(false),'short-access');assert.equal(force,true);
state.pageclipWorkerAuth.expiresAt=1;offline=true;await assert.rejects(api.getWorkerToken(),e=>e.kind==='retry');assert.ok(state.pageclipWorkerAuth.credential);offline=false;
wrong=true;await assert.rejects(api.getWorkerToken(),e=>e.code==='account_mismatch');wrong=false;
offline=true;await assert.rejects(api.disconnectWorkerAuth(),e=>e.kind==='retry');assert.equal(state.pageclipWorkerAuth.revoking,true);assert.equal(state.pageclipWorkerAuth.accessToken,undefined);
offline=false;api=make();await api.resumeWorkerAuthorization();assert.equal(state.pageclipWorkerAuth,undefined);
assert.equal(JSON.stringify(await api.workerAuthDiagnostics()).includes('short-access'),false);
redeemed=false;await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');
await api.disconnectWorkerAuth();assert.equal(state.pageclipWorkerAuth,undefined);
redeemed=true;await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');await api.resumeWorkerAuthorization();
await api.clearWorkerToken();invalidCredential=true;
await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');
assert.equal(state.pageclipWorkerAuth.credential,null);invalidCredential=false;
state.pageclipWorkerAuth.pending.expiresAt=1;offline=true;
await assert.rejects(api.resumeWorkerAuthorization(),e=>e.kind==='retry');assert.ok(state.pageclipWorkerAuth.pending.credential);
offline=false;await api.resumeWorkerAuthorization();assert.ok(state.pageclipWorkerAuth.credential);assert.equal(state.pageclipWorkerAuth.pending,undefined);
await api.requestWorkerSyncActivation();assert.equal(await api.workerSyncActivationRequested(),true);await api.clearWorkerSyncActivation();assert.equal(await api.workerSyncActivationRequested(),false);
await api.clearWorkerToken();invalidCredential=true;await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');
pendingRedeemed=true;await api.disconnectWorkerAuth();assert.equal(state.pageclipWorkerAuth,undefined);invalidCredential=false;pendingRedeemed=false;
await assert.rejects(api.getWorkerToken(true),e=>e.code==='authorization_pending');await api.resumeWorkerAuthorization();
state.pageclipWorkerAuth.brokerOrigin='https://different-broker.test';
await assert.rejects(api.getWorkerToken(false),e=>e.code==='broker_changed');
console.log('Worker auth adapter mock tests passed: persisted handshake/restart, polling, access cache, forced refresh, network preservation, account mismatch, durable revocation/delete.');
