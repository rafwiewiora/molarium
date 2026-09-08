import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url);
const require=createRequire(import.meta.url);
const init=require(new URL('rdkit/dist/RDKit_minimal.js',root).pathname);
const module=await init({locateFile:f=>new URL('rdkit/dist/'+f,root).pathname});
const messages=[];
const context=vm.createContext({self:{importScripts:()=>{},addEventListener:()=>{},initRDKitModule:()=>Promise.resolve(module),
  location:{href:new URL('rdkit-worker.js',root).href},postMessage:m=>messages.push(m)},
  URL,performance,Float64Array,Int32Array,Uint8Array,console});
vm.runInContext(readFileSync(new URL('rdkit-worker.js',root),'utf8'),context);
const release=JSON.parse(readFileSync(new URL('design-history/publications/sos1/designer-intent-2026-09-04/release.json',root)));
const results=[];
let template=null;
let templateCoordinates=null;
const referenceSmarts='[#6]1~[#6]~[#7]~[#6]~[#7]~[#6]~1~[#7]~[#6]';
const scaffoldNames=['C1','C2','N6','C11','N8','C3','N7','C12'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=new URL('paper/review/captures/2026-09-07-aligned-chemistry-a22/',root);
mkdirSync(out,{recursive:true});
for(const entry of release.checkpoints){
  const bytes=readFileSync(new URL(entry.path,root));
  assert.equal(sha(bytes),entry.sha256,entry.id+' immutable checkpoint hash');
  const snapshot=JSON.parse(entry.encoding?gunzipSync(bytes):bytes).objects.snapshots[entry.snapshotId];
  const coords=new Map(snapshot.coordinates.atomIds.map((id,i)=>[id,snapshot.coordinates.positions[i]]));
  const ligand=snapshot.graph.atoms.filter(a=>a.record==='HETATM'&&['AXE','AWT','AWZ','AWW','AXH'].includes(a.residueName));
  const sorted=[...ligand.filter(a=>a.element!=='H'),...ligand.filter(a=>a.element==='H')];
  const map=new Map(sorted.map((a,i)=>[a.atomId,i]));
  const molecule={atoms:sorted.map(a=>({element:a.element,charge:a.formalCharge||0,
    x:coords.get(a.atomId)[0],y:coords.get(a.atomId)[1],z:coords.get(a.atomId)[2]})),
    bonds:snapshot.graph.bonds.filter(b=>b.atomIds.every(id=>map.has(id)))
      .map(b=>({a:map.get(b.atomIds[0]),b:map.get(b.atomIds[1]),order:b.order}))};
  writeFileSync(new URL(entry.id+'.input.mol',out),context.moleculeToMolBlock(molecule));
  console.log('Checking',entry.id,molecule.atoms.length,molecule.bonds.length);
  await context.runCalculation({id:results.length+1,job:'depict',molecule,
    options:{allowUnsanitizedDepictionFallback:false,...(template?{depictionAlignment:{referenceMolBlock:template,referenceSmarts}}:{})}});
  const result=messages.filter(m=>m.type==='result').at(-1);
  assert.equal(result.id,results.length+1,entry.id+' returned current worker result');
  assert.equal(result.sanitization,'strict RDKit sanitization; hydrogens removed after sanitization');
  const full=module.get_mol(context.moleculeToMolBlock(molecule),JSON.stringify({sanitize:true,removeHs:false}));
  const mol=full && module.get_mol(full.remove_hs(),JSON.stringify({sanitize:true,removeHs:false}));
  full?.delete();
  assert.ok(mol,entry.id+' strict parse');
  const smiles=mol.get_smiles();
  assert.equal(result.canonicalSmiles,smiles);
  mol.delete();
  template ||= result.molBlock;
  const lines=result.molBlock.split('\n');
  const scaffoldCoordinates=scaffoldNames.map(name=>{
    const index=sorted.findIndex(atom=>atom.atomName===name);
    assert.ok(index>=0,entry.id+' contains scaffold '+name);
    return [Number(lines[4+index].slice(0,10)),Number(lines[4+index].slice(10,20))];
  });
  templateCoordinates ||= scaffoldCoordinates;
  const maxScaffoldCoordinateDeviation=Math.max(...scaffoldCoordinates.map((xy,i)=>
    Math.hypot(xy[0]-templateCoordinates[i][0],xy[1]-templateCoordinates[i][1])));
  assert.ok(maxScaffoldCoordinateDeviation<=0.001,entry.id+' common 2D scaffold coordinates');
  if(result.alignment) assert.deepEqual(Array.from(result.alignment.atoms,i=>sorted[i].atomName),scaffoldNames);
  results.push({stage:entry.id,smiles,sanitization:result.sanitization,alignment:result.alignment,
    checkpointSha256:sha(bytes),maxScaffoldCoordinateDeviation,
    alignedAtomNames:result.alignment?.atoms.map(i=>sorted[i].atomName),
    heavyAtoms:ligand.filter(a=>a.element!=='H').length});
  writeFileSync(new URL(entry.id+'.worker.svg',out),result.svg);
  if(result.molBlock) writeFileSync(new URL(entry.id+'.worker.mol',out),result.molBlock);
}
writeFileSync(new URL('worker-audit.json',out),JSON.stringify({rdkitVersion:module.version(),referenceSmarts,results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
