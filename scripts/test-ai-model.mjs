import assert from 'node:assert/strict';
import { publicUrl, prepareItems, nextBatch, validateOutput, byteSize, AI_BODY_LIMIT } from '../js/ai-model.js';
const data = { folders: [{ id: 'u', name: 'Uncategorized', system: true }, { id: 'f', name: 'Work', parentId: null }], items: [{ id: 'a', tags: ['JavaScript'] }], urlTags: {} };
assert.equal(publicUrl('https://name:pass@example.com/a?q=secret#token'), 'https://example.com/a');
for (const url of ['file:///home/test','http://localhost/a','http://127.0.0.1','http://[::1]/','https://intranet/a','https://x.local/a']) assert.equal(publicUrl(url), null);
const items = Array.from({length: 45}, (_, i) => ({ id: String(i), url: `https://example.com/${i}?secret=x`, title: 'Title', folderId: 'u', tags: [], note: 'private' }));
const prepared = prepareItems(items);
assert.equal(prepared.eligible.length,45); assert.equal('note' in prepared.eligible[0],false);
const {batch, body} = nextBatch(prepared.eligible,data.folders,[],[],'en');
assert.equal(batch.length,20);assert.ok(byteSize(body)<=AI_BODY_LIMIT);
const one = [prepared.eligible[0]];
const output = {newFolders:[{tempId:'n',name:'Research',parentFolderId:null}],suggestions:[{itemId:'0',targetFolderId:null,newFolderTempId:'n',addTags:['javascript','Research','Tools','Fourth'],reason:'A reason'}]};
const validated = validateOutput(JSON.stringify(output),one,data);
assert.deepEqual(validated.suggestions[0].addTags,['JavaScript','Research','Tools']);
assert.equal(validated.suggestions[0].limited,1);
assert.equal(validateOutput('```json\n'+JSON.stringify(output)+'\n```',one,data).newFolders.length,1);
for(const mutate of [x=>x.suggestions[0].itemId='bad',x=>x.suggestions.push(x.suggestions[0]),x=>x.suggestions=[],x=>x.suggestions[0].targetFolderId='missing',x=>x.newFolders[0].parentFolderId='u',x=>x.suggestions[0].reason=42,x=>x.newFolders[0].tempId='constructor',x=>x.newFolders[0].name='Research\nDocs',x=>x.suggestions[0].addTags=['AI\nResearch']]) {
 const o=structuredClone(output);mutate(o);assert.throws(()=>validateOutput(JSON.stringify(o),one,data));
}
assert.throws(()=>validateOutput('{broken',one,data));
const tags = Array.from({length:12},(_,i)=>'tag'+i);const full=[{...one[0],tags}];assert.equal(validateOutput(JSON.stringify(output),full,data).suggestions[0].addTags.length,0);
console.log('AI model tests passed: privacy, batching, strict schema, candidates and tag limits');
// Privacy-preserving redaction is applied to values before sizing each request.
const rules = { enabled: true, words: ['Title', 'example.com', 'private', 'Work', 'Research'] };
const redacted = nextBatch(prepareItems(items, true).eligible, [{id:'work-id',path:'Work',system:false}], ['Research'], [{tempId:'n',name:'Research',parentFolderId:'work-id'}], 'en', rules);
const wire = JSON.parse(redacted.body.messages[1].content);
assert.equal(wire.bookmarks[0].itemId,'0');
assert.equal(wire.bookmarks[0].folderId,'u');
assert.equal(wire.folders[0].id,'work-id');
assert.equal(wire.newFolderCandidates[0].tempId,'n');
assert.equal(wire.newFolderCandidates[0].parentFolderId,'work-id');
const sentValues=[wire.bookmarks[0].title,wire.bookmarks[0].url,wire.bookmarks[0].note,wire.folders[0].path,...wire.existingTags,wire.newFolderCandidates[0].name].join(' ');
for (const word of rules.words) assert.ok(!sentValues.toLowerCase().includes(word.toLowerCase()), 'sensitive text values must not leave in request');
assert.ok(wire.bookmarks[0].url.startsWith('[已脱敏_'));
assert.equal(redacted.batch[0].title,'Title');
assert.equal(items[0].note,'private');
assert.ok(redacted.redaction.replacements>0);
// Expansion of short words into placeholders forces actual smaller batches.
const tiny = Array.from({length:30},(_,i)=>({itemId:'tiny'+i,title:'x'.repeat(500),url:'https://example.com/'+i,folderId:'u',tags:[],note:'x'.repeat(2000)}));
const expanded = nextBatch(tiny,[],[],[],'en',{enabled:true,words:['x']});
assert.ok(expanded.batch.length<20);
assert.ok(byteSize(expanded.body)<=AI_BODY_LIMIT);
// Strong reduction happens before the budget check; a long catalog becomes sendable.
const longWord='z'.repeat(100);
const hugeCatalog=Array.from({length:200},(_,i)=>({id:'catalog'+i,path:longWord.repeat(8)}));
assert.throws(()=>nextBatch(tiny,hugeCatalog,[],[],'en'),/AI_CONTEXT_TOO_LARGE/);
const reduced=nextBatch(tiny,hugeCatalog,[],[],'en',{enabled:true,words:[longWord]});
assert.ok(byteSize(reduced.body)<=AI_BODY_LIMIT);
console.log('AI redacted batching passed: mock wire excludes sensitive values, structural IDs unchanged, actual byte expansion/reduction respected');
