import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const protocol=JSON.parse(readFileSync(new URL('./protocol.json',import.meta.url)));
test('scoring rejects omitted cases, wrong packet hashes and duplicate rows',()=>{
  const dir=mkdtempSync(join(tmpdir(),'molarium-benchmark-score-test-'));
  try{
    const packet={protocol,protocolSha256:'test',cases:[{id:'x',molecule:{atoms:[{}]}}]};
    const bytes=JSON.stringify(packet),hash=createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir,'packet.json'),bytes);
    const result={energy:0,forces:[0,0,0],components:{bond:0}};
    const reference={platform:'Reference',protocolSha256:'test',packetSha256:hash,
      cases:[{id:'x',status:'ok',original:result,rounded:result}]};
    writeFileSync(join(dir,'reference.json'),JSON.stringify(reference));
    const valid={protocolSha256:'test',packetSha256:hash,cases:[{id:'x',status:'ok',result}]};
    for(const [i,actual] of [valid,{...valid,cases:[]},{...valid,packetSha256:'wrong'},
      {...valid,cases:[...valid.cases,...valid.cases]}].entries()){
      writeFileSync(join(dir,'actual.json'),JSON.stringify(actual));
      const p=spawnSync(process.execPath,[new URL('./score.mjs',import.meta.url).pathname,
        '--packet',join(dir,'packet.json'),'--reference',join(dir,'reference.json'),
        '--actual',join(dir,'actual.json'),'--output',join(dir,`score${i}.json`)]);
      assert.equal(p.status===0,i===0,p.stderr.toString());
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
