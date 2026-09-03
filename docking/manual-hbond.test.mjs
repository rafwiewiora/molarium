import assert from 'node:assert/strict';
import { createManualHydrogenBondDefinition, manualHydrogenBondGeometry,
  manualHydrogenBondOptions, manualHydrogenBondParticipantKey } from './manual-hbond.mjs';

const molecule = {
  atoms:[
    { element:'O', x:2.8, y:0, z:0, designAtomId:'lig-O' },
    { element:'C', x:3.8, y:0, z:0, designAtomId:'lig-C' },
    { element:'N', x:0, y:0, z:0, designAtomId:'rec-N', atomName:'NZ', residueName:'LYS', chain:'A', residueIndex:11 },
    { element:'H', x:1, y:0, z:0, designAtomId:'rec-H1' },
    { element:'H', x:0, y:1, z:0, designAtomId:'rec-H2' },
    { element:'N', x:6, y:0, z:0, designAtomId:'lig-N' },
    { element:'H', x:5, y:0, z:0, designAtomId:'lig-H' },
    { element:'O', x:3.2, y:0, z:0, designAtomId:'rec-O', atomName:'OD1', residueName:'ASP', chain:'A', residueIndex:12 },
    { element:'C', x:2.2, y:0, z:0, designAtomId:'rec-C' },
    { element:'C', x:8, y:0, z:0, designAtomId:'lig-inert' },
    { element:'C', x:10, y:0, z:0, designAtomId:'rec-inert' },
  ],
  bonds:[{ a:0,b:1,order:2 }, { a:2,b:3,order:1 }, { a:2,b:4,order:1 },
    { a:5,b:6,order:1 }, { a:7,b:8,order:2 }],
};
const ligand = [0,1,5,6,9];

const acceptorOptions = manualHydrogenBondOptions({ molecule, ligandAtomIndices:ligand,
  ligandAtomIndex:0, receptorAtomIndex:2 });
assert.equal(acceptorOptions.length, 1);
assert.equal(acceptorOptions[0].ligandRole, 'acceptor');
assert.equal(acceptorOptions[0].receptorHydrogenIndex, 3,
  'the receptor hydrogen closest to the selected ligand feature is chosen deterministically');
assert.deepEqual(acceptorOptions[0].consideredHydrogenIndices, [3,4]);
assert(Math.abs(acceptorOptions[0].targetLigandFeatureReferencePoint.x - 2.9) < 1e-12);

const acceptorDefinition = createManualHydrogenBondDefinition({ molecule,
  ligandAtomIndices:ligand, ligandAtomIndex:0, receptorAtomIndex:2,
  id:'manual-hbond-1', createdAt:'2026-08-30T12:00:00.000Z' });
assert.equal(acceptorDefinition.receptorRole, 'donor');
assert.equal(acceptorDefinition.acceptor.designAtomId, 'lig-O');
assert.equal(acceptorDefinition.hydrogen.designAtomId, 'rec-H1');
assert.equal(acceptorDefinition.acceptor.referencePoint.x, 2.9);
assert.equal(acceptorDefinition.origin.kind, 'user-added-hydrogen-bond-hypothesis');
assert.equal(acceptorDefinition.origin.consideredHydrogenAtomIds.length, 2);
assert.equal(manualHydrogenBondGeometry(molecule, acceptorDefinition).satisfied, true);

const donorDefinition = createManualHydrogenBondDefinition({ molecule,
  ligandAtomIndices:ligand, ligandAtomIndex:5, receptorAtomIndex:7,
  ligandRole:'donor', id:'manual-hbond-2', createdAt:'2026-08-30T12:00:01.000Z' });
assert.equal(donorDefinition.receptorRole, 'acceptor');
assert.equal(donorDefinition.donor.designAtomId, 'lig-N');
assert.equal(donorDefinition.hydrogen.designAtomId, 'lig-H');
assert.equal(donorDefinition.hydrogen.referencePoint, undefined,
  'a new ligand-donor hypothesis never invents a captured donor-H coordinate');
assert.equal(donorDefinition.acceptor.designAtomId, 'rec-O');
assert.equal(manualHydrogenBondParticipantKey(donorDefinition),
  'acceptor|lig-N|lig-H|rec-O');

assert.deepEqual(manualHydrogenBondOptions({ molecule, ligandAtomIndices:ligand,
  ligandAtomIndex:9, receptorAtomIndex:2 }), []);
assert.deepEqual(manualHydrogenBondOptions({ molecule, ligandAtomIndices:ligand,
  ligandAtomIndex:0, receptorAtomIndex:10 }), []);
assert.throws(() => manualHydrogenBondOptions({ molecule, ligandAtomIndices:ligand,
  ligandAtomIndex:0, receptorAtomIndex:1 }), /second atom must belong to the receptor/);

// A hydroxyl oxygen on each side is both a donor and an acceptor. The module
// must not silently choose the direction of a new scientific hypothesis.
const ambiguous = {
  atoms:[{ element:'O', x:0, y:0, z:0, designAtomId:'lig-OH' },
    { element:'H', x:1, y:0, z:0, designAtomId:'lig-OH-H' },
    { element:'O', x:3, y:0, z:0, designAtomId:'rec-OH' },
    { element:'H', x:2, y:0, z:0, designAtomId:'rec-OH-H' }],
  bonds:[{ a:0,b:1,order:1 }, { a:2,b:3,order:1 }],
};
assert.equal(manualHydrogenBondOptions({ molecule:ambiguous, ligandAtomIndices:[0,1],
  ligandAtomIndex:0, receptorAtomIndex:2 }).length, 2);
assert.throws(() => createManualHydrogenBondDefinition({ molecule:ambiguous,
  ligandAtomIndices:[0,1], ligandAtomIndex:0, receptorAtomIndex:2,
  id:'ambiguous' }), /choose the ligand role/);
assert.equal(createManualHydrogenBondDefinition({ molecule:ambiguous,
  ligandAtomIndices:[0,1], ligandAtomIndex:0, receptorAtomIndex:2,
  ligandRole:'acceptor', id:'ambiguous-acceptor' }).receptorRole, 'donor');

console.log('Molarium manual H-bond hypotheses: PASS');
