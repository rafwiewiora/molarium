import { canonicalValue, sha256Object } from '../design-history/integrity.mjs';

export const DESIGNER_LIGAND_POSE_LOCK_SCHEMA =
  'molarium.designer-fixed-ligand-pose/v1';

function finiteCoordinate(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return Object.is(number, -0) ? 0 : number;
}

function normalizeLigandAtomIndices(molecule, ligandAtomIndices) {
  if (!molecule || !Array.isArray(molecule.atoms) || !Array.isArray(molecule.bonds))
    throw new Error('Designer-fixed ligand pose requires a complete molecule');
  const indices = Array.from(ligandAtomIndices || [], Number);
  if (!indices.length || indices.some((index) => !Number.isInteger(index)
    || index < 0 || index >= molecule.atoms.length)
    || new Set(indices).size !== indices.length)
    throw new Error('Designer-fixed ligand pose requires distinct in-range ligand atom indices');
  const atomIds = indices.map((index) => molecule.atoms[index]?.designAtomId);
  if (atomIds.some((atomId) => typeof atomId !== 'string' || !atomId)
    || new Set(atomIds).size !== atomIds.length)
    throw new Error('Designer-fixed ligand pose requires unique persistent ligand atom IDs');
  return indices;
}

function canonicalLigandState(molecule, ligandAtomIndices, atomOrder = null) {
  const indices = normalizeLigandAtomIndices(molecule, ligandAtomIndices);
  const indexByAtomId = new Map(indices.map((index) =>
    [molecule.atoms[index].designAtomId, index]));
  const atomIds = atomOrder == null
    ? [...indexByAtomId.keys()].sort()
    : Array.from(atomOrder, (atomId) => String(atomId || ''));
  if (!atomIds.length || atomIds.some((atomId) => !indexByAtomId.has(atomId))
    || atomIds.length !== indexByAtomId.size || new Set(atomIds).size !== atomIds.length)
    throw new Error('Current ligand atom mapping differs from the designer-fixed pose');
  const atoms = atomIds.map((atomId) => {
    const atom = molecule.atoms[indexByAtomId.get(atomId)];
    return {
      atomId,
      element:String(atom.element || ''),
      formalCharge:finiteCoordinate(atom.formalCharge ?? atom.charge ?? 0,
        `formal charge for ${atomId}`),
      aromatic:Boolean(atom.aromatic),
      coordinatesAngstrom:[
        finiteCoordinate(atom.x, `x coordinate for ${atomId}`),
        finiteCoordinate(atom.y, `y coordinate for ${atomId}`),
        finiteCoordinate(atom.z, `z coordinate for ${atomId}`),
      ],
    };
  });
  const selected = new Set(indices);
  const bonds = molecule.bonds.flatMap((bond, bondIndex) => {
    const first = Number(bond.a), second = Number(bond.b);
    if (!selected.has(first) || !selected.has(second)) return [];
    const firstId = molecule.atoms[first]?.designAtomId;
    const secondId = molecule.atoms[second]?.designAtomId;
    if (!firstId || !secondId || firstId === secondId)
      throw new Error(`Designer-fixed ligand pose found an invalid ligand bond at index ${bondIndex}`);
    const [atomIdA, atomIdB] = firstId < secondId
      ? [firstId, secondId] : [secondId, firstId];
    return [{ atomIdA, atomIdB,
      order:finiteCoordinate(bond.order ?? 1, `bond order at index ${bondIndex}`),
      aromatic:Boolean(bond.aromatic) }];
  }).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
  return canonicalValue({ atomIds, atoms, bonds });
}

async function hashesForLigandState(state) {
  return {
    coordinateSha256:await sha256Object(state.atoms.map((atom) =>
      atom.coordinatesAngstrom)),
    ligandStateSha256:await sha256Object(state),
  };
}

export function designerLigandPoseLockDescriptor(lock) {
  if (lock?.schema !== DESIGNER_LIGAND_POSE_LOCK_SCHEMA || lock.active !== true)
    throw new Error(`Expected an active ${DESIGNER_LIGAND_POSE_LOCK_SCHEMA} record`);
  return canonicalValue({
    schema:lock.schema,
    active:true,
    lockId:lock.lockId,
    atomCount:lock.ligandAtomIds.length,
    coordinateSha256:lock.coordinateSha256,
    ligandStateSha256:lock.ligandStateSha256,
    provenance:lock.provenance,
  });
}

export async function createDesignerLigandPoseLock({ molecule, ligandAtomIndices,
  label = 'Designer-fixed ligand pose', definingMove = null } = {}) {
  const state = canonicalLigandState(molecule, ligandAtomIndices);
  const hashes = await hashesForLigandState(state);
  const provenance = canonicalValue({
    source:'visible-design-workspace',
    action:'pose.setDesignerLigandPoseFixed',
    label:String(label || '').trim() || 'Designer-fixed ligand pose',
    definingMove:definingMove == null ? null : definingMove,
  });
  const body = canonicalValue({
    schema:DESIGNER_LIGAND_POSE_LOCK_SCHEMA,
    active:true,
    ligandAtomIds:state.atomIds,
    ...hashes,
    provenance,
  });
  return canonicalValue({ ...body, lockId:await sha256Object(body) });
}

export async function inspectDesignerLigandPoseLock({ molecule, ligandAtomIndices,
  lock } = {}) {
  if (lock?.schema !== DESIGNER_LIGAND_POSE_LOCK_SCHEMA || lock.active !== true)
    throw new Error(`Expected an active ${DESIGNER_LIGAND_POSE_LOCK_SCHEMA} record`);
  const { lockId, ...body } = canonicalValue(lock);
  if (await sha256Object(body) !== lockId)
    throw new Error('Designer-fixed ligand pose record hash changed');
  const state = canonicalLigandState(molecule, ligandAtomIndices, lock.ligandAtomIds);
  const hashes = await hashesForLigandState(state);
  if (hashes.coordinateSha256 !== lock.coordinateSha256)
    throw new Error('Current ligand coordinates differ from the designer-fixed pose');
  if (hashes.ligandStateSha256 !== lock.ligandStateSha256)
    throw new Error('Current ligand identity or topology differs from the designer-fixed pose');
  return designerLigandPoseLockDescriptor(lock);
}

export async function assertDesignerLigandPoseReceptorOnlyTransition({ beforeMolecule,
  afterMolecule, beforeLigandAtomIndices, afterLigandAtomIndices, lock } = {}) {
  const before = await inspectDesignerLigandPoseLock({ molecule:beforeMolecule,
    ligandAtomIndices:beforeLigandAtomIndices, lock });
  const after = await inspectDesignerLigandPoseLock({ molecule:afterMolecule,
    ligandAtomIndices:afterLigandAtomIndices, lock });
  if (before.lockId !== after.lockId)
    throw new Error('Designer-fixed ligand pose changed during receptor response');
  return after;
}
