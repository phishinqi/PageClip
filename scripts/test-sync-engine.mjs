import assert from 'node:assert/strict';
import { defaultData, saveData, loadData, ensureDataInitialized, mutate, importPayload, exportPayload } from '../js/store.js';
import { capture, ingest, heads, resolveConflict, project, canonical, validateOperation } from '../js/sync-model.js';
import { runSync, syncStatus, configureSync } from '../js/sync-runtime.js';

const copy = structuredClone;
const fresh = () => { const d = defaultData(); capture(d); return d; };
const item = (id, title = id) => ({ id, url: 'https://example.com/' + id, title, folderId: 'f_uncategorized', tags: [], note: '', createdAt: 1, updatedAt: 1, pinned: false, order: 0, chromeBookmarkIds: ['device-local'] });
const ops = d => Object.values(d._sync.ops);
const exchange = (a,b) => { const ao = copy(ops(a)), bo = copy(ops(b)); ingest(a,bo); ingest(b,ao); };
let scenarios = 0;
function test(name, fn) { fn(); scenarios++; console.log('PASS', name); }

test('first upload/import, remote add, repeat import and browser IDs stay local', () => {
  const a = fresh(), b = fresh(); a.items.push(item('a')); capture(a);
  exchange(a,b); assert.equal(b.items.length,1); assert.deepEqual(b.items[0].chromeBookmarkIds,[]);
  assert.deepEqual(a.items[0].chromeBookmarkIds,['device-local']);
  exchange(a,b); assert.equal(b.items.length,1); assert.equal(ops(b).length,1);
});
test('independent edits and remote edit without clock comparisons', () => {
  const a=fresh(), b=fresh(); a.items.push(item('a'), item('b')); capture(a); exchange(a,b);
  a.items[0].title='A'; b.items[1].title='B'; capture(a); capture(b); exchange(a,b);
  assert.equal(canonical(project(a)),canonical(project(b))); assert.equal(Object.keys(a._sync.conflicts).length,0);
});
test('same-base edits conflict, local display retained, explicit resolution converges', () => {
  const a=fresh(), b=fresh(); a.items.push(item('x')); capture(a); exchange(a,b);
  a.items[0].title='left'; b.items[0].title='right'; capture(a); capture(b); exchange(a,b);
  assert.equal(a.items[0].title,'left'); assert.equal(b.items[0].title,'right');
  const key='items/x'; assert.equal(a._sync.conflicts[key].length,2);
  const selected=heads(a._sync,key).find(o=>o.value.title==='right'); resolveConflict(a,key,selected.id); exchange(a,b);
  assert.equal(a.items[0].title,'right'); assert.equal(b.items[0].title,'right'); assert.equal(ops(a).length,4);
});
test('offline tombstone, concurrent delete/edit, restoration as new causal version', () => {
  const a=fresh(), b=fresh(); a.items.push(item('x')); capture(a); exchange(a,b);
  const offline=copy(b); a.items=[]; capture(a); exchange(a,b); assert.equal(b.items.length,0);
  exchange(a,offline); assert.equal(offline.items.length,0);
  offline.items.push(item('x','restored')); capture(offline); exchange(a,offline); assert.equal(a.items[0].title,'restored');
  a.items=[]; offline.items[0].title='edited'; capture(a); capture(offline); exchange(a,offline);
  assert.equal(a._sync.conflicts['items/x'].length,2); assert.ok(heads(a._sync,'items/x').some(o=>o.value===null));
});
test('duplicate ID mismatch, future protocol and missing parent rejected', () => {
  const a=fresh(); a.items.push(item('x')); capture(a); const op=ops(a)[0];
  assert.throws(()=>ingest(copy(a),[{...op,value:item('x','corrupt')}]),/身份冲突/);
  assert.throws(()=>ingest(fresh(),[{...op,protocol:2}]),/格式/);
  assert.throws(()=>ingest(fresh(),[{...op,id:crypto.randomUUID(),parents:['missing']}]),/父版本/);
  assert.throws(()=>validateOperation({...op,value:{...op.value,url:'javascript:alert(1)'}}),/格式/);
});
test('content identity ignores property order and device bookmark links', () => {
  const a=fresh(); a.items.push(item('x')); capture(a); const count=ops(a).length;
  a.items[0]=Object.fromEntries(Object.entries(a.items[0]).reverse()); a.items[0].chromeBookmarkIds=['other']; capture(a);
  assert.equal(ops(a).length,count);
});
test('clock skew is presentation only', () => {
  const a=fresh(), b=fresh(); a.items.push(item('x')); capture(a); exchange(a,b);
  a.items[0].title='new'; capture(a); const latest=ops(a).at(-1); latest.modifiedAt=-99999999;
  exchange(a,b); assert.equal(b.items[0].title,'new');
});
test('3000 objects and batched shuffled immutable log converge', () => {
  const a=fresh(), b=fresh(); for(let n=0;n<3000;n++) a.items.push(item('x'+n)); capture(a);
  const shuffled=ops(a).reverse(); for(let n=0;n<shuffled.length;n+=100) ingest(b,shuffled.slice(n,n+100));
  assert.equal(b.items.length,3000); assert.equal(canonical(project(a)),canonical(project(b)));
});

test('concurrent folder cycles and delete-versus-child are visible resolvable structural conflicts', () => {
  const a=fresh(), b=fresh();
  a.folders.push({id:'x',name:'X',parentId:null,order:1},{id:'y',name:'Y',parentId:null,order:2});capture(a);exchange(a,b);
  a.folders.find(f=>f.id==='x').parentId='y';b.folders.find(f=>f.id==='y').parentId='x';capture(a);capture(b);exchange(a,b);
  assert.ok(a._sync.conflicts['folders/x'] || a._sync.conflicts['folders/y']);
  const c=fresh(), d=fresh();c.folders.push({id:'p',name:'P',parentId:null,order:1});capture(c);exchange(c,d);
  c.folders=c.folders.filter(f=>f.id!=='p');d.folders.push({id:'child',name:'Child',parentId:'p',order:0});d.items.push({...item('orphan'),folderId:'p'});capture(c);capture(d);exchange(c,d);
  assert.equal(c.folders.find(f=>f.id==='child').parentId,null);assert.equal(c.items[0].folderId,'f_uncategorized');
  assert.ok(c._sync.conflicts['folders/child']);assert.ok(c._sync.conflicts['items/orphan']);
  const safe=heads(c._sync,'folders/child').find(o=>o.value.parentId===null);resolveConflict(c,'folders/child',safe.id);exchange(c,d);
  assert.equal(d.folders.find(f=>f.id==='child').parentId,null);
});

let stored=fresh(), failAck=false;
const alarms=new Map();
globalThis.chrome={ storage:{ local:{ async setAccessLevel(){}, async get(){return {bc_data:copy(stored)};}, async set(value){ if(failAck && value.bc_data._sync.outbox.length===0){failAck=false;throw new Error('simulated disk interruption');} stored=copy(value.bc_data); } } }, alarms:{create(name,value){alarms.set(name,value);},async clear(name){alarms.delete(name);},async get(name){return alarms.get(name);}} };
class Remote {
  constructor(){this.data=new Map();this.reads=0;this.writes=0;this.failure=null;}
  async initialize(){if(this.failure)throw this.failure;}
  async list(){return [...this.data.keys()].map(id=>({id,name:id}));}
  async read(e){this.reads++;return copy(this.data.get(e.id));}
  async append(op){if(this.failure)throw this.failure;this.writes++;this.data.set(op.id,copy(op));return {id:op.id,name:op.id};}
}
async function atest(name,fn){await fn();scenarios++;console.log('PASS',name);}
await atest('durable outbox survives restart and remote success before ack',async()=>{
  stored=fresh(); stored._sync.enabled=true;
  await mutate(d=>d.items.push(item('x'))); assert.equal(stored._sync.outbox.length,1);
  const remote=new Remote(); failAck=true;
  const r=await runSync({manual:true,storageAdapter:remote});assert.equal(r.ok,false);assert.equal(remote.data.size,1);assert.equal(stored._sync.outbox.length,1);
  const restarted=await import('../js/sync-runtime.js?restart=1');
  await restarted.runSync({manual:true,storageAdapter:remote});assert.equal(stored._sync.outbox.length,0);assert.equal(remote.data.size,1);
  const count=remote.reads;await restarted.runSync({manual:true,storageAdapter:remote});assert.equal(remote.reads,count);assert.equal(remote.writes,2);
});
await atest('remote download and import remain durable without echo uploads',async()=>{
  const a=fresh();a.items.push(item('remote'));capture(a);const remote=new Remote();for(const op of ops(a))remote.data.set(op.id,op);
  stored=fresh();stored._sync.enabled=true;await runSync({manual:true,storageAdapter:remote});assert.equal(stored.items.length,1);assert.equal(stored._sync.outbox.length,0);assert.equal(remote.writes,0);
  const before=canonical(project(stored));await ensureDataInitialized();assert.equal(canonical(project(stored)),before);assert.equal(stored._sync.outbox.length,0);
  await importPayload(exportPayload(stored));assert.equal(stored.items.length,1);
});
await atest('retry-after, auth/permission pause, local preservation, restart scheduling',async()=>{
  for(const kind of ['retry','auth','permission','format']){
    stored=fresh();stored._sync.enabled=true;await mutate(d=>d.items.push(item('pending')));const remote=new Remote();remote.failure={kind,retryAfter:120000};
    const before=canonical(project(stored));await runSync({manual:true,storageAdapter:remote});assert.equal(canonical(project(stored)),before);assert.equal(stored._sync.outbox.length,1);assert.equal(stored._sync.errorKind,kind);
    if(kind==='retry'){assert.ok(stored._sync.nextAttemptAt>Date.now()+119000);await configureSync();assert.ok(alarms.has('pageclip-causal-sync-retry'));}
    else {assert.equal(stored._sync.nextAttemptAt,null);assert.deepEqual(await runSync({storageAdapter:remote}),{skipped:true});}
    remote.failure=null;await runSync({manual:true,storageAdapter:remote});assert.equal(stored._sync.outbox.length,0);assert.equal(stored._sync.lastError,null);
  }
});
await atest('overlapping loops serialize, edits during upload are not acknowledged early',async()=>{
  stored=fresh();stored._sync.enabled=true;await mutate(d=>d.items.push(item('x')));const remote=new Remote();
  const append=remote.append.bind(remote);let edited=false;remote.append=async op=>{if(!edited){edited=true;await mutate(d=>{d.items[0].title='during-upload';});}return append(op);};
  await Promise.all([runSync({manual:true,storageAdapter:remote}),runSync({manual:true,storageAdapter:remote})]);assert.equal(remote.writes,1);assert.equal(stored._sync.outbox.length,1);assert.equal((await syncStatus()).lastSuccessAt,null);
  await runSync({manual:true,storageAdapter:remote});assert.equal(stored._sync.outbox.length,0);assert.equal(remote.data.size,2);
});
await atest('incomplete remote log never publishes success or overwrites local data',async()=>{
  stored=fresh();stored._sync.enabled=true;const remote=new Remote();const a=fresh();a.items.push(item('x'));capture(a);a.items[0].title='v2';capture(a);const child=ops(a).at(-1);remote.data.set(child.id,child);
  await runSync({manual:true,storageAdapter:remote});assert.equal(stored.items.length,0);assert.equal(stored._sync.errorKind,'retry');assert.equal(stored._sync.files,undefined);
  remote.data.set(ops(a)[0].id,ops(a)[0]);await runSync({manual:true,storageAdapter:remote});assert.equal(stored.items[0].title,'v2');
});
await atest('durable download checkpoints survive interruption before complete listing',async()=>{
  const source=fresh();for(let n=0;n<9;n++)source.items.push(item('remote'+n));capture(source);
  const remote=new Remote();for(const op of ops(source))remote.data.set(op.id,op);
  stored=fresh();stored._sync.enabled=true;
  const read=remote.read.bind(remote);let failed=false;
  remote.read=async entry=>{if(remote.reads>=4&&!failed){failed=true;throw {kind:'retry'};}return read(entry);};
  await runSync({manual:true,storageAdapter:remote});assert.equal(Object.keys(stored._sync.downloads).length,4);assert.equal(stored.items.length,0);
  remote.read=read;const restart=await import('../js/sync-runtime.js?checkpoint=1');await restart.runSync({manual:true,storageAdapter:remote});
  assert.equal(stored.items.length,9);assert.deepEqual(stored._sync.downloads,{});
});
await atest('edits while authorization is paused survive worker restart and reauthorization', async () => {
  stored=fresh(); stored._sync.enabled=true;
  const remote=new Remote(); remote.failure={kind:'auth'};
  await mutate(d=>d.items.push(item('before-expiry')));
  await runSync({storageAdapter:remote});
  assert.equal(stored._sync.errorKind,'auth');
  const device=stored._sync.device;
  await mutate(d=>d.items.push(item('during-auth-outage')));
  const pending=copy(stored._sync.outbox);
  const restarted=await import('../js/sync-runtime.js?auth-restart=1');
  assert.deepEqual(await restarted.runSync({storageAdapter:remote}),{skipped:true});
  assert.deepEqual(stored._sync.outbox,pending);
  remote.failure=null;
  await restarted.runSync({manual:true,storageAdapter:remote});
  assert.equal(stored._sync.outbox.length,0); assert.equal(remote.data.size,2);
  assert.equal(stored._sync.device,device); assert.equal(stored.items.length,2);
});
console.log(`Sync engine tests passed: ${scenarios} scenarios`);
