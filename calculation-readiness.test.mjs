import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasPreparationHistory, invalidateNumericalParameters,
  dynamicsReadinessKey, usableMinimization } from './calculation-readiness.mjs';
const molecule = () => ({atoms:[{element:'C',x:0,y:0,z:0},{element:'H',x:1,y:0,z:0}],
  bonds:[{a:0,b:1,order:1}],parameterization:{forcefield:'test',sourceSha256:'fixture',
    system:{particles:[{},{}]}}});
const options = {implicitSolvent:'obc2',constraintMode:'hbonds',nonbondedCutoffNm:0};
test('edits preserve successful preparation, not stale numerical parameters', () => {
  const m=molecule();
  m.dynamicsReadiness={key:'old'};
  invalidateNumericalParameters(m);
  assert.equal(hasPreparationHistory(m),true);
  assert.equal(m.parameterization,undefined);
  assert.equal(m.dynamicsReadiness,undefined);
  const evidence=structuredClone(m.preparation.lastSuccessfulParameterization);
  invalidateNumericalParameters(m);
  assert.deepEqual(m.preparation.lastSuccessfulParameterization,evidence);
  for(const status of ['loaded','preview','modified-after-preparation']) {
    const raw={preparation:{status,parameterized:false}};
    invalidateNumericalParameters(raw);
    assert.equal(hasPreparationHistory(raw),false);
  }
  assert.equal(hasPreparationHistory({preparation:{audit:{parameterization:{forcefield:'Sage'}}}}),true);
});
test('readiness is exact molecular state + numerical System + energy protocol',async()=>{
  const m=molecule(),key=await dynamicsReadinessKey(m,'webgpu',options);
  assert.equal(await dynamicsReadinessKey(m,'webgpu',{...options,steps:999,temperature:310}),key);
  for(const mutate of [m=>m.atoms[0].x+=0.01,m=>m.atoms[0].element='N',
    m=>m.bonds[0].order=2,m=>m.parameterization.system.particles[0].charge=1]) {
    const changed=structuredClone(m); mutate(changed);
    assert.notEqual(await dynamicsReadinessKey(changed,'webgpu',options),key);
  }
  assert.notEqual(await dynamicsReadinessKey(m,'openmm',options),key);
  for(const settings of [{implicitSolvent:'vacuum'},{constraintMode:'none'},{nonbondedCutoffNm:1}])
    assert.notEqual(await dynamicsReadinessKey(m,'webgpu',{...options,...settings}),key);
});
test('failed, zero-step or partial minimization cannot qualify the full system',()=>{
  const good={initialEnergy:10,finalEnergy:1,positions:new Float64Array(6)};
  assert.equal(usableMinimization(good,2),true);
  for(const result of [{...good,finalEnergy:11},{...good,finalEnergy:NaN},
    {...good,positions:[NaN,0,0,0,0,0]},{...good,converged:false}])
    assert.equal(usableMinimization(result,2),false);
  for(const opt of [{maxIterations:0},{movableAtomIndices:[0]},{fixedAtomIndices:[1]}])
    assert.equal(usableMinimization(good,2,opt),false);
});
