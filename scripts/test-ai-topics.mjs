import assert from 'node:assert/strict';
import { normalizeTopicRules, normalizeBookmarkTopic, normalizeTopicPayload } from '../js/ai-topics.js';
import { nextBatch, byteSize, AI_BODY_LIMIT, prepareItems, validateOutput } from '../js/ai-model.js';
assert.deepEqual(normalizeTopicRules(), {version:1,enabled:false});
for (const value of [null,[],true,{enabled:'true'},{version:2}]) assert.throws(()=>normalizeTopicRules(value),/INVALID_TOPIC_RULES/);
assert.ok(Object.isFrozen(normalizeTopicRules({enabled:true})));
const item=title=>({itemId:'untouched-id',title,url:'https://example.com/逆向',folderId:'folder-id',tags:[]});
const cases=[
 ['Android逆向教程','Android程序分析教程','程序分析','Android','教程'],
 ['iOS逆向工程笔记','iOS程序分析笔记','程序分析','iOS','笔记'],
 ['XX游戏鉴权缺陷验证热补丁 PoC下载','XX游戏授权机制分析补丁下载','授权机制分析',null,'下载'],
 ['白盒鉴权脆弱性测试版软件合集','非官方修改版软件合集','软件修改研究',null,'合集'],
 ['WiFi密码白盒鉴权脆弱性测试教程','WiFi密码无线网络安全测试教程','无线网络安全测试','WiFi','教程'],
 ['Windows授权凭证生成逻辑复现','Windows授权机制分析工具','授权机制分析','Windows','工具'],
 ['二进制内存转储与还原解包笔记','二进制解包分析笔记','二进制分析',null,'笔记'],
 ['Android Hook工具源码','Android 运行时拦截分析工具源码','运行时分析','Android','源码'],
 ['XX游戏进程内存完整性测试程序','XX游戏运行时分析工具','运行时分析',null,'工具'],
 ['ELF逆向工具下载','ELF二进制分析工具下载','二进制分析',null,'工具'],
];
for(const [title,expected,topic,platform,resource] of cases){
 const input=item(title),before=structuredClone(input),result=normalizeBookmarkTopic(input);
 assert.equal(result.item.title,expected);
 assert.ok(result.item.topicHints.topics.includes(topic));
 if(platform)assert.ok(result.item.topicHints.platforms.includes(platform));
 assert.ok(result.item.topicHints.resourceTypes.includes(resource));
 assert.equal(result.item.itemId,input.itemId);assert.equal(result.item.folderId,input.folderId);assert.equal(result.item.url,input.url);
 assert.deepEqual(input,before);assert.ok(result.stats.replacements>0);
}
for(const title of ['逆向思维：如何解决问题','Android开发者的逆向思维','软件白盒鉴权脆弱性测试难题的方法','白盒鉴权脆弱性测试难题的方法','逆向人生','普通软件工具合集','逆向教程']){
 const result=normalizeBookmarkTopic(item(title));assert.equal(result.item.title,title);assert.equal(result.item.topicHints,undefined);
}
// A broad technical folder/tag does not turn ordinary expressions into program analysis.
assert.equal(normalizeBookmarkTopic({...item('逆向思维：如何解决问题'),tags:['软件']}).item.title,'逆向思维：如何解决问题');
const contextual=normalizeBookmarkTopic({...item('Android工具'),tags:['逆向'],note:'Hook 笔记'});
assert.deepEqual(contextual.item.tags,['程序分析']);assert.equal(contextual.item.note,'运行时拦截分析 笔记');
assert.equal(normalizeBookmarkTopic(item('Android hookworm工具')).stats.replacements,0);
// No repeated normalization of produced terms or guessed product-name extraction.
const original=item('Android逆向工程从入门到精通 白盒鉴权脆弱性测试版工具合集');
const once=normalizeBookmarkTopic(original);
assert.equal(once.item.title,'Android程序分析从入门到精通 非官方修改版工具合集');
assert.deepEqual(once.item.topicHints.resourceTypes,['教程','工具','合集','修改版本']);
assert.equal(normalizeBookmarkTopic(once.item).item.title,once.item.title);
assert.equal(normalizeBookmarkTopic(item('Android逆向笔记')).item.topicHints.topics[0],normalizeBookmarkTopic(item('Android逆向教程')).item.topicHints.topics[0]);
const folders=[{id:'same-id',path:'软件 / 逆向',system:false}],tags=['逆向','逆向思维'],candidates=[{tempId:'temp',name:'Android逆向工具',parentFolderId:'same-id'}];
const disabled=normalizeTopicPayload([original],folders,tags,candidates);
assert.deepEqual(disabled,{items:[original],folders,tags,newFolders:candidates,stats:{replacements:0,fields:0,bookmarks:0}});
const categorized=normalizeTopicPayload([original],folders,tags,candidates,{enabled:true});
assert.equal(categorized.folders[0].path,'软件 / 程序分析');
assert.deepEqual(categorized.tags,['程序分析','逆向思维']);
assert.equal(categorized.newFolders[0].name,'Android程序分析工具');assert.equal(categorized.newFolders[0].tempId,'temp');
assert.equal(categorized.stats.bookmarks,1);
const mixedCatalog=normalizeTopicPayload([original],[{id:'fishing',path:'Fishing Hook tools'},{id:'ordinary',path:'逆向思维笔记'}],['Fishing Hook'],[],{enabled:true});
assert.equal(mixedCatalog.folders[0].path,'Fishing Hook tools');assert.equal(mixedCatalog.folders[1].path,'逆向思维笔记');assert.equal(mixedCatalog.tags[0],'Fishing Hook');
// Categorization precedes privacy filtering, including every structured hint value.
const prepared=prepareItems([{id:'raw-id',title:'Android逆向教程',url:'https://example.com/path?private=query#secret',folderId:'f',tags:[],note:'private note'}],true).eligible;
const raw=structuredClone(prepared);
const batch=nextBatch(prepared,folders,['逆向'],candidates,'en',{enabled:true,words:['Android','程序分析','private']},{enabled:true});
const wire=JSON.parse(batch.body.messages[1].content),bookmark=wire.bookmarks[0];
assert.equal(bookmark.itemId,'raw-id');assert.equal(bookmark.folderId,'f');
assert.equal(bookmark.url,'https://example.com/path');
assert.ok(!JSON.stringify(wire).includes('Android'));assert.ok(!JSON.stringify(wire).includes('程序分析'));assert.ok(!JSON.stringify(wire).includes('private'));
assert.ok(!JSON.stringify(wire).includes('逆向'));
assert.deepEqual(prepared,raw);assert.deepEqual(batch.batch[0],prepared[0]);assert.equal(batch.topics.bookmarks,1);assert.ok(batch.redaction.fields>0);
assert.ok(byteSize(batch.body)<=AI_BODY_LIMIT);
// A candidate echo is checked against the exact wire copy without renaming the local preview.
const data={folders:[{id:'same-id',name:'Work',system:false}],items:[],urlTags:{}};
const echoed={newFolders:batch.sentCandidates,suggestions:[{itemId:'raw-id',targetFolderId:null,newFolderTempId:'temp',addTags:[],reason:'Reviewed'}]};
assert.deepEqual(validateOutput(JSON.stringify(echoed),batch.batch,data,candidates,batch.sentCandidates).newFolders,candidates);
assert.throws(()=>validateOutput(JSON.stringify(echoed),batch.batch,data,candidates),/AI_INVALID_FOLDER/);
const unexpected=structuredClone(echoed);unexpected.newFolders[0].name='Unrequested rename';
assert.throws(()=>validateOutput(JSON.stringify(unexpected),batch.batch,data,candidates,batch.sentCandidates),/AI_INVALID_FOLDER/);
const longCandidate=[{tempId:'temp',name:'Android Hook'.repeat(4),parentFolderId:null}];
const longWire=nextBatch(prepared,[],[],longCandidate,'en',{}, {enabled:true});
assert.ok(longWire.sentCandidates[0].name.length>50);
const longEcho={...echoed,newFolders:longWire.sentCandidates};
assert.deepEqual(validateOutput(JSON.stringify(longEcho),prepared,data,longCandidate,longWire.sentCandidates).newFolders,longCandidate);
const tooLong=structuredClone(longEcho);tooLong.newFolders[0].tempId='new-temp';
assert.throws(()=>validateOutput(JSON.stringify(tooLong),prepared,data,longCandidate,longWire.sentCandidates),/AI_INVALID_FOLDER/);
const many=Array.from({length:25},(_,i)=>({...item('Android逆向教程'.repeat(45)),itemId:'long-'+i,note:'逆向'.repeat(900)}));
const limited=nextBatch(many,[],[],[],'en',{}, {enabled:true});
assert.ok(limited.batch.length<20);assert.ok(byteSize(limited.body)<=AI_BODY_LIMIT);
assert.deepEqual(JSON.parse(nextBatch(prepared,[],[],[],'en').body.messages[1].content).bookmarks,prepared);
console.log('AI topic categorization passed: context disambiguation, platform/product/resource retention, consistent categories, structured hints, privacy ordering, actual-byte batching and unchanged originals (mock only).');
