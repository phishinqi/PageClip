import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const source=(await readFile(new URL('../js/google-pkce.js',import.meta.url),'utf8')).replace(/^import[^;]+;\s*/gm,'').replace(/^export\s+/gm,'');
const state={}; let refresh=0, revoked=false, network=false, url;
const context={GOOGLE_AUTH_POLICY:{desktopExperiment:true},crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortSignal,Uint8Array,btoa,Date,console,setTimeout,clearTimeout,
 navigator:{userAgent:'Firefox/140'},
 chrome:{storage:{local:{setAccessLevel:async()=>{},get:async k=>({[k]:structuredClone(state[k])}),set:async v=>Object.assign(state,structuredClone(v)),remove:async k=>delete state[k]}},identity:{getRedirectURL:()=> 'https://example.extensions.allizom.org/',launchWebAuthFlow:async ({url:auth})=>{
 url=new URL(auth);const wrong=url.searchParams.get('redirect_uri')+'?state=wrong&code=c';assert.equal(await context.api.acceptPkceCallback(wrong),false);
 return url.searchParams.get('redirect_uri')+'?state='+url.searchParams.get('state')+'&code=one-use';}}},
 fetch:async (_url,init)=>{const fields=new URLSearchParams(init.body);assert.equal(fields.has('client_secret'),false);
 if(network)throw Error('offline');
 if(fields.get('grant_type')==='authorization_code'){assert.ok(fields.get('code_verifier').length>=43);assert.equal(fields.get('redirect_uri'),'http://127.0.0.1/mozoauth2/example');return new Response(JSON.stringify({access_token:'first',refresh_token:'refresh-1',expires_in:3600,token_type:'Bearer'}));}
 refresh++;if(revoked)return new Response(JSON.stringify({error:'invalid_grant'}),{status:400});
 return new Response(JSON.stringify({access_token:'renewed',refresh_token:'refresh-2',expires_in:3600,token_type:'Bearer'}));}};
vm.createContext(context);vm.runInContext(source+'\nglobalThis.api={pkceConfiguration,getPkceToken,clearPkceToken,disconnectPkce,acceptPkceCallback,desktopRedirect,pkceDiagnostics};',context);
await assert.rejects(context.api.getPkceToken(),e=>e.code==='desktop_client_required');
await context.api.pkceConfiguration('test.apps.googleusercontent.com');
assert.equal(await context.api.getPkceToken(true),'first');
assert.equal(url.searchParams.get('response_type'),'code');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));
assert.equal(await context.api.getPkceToken(false),'first');assert.equal(refresh,0);
await context.api.clearPkceToken('first');assert.equal(await context.api.getPkceToken(),'renewed');assert.equal(state.pageclipGooglePkce.refreshToken,'refresh-2');
// Worker restart: module state lost, durable refresh credential remains.
vm.runInContext('(async()=>{})()',context);state.pageclipGooglePkce.expiresAt=1;
network=true;await assert.rejects(context.api.getPkceToken(),e=>e.kind==='retry');assert.equal(state.pageclipGooglePkce.refreshToken,'refresh-2');network=false;
revoked=true;await assert.rejects(context.api.getPkceToken(),e=>e.code==='invalid_grant');assert.equal(state.pageclipGooglePkce.refreshToken,undefined);
revoked=false;assert.equal(await context.api.getPkceToken(true),'first');
await context.api.disconnectPkce();assert.equal(state.pageclipGooglePkce,undefined);
context.navigator.userAgent='Chrome/140 Edg/140';assert.equal(context.api.desktopRedirect().transport,'tab');
for (const [description, expected] of [['client_secret is missing.', 'client_secret_required'], ['redirect_uri mismatch', 'redirect_rejected'], ['Invalid code_verifier', 'pkce_rejected'], ['Other invalid input', 'invalid_request']]) {
 state.pageclipGooglePkce={pending:{state:'test-state',verifier:'verifier',clientId:'test.apps.googleusercontent.com',redirectUri:'http://127.0.0.1:43821/pageclip/oauth2',transport:'tab',tabId:7,expiresAt:Date.now()+60000}};
 context.fetch=async()=>new Response(JSON.stringify({error:'invalid_request',error_description:description+' PRIVATE-MARKER'}),{status:400});
 assert.equal(await context.api.acceptPkceCallback('http://127.0.0.1:43821/pageclip/oauth2?state=test-state&code=PRIVATE-CODE',7),false);
 const diagnostic=await context.api.pkceDiagnostics();
 assert.equal(diagnostic.errorCode,expected);assert.equal(diagnostic.phase,'failed');
 assert.equal(JSON.stringify(state).includes('PRIVATE-'),false);
 if(expected==='client_secret_required') {
   const original=context.chrome.identity.launchWebAuthFlow;
   context.chrome.identity.launchWebAuthFlow=()=>{throw Error('Known failed flow must not relaunch');};
   await assert.rejects(context.api.getPkceToken(true),e=>e.code==='client_secret_required');
   context.chrome.identity.launchWebAuthFlow=original;
 }
}
context.GOOGLE_AUTH_POLICY.desktopExperiment=false;
await assert.rejects(context.api.getPkceToken(true),e=>e.code==='release_unsupported');
await assert.rejects(context.api.pkceConfiguration('other.apps.googleusercontent.com'),e=>e.code==='release_unsupported');
console.log('PKCE mock tests passed: configuration, Firefox callback/state, S256 code exchange, expiry/rotation, offline preservation, revocation, reauthorization, disconnect, Chromium transport selection. Real Google/browser acceptance NOT tested.');
