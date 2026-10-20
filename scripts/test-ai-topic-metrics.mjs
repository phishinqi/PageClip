import assert from 'node:assert/strict';
import { cosineSimilarity,adjustedRandIndex,normalizedMutualInformation,evaluateTopicQuality } from './ai-topic-metrics.mjs';
assert.equal(cosineSimilarity([1,0],[1,0]),1);
assert.equal(cosineSimilarity([1,0],[0,1]),0);
assert.equal(cosineSimilarity([1,0],[-1,0]),-1);
assert.ok(Math.abs(cosineSimilarity([1e308,1e308],[1e308,1e308])-1)<1e-12);
for(const pair of [[[0,0],[1,2]],[[1],[1,2]],[[NaN],[1]],[[Infinity],[1]],[[],[]]])assert.throws(()=>cosineSimilarity(...pair),TypeError);
const a=[0,0,1,1],same=[2,2,3,3],cross=[0,1,0,1];
assert.equal(adjustedRandIndex(a,same),1);assert.equal(normalizedMutualInformation(a,same),1);
assert.ok(Math.abs(adjustedRandIndex(a,cross)+0.5)<1e-12);assert.equal(normalizedMutualInformation(a,cross),0);
assert.equal(adjustedRandIndex([0,0],[1,1]),1);assert.equal(normalizedMutualInformation([0,0],[1,1]),1);
assert.equal(adjustedRandIndex([0],[1]),1);assert.equal(normalizedMutualInformation([0],[1]),1);
assert.equal(normalizedMutualInformation([0,0],[0,1]),0);
for(const args of [[[],[]],[[0],[1,2]],[[{}],[0]],[[NaN],[0]]]){
 assert.throws(()=>adjustedRandIndex(...args),TypeError);assert.throws(()=>normalizedMutualInformation(...args),TypeError);
}
const result=evaluateTopicQuality(a.map((cluster,i)=>({category:i<2?'high':'low',originalEmbedding:[1,0],normalizedEmbedding:i<2?[1,0]:[0,1],originalCluster:cluster,normalizedCluster:same[i]})));
assert.equal(result.count,4);assert.equal(result.meanCosineSimilarity,0.5);assert.equal(result.minCosineSimilarity,0);assert.equal(result.adjustedRandIndex,1);assert.equal(result.normalizedMutualInformation,1);
assert.equal(result.categories[0].category,'low');
assert.throws(()=>evaluateTopicQuality([]),TypeError);
console.log('Offline topic quality metric formulas passed on synthetic vectors/labels; no real embedding quality measurement was performed.');
