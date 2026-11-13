import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeFeatures} from './capture-browser-features.mjs';

test('portable binary capture preserves subarray bytes, uint64 precision and ownership',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cofold-features-'));
  try{
    const backing=new Float32Array([99,1.5,-0,NaN,88]),view=backing.subarray(1,4);
    const large=new BigUint64Array([2n**63n+19n]);
    const out=join(directory,'saved'),manifest=await freezeFeatures({view,nested:[large]},out);
    view.fill(0);large.fill(0n); // A later mutation cannot change saved capture bytes.
    const raw=await readFile(join(out,'features.bin')),[a,b]=Object.values(manifest.arrays);
    const data=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    assert.equal(data.getFloat32(a.byteOffset,true),1.5);
    assert.ok(Object.is(data.getFloat32(a.byteOffset+4,true),-0));
    assert.ok(Number.isNaN(data.getFloat32(a.byteOffset+8,true)));
    assert.equal(data.getBigUint64(b.byteOffset,true),2n**63n+19n);
    assert.equal(a.nonFiniteValues,1);assert.equal(b.byteOffset%8,0);
    await assert.rejects(()=>freezeFeatures({changed:new Float32Array(2)},out),/EEXIST/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
