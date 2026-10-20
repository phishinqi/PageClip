// Offline evaluation of locally supplied vectors/cluster labels. Never sends titles or requests.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length ||
      [...a,...b].some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('Invalid embedding pair');
  // Scale first to avoid overflowing on large but finite vectors.
  const scaleA=Math.max(...a.map(Math.abs)), scaleB=Math.max(...b.map(Math.abs));
  if (!scaleA || !scaleB) throw new TypeError('Zero embedding vector');
  let dot=0, aa=0, bb=0;
  for(let i=0;i<a.length;i++){const x=a[i]/scaleA,y=b[i]/scaleB;dot+=x*y;aa+=x*x;bb+=y*y;}
  return Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb)));
}
function contingency(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length||[...a,...b].some(v=>!['number','string'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v))))throw new TypeError('Invalid cluster labels');
  const rows=new Map(),cols=new Map(),cells=new Map();
  a.forEach((label,i)=>{rows.set(label,(rows.get(label)||0)+1);cols.set(b[i],(cols.get(b[i])||0)+1);const row=cells.get(label)||new Map();row.set(b[i],(row.get(b[i])||0)+1);cells.set(label,row)});
  return{rows,cols,cells,n:a.length};
}
const choose2=n=>n*(n-1)/2;
export function adjustedRandIndex(a,b){
  const {rows,cols,cells,n}=contingency(a,b);
  if(n<2)return 1;
  const pairs=[...cells.values()].flatMap(row=>[...row.values()]).reduce((s,v)=>s+choose2(v),0);
  const left=[...rows.values()].reduce((s,v)=>s+choose2(v),0),right=[...cols.values()].reduce((s,v)=>s+choose2(v),0);
  const expected=left*right/choose2(n),maximum=(left+right)/2;
  return maximum===expected?1:(pairs-expected)/(maximum-expected);
}
export function normalizedMutualInformation(a,b){
  const {rows,cols,cells,n}=contingency(a,b);
  const entropy=counts=>[...counts.values()].reduce((s,v)=>s-(v/n)*Math.log(v/n),0);
  const h1=entropy(rows),h2=entropy(cols);
  if(h1+h2===0)return 1;
  let information=0;
  for(const [left,row]of cells)for(const [right,count]of row)information+=(count/n)*Math.log(count*n/(rows.get(left)*cols.get(right)));
  return Math.max(0,Math.min(1,2*information/(h1+h2)));
}
export function evaluateTopicQuality(records){
  if(!Array.isArray(records)||!records.length)throw new TypeError('Expected nonempty evaluation records');
  const groups=new Map(),scores=[],left=[],right=[];
  for(const record of records){
    const score=cosineSimilarity(record.originalEmbedding,record.normalizedEmbedding),category=String(record.category||'uncategorized');
    const group=groups.get(category)||[];group.push(score);groups.set(category,group);scores.push(score);left.push(record.originalCluster);right.push(record.normalizedCluster);
  }
  const mean=values=>values.reduce((s,v)=>s+v,0)/values.length;
  return{count:records.length,meanCosineSimilarity:mean(scores),minCosineSimilarity:Math.min(...scores),
    adjustedRandIndex:adjustedRandIndex(left,right),normalizedMutualInformation:normalizedMutualInformation(left,right),
    categories:[...groups].map(([category,values])=>({category,count:values.length,meanCosineSimilarity:mean(values),minCosineSimilarity:Math.min(...values)})).sort((a,b)=>a.meanCosineSimilarity-b.meanCosineSimilarity)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(!process.argv[2])throw new Error('Usage: node scripts/ai-topic-metrics.mjs <local-vectors-and-labels.json>');
    console.log(JSON.stringify(evaluateTopicQuality(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2));
  }catch(error){console.error(error instanceof TypeError?error.message:'Evaluation input unavailable or invalid');process.exitCode=1;}
}
