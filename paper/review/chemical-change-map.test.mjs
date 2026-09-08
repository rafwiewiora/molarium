import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildChemicalChangeMap, normalizeRdkitJson, compareGraphs, outputPath} from '../scripts/sos1-chemical-change-map.mjs';

test('equivalent Kekule bond assignments are not chemical edits',()=>{
  const ring = orders => ({defaults:{atom:{z:6,impHs:1,chg:0,isotope:0,nRad:0},bond:{bo:1}},
    molecules:[{atoms:Array.from({length:6},()=>({})),
      bonds:orders.map((bo,i)=>({atoms:[i,(i+1)%6],bo})),
      extensions:[{name:'rdkitRepresentation',aromaticAtoms:[0,1,2,3,4,5],aromaticBonds:[0,1,2,3,4,5]}]}]});
  const a=normalizeRdkitJson(ring([1,2,1,2,1,2]));
  const b=normalizeRdkitJson(ring([2,1,2,1,2,1]));
  assert.deepEqual(a,b);
  assert.deepEqual(compareGraphs(a,b,a.atoms.map((_,i)=>[i,i])).changed,[]);
});

test('real hydrogenation remains a chemical change after aromatic normalization',()=>{
  const a={atoms:[{element:6,hydrogens:1,aromatic:true},{element:6,hydrogens:0,aromatic:true}],
    bonds:[{atoms:[0,1],order:'aromatic'}]};
  const b={atoms:[{element:6,hydrogens:2,aromatic:false},{element:6,hydrogens:0,aromatic:true}],
    bonds:[{atoms:[0,1],order:1}]};
  assert.deepEqual(compareGraphs(a,b,[[0,0],[1,1]]).changed,[0,1]);
});

test('public map reproduces immutable checkpoints and excludes conserved methoxy groups',async()=>{
  const report=await buildChemicalChangeMap();
  assert.deepEqual(report,JSON.parse(readFileSync(outputPath,'utf8')));
  assert.deepEqual(report.states.map(s=>s.highlightedAtomIds.length),[0,9,13,14,14,0,11]);
  const methoxyByStage={
    'scaffold-rewrite':['O13','C17','O14','C18'],
    'fragment-merge':['O13','C17','O14','C18'],
    'aww-graph':['OX1','CX6','OX2','CX9'],
    'aww-designer-intent':['OX1','CX6','OX2','CX9'],
    'finish-bay-293':['OX1','CX15','OX2','CX17'],
  };
  for (const state of report.states) for (const name of methoxyByStage[state.stage]||[])
    assert.ok(!state.highlightedAtomNames.includes(name),state.stage+' conserved methoxy '+name);
  const bay=report.states.find(s=>s.stage==='finish-bay-293');
  for(const name of ['CX6','CX7','CX8','CX9','CX10','CX11'])
    assert.ok(!bay.highlightedAtomNames.includes(name),'retained benzyl group '+name);
  for(const name of ['NX1','CX5','CX3','CX4','CX12','CX13','CX18'])
    assert.ok(bay.highlightedAtomNames.includes(name),'real change endpoint '+name);
});
