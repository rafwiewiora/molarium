import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveRegisteredDonorHydrogens } from './registered-donor-hydrogen.mjs';
import { captureCrossHydrogenBonds } from './browser-adapter.mjs';

function fixture() {
  const precursor={atoms:[
    {designAtomId:'N',element:'N',atomName:'N7',x:0,y:0,z:0},
    {designAtomId:'H',element:'H',atomName:'H18',x:1,y:0,z:0},
    {designAtomId:'C1',element:'C',x:0,y:1,z:0},
    {designAtomId:'C2',element:'C',x:0,y:-1,z:0},
    {designAtomId:'O',element:'O',x:2.8,y:0,z:0},
  ],bonds:[{a:0,b:1,order:1},{a:0,b:2,order:1},{a:0,b:3,order:1}]};
  const definitions=captureCrossHydrogenBonds(precursor,[0,1,2,3],
    [{donor:0,hydrogen:1,acceptor:4,distance:1.8,cosine:-1}]);
  assert.equal(definitions.length,1);
  const product=structuredClone(precursor);
  product.atoms[1]={...product.atoms[1],designAtomId:'new-H',atomName:'HNEW43',x:-1};
  return {precursor,product,definitions};
}
test('DV-01: unchanged single donor H keeps current identity and coordinates across registered edits',()=>{
  const {precursor,product,definitions}=fixture();
  const audit=preserveRegisteredDonorHydrogens(precursor,product,definitions);
  assert.equal(audit.preserved.length,1);assert.equal(audit.skipped.length,0);
  assert.deepEqual(product.atoms[1],precursor.atoms[1]);
  assert.equal(product.bonds[0].distance,1,'Derived bond distance must follow restored current H coordinates');
  assert.equal(audit.preserved[0].replacedGeneratedAtomId,'new-H');
  assert.equal(audit.preserved[0].coordinateSource,'current-visible-precursor');
});
test('DV-01: changed donor role, protonation, local graph or geometry never inherits an old H',()=>{
  for(const mutate of [
    (p)=>{p.atoms[0].element='C';},
    (p)=>{p.atoms[0].formalCharge=1;},
    (p)=>{p.bonds[1].order=2;},
    (p)=>{p.atoms[2].designAtomId='new-C';},
    (p)=>{p.atoms[2].x=1;},
    (p)=>{p.bonds=p.bonds.filter((bond)=>bond.b!==1);},
  ]) {
    const {precursor,product,definitions}=fixture();mutate(product);
    const audit=preserveRegisteredDonorHydrogens(precursor,product,definitions);
    assert.equal(audit.preserved.length,0);assert.equal(audit.skipped.length,1);
    assert.equal(product.atoms[1].designAtomId,'new-H');
  }
});
test('DV-01: multiple donor H atoms remain an explicit correspondence ambiguity',()=>{
  const {precursor,product,definitions}=fixture();
  for(const molecule of [precursor,product]) {
    molecule.atoms.push({designAtomId:'H2',element:'H',x:0,y:0,z:1});
    molecule.bonds.push({a:0,b:5,order:1});
  }
  const audit=preserveRegisteredDonorHydrogens(precursor,product,definitions);
  assert.equal(audit.preserved.length,0);
  assert.equal(audit.skipped[0].reason,'hydrogen-count-or-correspondence-ambiguous');
});
