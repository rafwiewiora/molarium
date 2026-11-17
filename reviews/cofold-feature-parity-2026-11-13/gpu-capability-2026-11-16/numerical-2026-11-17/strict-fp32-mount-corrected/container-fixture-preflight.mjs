import {readFile,stat,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
const[planPath,output]=process.argv.slice(2);const plan=JSON.parse(await readFile(planPath));
assert.equal(plan.schema,'molarium.canonical-fixture-mount-plan.v1');
const sha=b=>createHash('sha256').update(b).digest('hex'),records=[];
for(const track of plan.tracks){
 for(const item of track.files){
  const path=track.requested+'/'+item.relative,s=await stat(path);
  assert(s.isFile()&&s.size===item.bytes,'Wrong or invisible fixture '+path);
  const prefix=await Bun.file(path).slice(0,Math.min(16,item.bytes)).arrayBuffer();
  assert.equal(prefix.byteLength,Math.min(16,item.bytes));
  records.push({path,bytes:s.size,openedPrefixBytes:prefix.byteLength,prefixSha256:sha(Buffer.from(prefix))});
 }
}
const fixture=plan.tracks[0].requested,receipt=await readFile(fixture+'/receipt.json');
assert.equal(sha(receipt),plan.fixtureReceiptSha256);
const result={schema:'molarium.container-fixture-open-preflight.v1',status:'verified',files:records.length,fixtureReceiptSha256:sha(receipt),planSha256:sha(await readFile(planPath)),records,newNativeCalls:0,newNeuralForwards:0};
if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,files:result.files,fixtureReceiptSha256:result.fixtureReceiptSha256,newNeuralForwards:0}));
