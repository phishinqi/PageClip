// Broker sees OAuth credentials only, never PageClip records or encryption keys.
import { GOOGLE_WORKER_ORIGIN } from './google-worker-config.js';
import { loadData } from './store.js';
const KEY = 'pageclipWorkerAuth';
export const WORKER_AUTH_ALARM = 'pageclip-worker-auth';
const fail = (kind, code, retryAfter = null) => Object.assign(new Error(code === 'authorization_pending' ? '已打开 Google 授权页面；完成后返回 PageClip，后台会自动继续' : {auth:'Google 授权需重新连接',retry:'认证服务暂不可用，稍后重试',permission:'Google 授权权限不足'}[kind]), { name:'GoogleAuthError', kind, code, retryAfter });
let flight = null;
function endpoint() {
  if (!GOOGLE_WORKER_ORIGIN) throw fail('auth','publisher_not_configured');
  const url = new URL(GOOGLE_WORKER_ORIGIN);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw fail('auth','publisher_not_configured');
  return url.origin;
}
export function workerAuthConfigured() { return !!GOOGLE_WORKER_ORIGIN; }
async function read() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const state=(await chrome.storage.local.get(KEY))[KEY] || {};
  if((state.credential || state.pending) && state.brokerOrigin!==endpoint())throw fail('auth','broker_changed');
  return state;
}
async function write(state) { await chrome.storage.local.set({[KEY]:{...state,brokerOrigin:endpoint()}}); }
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function challenge(verifier) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
async function request(path, {body,credential,method='POST'}={}) {
  let response;
  try { response = await fetch(endpoint()+path,{method,headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)}); }
  catch(error) { if(error?.name==='GoogleAuthError')throw error;throw fail('retry','broker_transport'); }
  if(response.status===204)return {};
  let result;try {result=await response.json();}catch{throw fail('retry','broker_response');}
  if(!response.ok){
    const allowed=['pending','invalid_grant','revoked','account_mismatch','scope','session_expired','revoking','invalid_credential','rate_limited','already_redeemed','invalid_redemption','reauthorization_required','permission_required','authorization_denied','authorization_cancelled'];
    const code=allowed.includes(result.error)?result.error:'broker_rejected';
    const seconds=Number(response.headers.get('Retry-After'));
    const retryAfter=Number.isFinite(seconds)&&seconds>0?seconds*1000:Math.max(0,Number(result.retryAfter)||0);
    throw fail(code==='pending'||response.status===429||response.status>=500?'retry':result.kind==='permission'?'permission':'auth',code,retryAfter);
  }
  return result;
}
function validateToken(result) {
  if(typeof result?.accessToken!=='string'||!result.accessToken||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||typeof result.email!=='string'||!result.email||typeof result.subject!=='string'||!result.subject)throw fail('auth','broker_incomplete');
}
async function validateBinding(result, prior={}) {
  validateToken(result);
  const bound=(await loadData())._sync?.account;
  if(bound && bound!==result.email || prior.subject && prior.subject!==result.subject)throw fail('auth','account_mismatch');
}
async function schedule(when=Date.now()+60000) { await chrome.alarms?.create?.(WORKER_AUTH_ALARM,{when}); }
async function begin() {
  endpoint();
  const prior=await read();
  if(prior.revoking)throw fail('auth','revoking');
  // Reuse an interrupted handshake, never create unbounded parallel sessions.
  if(prior.pending)throw fail('auth',prior.pending.failed?'disconnect_required':'authorization_pending');
  const verifier=random(),credential=random();
  const account=(await loadData())._sync?.account || prior.email || undefined;
  const started=await request('/v1/start',{credential:prior.credential,body:{challenge:await challenge(verifier),...(account?{account}:{})}});
  const authUrl=new URL(started.authorizeUrl);
  if(authUrl.origin!==endpoint()||authUrl.pathname!=='/authorize'||typeof started.id!=='string'||!Number.isFinite(started.expiresAt))throw fail('auth','broker_incomplete');
  const pending={id:started.id,verifier,credential,expiresAt:started.expiresAt,attempts:0};
  await write({...prior,pending,error:null});
  await schedule(); // Persist before opening UI; page closure cannot lose handshake.
  try {await chrome.tabs.create({url:authUrl.href,active:true});}
  catch{throw fail('auth','authorization_window_failed');}
}
async function resume() {
  let state=await read();
  if(state.revoking){await deleteConnection(state);return {disconnected:true};}
  if(!state.pending){if(state.needsActivation)await schedule();return {pending:false,connected:!!state.needsActivation};}
  const pending=state.pending;
  try{
    let result;
    if(pending.expiresAt<=Date.now()){
      // The receipt may expire after Google/D1 committed but the response was lost.
      // Candidate credential is retained until its connection is recovered or absent.
      result=await request('/v1/token',{credential:pending.credential,body:{}});
    }else{
      try{result=await request('/v1/redeem',{body:{id:pending.id,verifier:pending.verifier,credential:pending.credential}});}
      catch(e){if(e.code!=='invalid_redemption')throw e;result=await request('/v1/token',{credential:pending.credential,body:{}});}
    }
    await validateBinding(result,state);
    const latest=await read();if(latest.pending?.id!==pending.id)throw fail('auth','disconnected');
    // Atomic credential/token commit. A lost response can redeem the same proof again.
    await write({credential:pending.credential,accessToken:result.accessToken,expiresAt:result.expiresAt,email:result.email,subject:result.subject,error:null,needsActivation:true,enableSync:!!state.enableSync});
    await schedule(); // Retry account/key activation if its network/storage commit fails.
    return {connected:true};
  }catch(error){
    const latest=await read();if(latest.pending?.id!==pending.id)throw error;
    if(error.kind==='retry'){
      pending.attempts=Math.min((pending.attempts||0)+1,8);
      await write({...latest,pending,error:error.code});
      const delay=error.code==='pending'?60000:Math.min(3600000,30000*2**pending.attempts)*(0.5+Math.random()*0.5);
      await schedule(Date.now()+Math.max(delay,error.retryAfter||0));
    }else{
      const absent=error.code==='invalid_credential';
      await write({...latest,pending:absent?null:{...pending,failed:true},enableSync:false,error:absent?'session_expired':error.code});
      await chrome.alarms?.clear?.(WORKER_AUTH_ALARM);
    }
    throw error;
  }
}
async function acquire(interactive) {
  endpoint();
  let state=await read();
  if(state.revoking)throw fail('auth','revoking');
  if(state.pending){try{await resume();}catch(e){if(!interactive || e.kind==='retry')throw e;}state=await read();}
  if(state.accessToken&&state.expiresAt>Date.now()+60000){
    await validateBinding({accessToken:state.accessToken,expiresAt:state.expiresAt,email:state.email,subject:state.subject},state);
    return state.accessToken;
  }
  if(state.credential){
    try{
      const result=await request('/v1/token',{credential:state.credential,body:{force:!!state.force}});
      await validateBinding(result,state);
      const latest=await read();if(latest.credential!==state.credential||latest.revoking)throw fail('auth','disconnected');
      await write({...state,accessToken:result.accessToken,expiresAt:result.expiresAt,force:false,error:null});return result.accessToken;
    }catch(e){
      if(e.kind==='retry')throw e;
      const latest=await read();
      if(latest.credential!==state.credential || latest.revoking)throw fail('auth','disconnected');
      await write({...latest,credential:e.code==='invalid_credential'?null:latest.credential,accessToken:null,expiresAt:null,error:e.code});
      if(!interactive)throw e;
    }
  }
  if(!interactive)throw fail('auth','reauthorize');
  await begin();throw fail('auth','authorization_pending');
}
export async function getWorkerToken(interactive=false) {
  if(flight)return flight;
  const run=()=>acquire(interactive);
  flight=globalThis.navigator?.locks?.request?navigator.locks.request('pageclip-worker-auth',run):run();
  try{return await flight;}finally{flight=null;}
}
export async function clearWorkerToken(rejected=null) {
  const state=await read();if(!rejected||state.accessToken===rejected)await write({...state,accessToken:null,expiresAt:null,force:true});
}
async function deleteConnection(state) {
  try{
    if(state.pending){
      try{await request('/v1/cancel',{body:{id:state.pending.id,verifier:state.pending.verifier}});}
      catch(error){
        if(error.code!=='already_redeemed' && error.code!=='invalid_redemption')throw error;
        try{await request('/v1/connection',{method:'DELETE',credential:state.pending.credential});}
        catch(e){if(e.code!=='invalid_credential')throw e;}
      }
    }
    if(state.credential){
      try{await request('/v1/connection',{method:'DELETE',credential:state.credential});}
      catch(e){if(e.code!=='invalid_credential')throw e;}
    }
    // Do not erase a new connection committed by another context.
    const latest=await read();if(latest.credential===state.credential)await chrome.storage.local.remove(KEY);
    await chrome.alarms?.clear?.(WORKER_AUTH_ALARM);
  }catch(error){
    if(error.code==='invalid_credential' && !state.pending){await chrome.storage.local.remove(KEY);return;}
    // Retain only a revocation credential for durable retry, never allow Drive access.
    await write({credential:state.credential,pending:state.pending,revoking:true,error:'revoking'});await schedule(Date.now()+Math.max(error.retryAfter||0,60000));throw error;
  }
}
export async function disconnectWorkerAuth() {
  const run=async()=>{
    const state=await read();await write({credential:state.credential,pending:state.pending,revoking:true});
    await deleteConnection(state);
  };
  return globalThis.navigator?.locks?.request?navigator.locks.request('pageclip-worker-auth',run):run();
}
export async function resumeWorkerAuthorization() {
  if(!workerAuthConfigured())return {pending:false};
  const run=()=>resume();
  return globalThis.navigator?.locks?.request?navigator.locks.request('pageclip-worker-auth',run):run();
}
export async function requestWorkerSyncActivation() {
  if(!workerAuthConfigured())return;
  const state=await read();await write({...state,enableSync:true});
}
export async function clearWorkerSyncActivation() {
  if(!workerAuthConfigured())return;
  const state=await read();await write({...state,enableSync:false});
}
export async function workerSyncActivationRequested() { return !!(await read()).enableSync; }
export async function acknowledgeWorkerActivation() {
  const state=await read();
  if(state.credential && !state.revoking){await write({...state,needsActivation:false,enableSync:false});await chrome.alarms?.clear?.(WORKER_AUTH_ALARM);}
}
export async function workerAuthDiagnostics() {
  const state=await read();
  return {configured:workerAuthConfigured(),phase:state.revoking?'revoking':state.pending?'awaiting-authorization':state.accessToken?'token-received':state.error?'failed':'not-started',expiresAt:state.expiresAt||null,hasConnection:!!state.credential,errorCode:state.error||null};
}
