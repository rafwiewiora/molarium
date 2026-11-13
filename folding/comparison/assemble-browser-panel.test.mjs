import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assembleBrowserPanel} from './assemble-browser-panel.mjs';
test('browser recovery preserves exact saved coordinates, rejects repeats, missing seeds and changed protocols',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cofold-cohort-'));
 try{
  const base=new URL('../../reviews/cofold-recent-pdb-2026-11-13/',import.meta.url),panel=JSON.parse(await readFile(new URL('panel.json',base)));
  panel.cases=panel.cases.slice(0,1);const original=JSON.parse(await readFile(new URL('browser-boltz2-baseline/library-1.json',base)));
  const left={...original,poses:original.poses.slice(0,2)},right={...original,poses:original.poses.slice(2)};
  await writeFile(join(root,'panel.json'),JSON.stringify(panel));await writeFile(join(root,'left.json'),JSON.stringify(left));await writeFile(join(root,'right.json'),JSON.stringify(right));
  const plan={model:'localfold-boltz2',steps:25,recycles:2,sources:[{label:'saved-two',file:'left.json'},{label:'remaining-one',file:'right.json'}]};
  const save=async p=>writeFile(join(root,'plan.json'),JSON.stringify(p));await save(plan);
  const receipt=await assembleBrowserPanel(join(root,'panel.json'),join(root,'plan.json'),join(root,'cohort'));
  assert.equal(receipt.outputs[0].complete,3);
  const actual=JSON.parse(await readFile(join(root,'cohort/library-1.json')));
  assert.deepEqual(actual.poses.map(p=>p.seed),[0,1,2]);
  for(const p of actual.poses)assert.equal(p.result.pdb,original.poses.find(q=>q.seed===p.seed).result.pdb);
  assert.equal(actual.poses[2].sourcePose.originalRunId,original.run.id);
  await save({...plan,sources:[plan.sources[0]]});await assert.rejects(assembleBrowserPanel(join(root,'panel.json'),join(root,'plan.json'),join(root,'missing')),/Missing/);
  await save({...plan,sources:[...plan.sources,{label:'duplicate',file:'left.json'}]});await assert.rejects(assembleBrowserPanel(join(root,'panel.json'),join(root,'plan.json'),join(root,'duplicate')),/Duplicate/);
  await save({...plan,steps:200});await assert.rejects(assembleBrowserPanel(join(root,'panel.json'),join(root,'plan.json'),join(root,'wrong')),/protocol/);
 }finally{await rm(root,{recursive:true,force:true});}
});
