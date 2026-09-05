import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDesignerLigandPoseReceptorOnlyTransition,
  createDesignerLigandPoseLock, DESIGNER_LIGAND_POSE_COORDINATE_ORIGIN,
  DESIGNER_LIGAND_POSE_LOCK_SCHEMA,
  designerLigandPoseLockDescriptor, inspectDesignerLigandPoseLock } from
  './designer-ligand-pose-lock.mjs';

const molecule = () => ({ atoms:[
  { designAtomId:'receptor:A:10:CA', record:'ATOM', atomName:'CA', residueName:'ALA',
    chain:'A', residueIndex:10, element:'C', x:-2, y:0, z:0 },
  { designAtomId:'ligand:L:1:C1', record:'HETATM', atomName:'C1', residueName:'LIG',
    chain:'L', residueIndex:1, element:'C', aromatic:true, x:0, y:0, z:0 },
  { designAtomId:'ligand:L:1:S1', record:'HETATM', atomName:'S1', residueName:'LIG',
    chain:'L', residueIndex:1, element:'S', aromatic:true, x:1.7, y:0, z:0 },
], bonds:[{ a:1, b:2, order:1.5, aromatic:true }] });

const start = molecule();
const definingMove = { schema:'molarium.designer-geometry-move/v1',
  action:'geometry.setInternalCoordinate', coordinateOrigin:'current-visible-molecule',
  coordinateOperation:'relative-internal-coordinate-edit',
  externalReferenceCoordinatesUsed:false,
  orderedAtomIds:['ligand:L:1:C1','ligand:L:1:S1'],
  kind:'bond', priorValue:1.5, requestedValue:1.7, appliedValue:1.7,
  unit:'Å', moveConnected:true,
  branchDirection:{ cutBondAtomIds:['ligand:L:1:C1','ligand:L:1:S1'],
    movingSideStartsAtAtomId:'ligand:L:1:S1', movingAtomCount:1,
    movingAtomIdsSha256:'b'.repeat(64) },
  preservedPrecursorAtomCount:2, preservedPrecursorAtomIdsSha256:'c'.repeat(64),
  precursorCoordinatePolicy:'all atoms outside the directed moving branch remain bitwise unchanged',
  outputCoordinateSha256:'a'.repeat(64), changedAtomIds:['ligand:L:1:S1'] };
const lock = await createDesignerLigandPoseLock({ molecule:start,
  ligandAtomIndices:[1,2], label:'Fix the chemist-selected thiophene orientation', definingMove });
assert.equal(lock.schema, DESIGNER_LIGAND_POSE_LOCK_SCHEMA);
assert.equal(lock.active, true);
assert.equal(lock.ligandAtomIds.length, 2);
assert.match(lock.lockId, /^[0-9a-f]{64}$/);
assert.match(lock.coordinateSha256, /^[0-9a-f]{64}$/);
assert.match(lock.ligandStateSha256, /^[0-9a-f]{64}$/);
assert.equal(lock.coordinateOrigin, DESIGNER_LIGAND_POSE_COORDINATE_ORIGIN);
assert.equal(lock.externalReferenceCoordinatesUsed, false);
assert.match(lock.coordinateInputPolicy, /no coordinate or pose-id input accepted/);
assert(!Object.hasOwn(designerLigandPoseLockDescriptor(lock), 'ligandAtomIds'),
  'public action descriptor stays compact and does not copy coordinates or atom IDs');
assert(!JSON.stringify(designerLigandPoseLockDescriptor(lock)).includes('coordinatesAngstrom'));
assert.deepEqual((await inspectDesignerLigandPoseLock({ molecule:start,
  ligandAtomIndices:[2,1], lock })).provenance.definingMove, definingMove,
  'persistent identity makes inspection independent of current atom selection order');

const receptorMoved = structuredClone(start);
receptorMoved.atoms[0].x += 4;
assert.equal((await assertDesignerLigandPoseReceptorOnlyTransition({
  beforeMolecule:start, afterMolecule:receptorMoved,
  beforeLigandAtomIndices:[1,2], afterLigandAtomIndices:[1,2], lock })).lockId,
lock.lockId, 'receptor coordinates may respond while the ligand stays fixed');

const ligandMoved = structuredClone(receptorMoved);
ligandMoved.atoms[2].y += 0.01;
await assert.rejects(inspectDesignerLigandPoseLock({ molecule:ligandMoved,
  ligandAtomIndices:[1,2], lock }), /coordinates differ/);
const ligandRetyped = structuredClone(receptorMoved);
ligandRetyped.atoms[2].element = 'O';
await assert.rejects(inspectDesignerLigandPoseLock({ molecule:ligandRetyped,
  ligandAtomIndices:[1,2], lock }), /identity or topology differs/);
await assert.rejects(inspectDesignerLigandPoseLock({ molecule:receptorMoved,
  ligandAtomIndices:[1], lock }), /atom mapping differs/);
const tampered = structuredClone(lock); tampered.provenance.label = 'changed';
await assert.rejects(inspectDesignerLigandPoseLock({ molecule:receptorMoved,
  ligandAtomIndices:[1,2], lock:tampered }), /record hash changed/);

// Lock state is deliberately part of molecule.source, which both build history
// and Designer Moves checkpoints clone. This regression keeps the visible API
// path and fail-closed ligand-motion guards from becoming private story code.
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(appSource,
  /runChemistUiAction\('pose\.setDesignerLigandPoseFixed',[\s\S]{0,250}\{\s*fixed/);
assert.match(appSource,
  /source\.designerFixedLigandPose|source\?\.designerFixedLigandPose/);
assert.match(appSource,
  /cloneDesignerMoveCheckpointMolecule[\s\S]{0,350}\.\.\.\(molecule\.source \|\| \{\}\)/);
for (const action of ['pose.refine','pose.apply','optimization.run','geometry.translateAtoms',
  'geometry.alignBranchToContact',
  'designRoute.applyStep','calculation.selectFrame'])
  assert(appSource.includes(`rejectLigandMotionWhileDesignerFixed('${action}')`),
    `${action} must fail closed while designer ligand geometry is fixed`);
assert.match(appSource,
  /coordinateOperation:'relative-internal-coordinate-edit'[\s\S]{0,900}branchDirection:[\s\S]{0,600}preservedPrecursorAtomIdsSha256/,
  'the public internal-coordinate action records direction and preserved precursor evidence');
assert.match(appSource,
  /coordinateOperation:'registered-graph-edit-with-mapped-coordinate-preservation'[\s\S]{0,300}externalReferenceCoordinatesUsed:false/,
  'registered graph edits explicitly distinguish precursor preservation from pose injection');

console.log('Designer-fixed ligand pose lock tests: PASS');
