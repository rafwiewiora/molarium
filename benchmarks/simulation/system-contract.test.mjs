import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {validateNumericSystem,validatePackedFloat32} from '../../openff/numeric-system.mjs';
import {configureSimulationSystem} from '../../openff/simulation-options.js';
import {buildParameterizedSystem} from '../../stormm/core.mjs';
import {requestedSavedFrameCount,validateTrajectory} from '../../openff/frame-contract.mjs';

export function fixture() {
  return {atoms:[{element:'C',x:0,y:0,z:0},{element:'H',x:1.5,y:0,z:0}],bonds:[],
    parameterization:{forcefield:'Numeric contract fixture',system:{
      particles:[{mass_amu:12},{mass_amu:1}],constraints:[],
      bonds:[{i:0,j:1,r0_nm:0.14,k_kj_nm2:1000}],angles:[],torsions:[],
      nonbonded:[{charge_e:0,sigma_nm:0.3,epsilon_kj:0.1},{charge_e:0,sigma_nm:0.2,epsilon_kj:0.1}],
      exceptions:[]}}};
}
const boundaries = [
  m=>validateNumericSystem(m,m.parameterization.system),
  m=>configureSimulationSystem(m,m.parameterization.system),
  m=>buildParameterizedSystem(m,m.parameterization),
];
test('unknown force classes, periodic content, and extra term fields fail all numeric boundaries',()=>{
  for(const key of ['customExternalForces','cmap','virtualSites','periodicBoxVectors','nonbondedMethod'])
    for(const boundary of boundaries){const m=fixture();m.parameterization.system[key]=[];
      assert.throws(()=>boundary(m),/Unsupported numeric System content/);}
  for(const boundary of boundaries){const m=fixture();m.parameterization.system.bonds[0].ignoredForce=1;
    assert.throws(()=>boundary(m),/unsupported fields/);}
});
test('non-finite, negative-domain, invalid-index, and incomplete systems fail closed',()=>{
  for(const change of [
    m=>{m.parameterization.system.particles[0].mass_amu=Infinity;},
    m=>{m.parameterization.system.particles[0].mass_amu=0;},
    m=>{m.parameterization.system.nonbonded[0].epsilon_kj=-1;},
    m=>{m.parameterization.system.nonbonded[0].sigma_nm=-1;},
    m=>{m.parameterization.system.bonds[0].k_kj_nm2=-1;},
    m=>{m.parameterization.system.bonds[0].i=0.5;},
    m=>{m.parameterization.system.nonbonded[0].index=1;},
    m=>{m.parameterization.system.particles[0].mass_amu='12';},
    m=>{m.parameterization.system.exceptions=[{i:0,j:1,chargeprod_e2:0,sigma_nm:0,epsilon_kj:0},
      {i:1,j:0,chargeprod_e2:0,sigma_nm:0,epsilon_kj:0}];},
    m=>{delete m.parameterization.system.constraints;},
    m=>{m.atoms[0].x=NaN;},
  ])for(const boundary of boundaries){const m=fixture();change(m);assert.throws(()=>boundary(m));}
  assert.throws(()=>validatePackedFloat32('overflow',[1e100]),/finite f32/);
  const m=fixture();m.atoms[0].x=1e100;
  assert.throws(()=>buildParameterizedSystem(m,m.parameterization),/finite f32/);
});
test('all 47 published input Systems remain valid, including signed Rosemary torsions',()=>{
  const packet=JSON.parse(gunzipSync(readFileSync(new URL(
    './results/m1pro-20260905-a07/packet-d8c1bea6a64355251391c3ef777203999bc48f43348c6760333cd0cea8c44ce0.json.gz',import.meta.url))));
  assert.equal(packet.cases.length,47);
  assert.ok(packet.cases.some(c=>c.configuredSystem.torsions.some(t=>t.k_kj<0)));
  for(const c of packet.cases){
    const before=JSON.stringify(c);
    validateNumericSystem(c.molecule,c.configuredSystem);
    configureSimulationSystem(c.molecule,c.molecule.parameterization.system,c.options);
    assert.equal(JSON.stringify(c),before,'validation must not rewrite scientific inputs');
  }
});
test('frame scheduling rejects malformed values and retains exact endpoints',()=>{
  for(const value of [NaN,Infinity,'not-a-number',-2,0,1,2.5,100002])
    assert.throws(()=>requestedSavedFrameCount(value,10),/savedFrameCount/);
  assert.equal(requestedSavedFrameCount(undefined,2),3);
  assert.equal(requestedSavedFrameCount(2,10),2);
  assert.equal(requestedSavedFrameCount(undefined,0),1);
  const good={atomCount:2,replicaCount:2,frameCount:2,frameSteps:[0,10],
    energies:[0,1,2,3],trajectory:Array(24).fill(0),expectedSteps:10};
  validateTrajectory(good);
  for(const override of [{energies:[0]}, {trajectory:Array(12).fill(0)},
    {energies:[0,1,2,NaN]}, {frameSteps:[0,9]}, {frameSteps:[0,0]}, {frameCount:NaN}])
    assert.throws(()=>validateTrajectory({...good,...override}));
});
