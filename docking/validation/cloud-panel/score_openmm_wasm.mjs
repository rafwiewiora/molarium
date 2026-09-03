#!/usr/bin/env node
/** Score an integrity-checked pose packet with a selected Molarium OpenMM WASM build. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const KJ_TO_KCAL = 1 / 4.184;

function allocate(module, array, heapName, shift) {
  if (!array.byteLength) return 0;
  const pointer = module._malloc(array.byteLength);
  module[heapName].set(array, pointer >> shift);
  return pointer;
}

const integerField = (terms, field) => Int32Array.from(terms, (term) => term[field]);
const numberField = (terms, field) => Float64Array.from(terms, (term) => term[field]);

function initialize(module, molecule) {
  const system = molecule.parameterization.system;
  const { constraints, bonds, angles, torsions, exceptions } = system;
  const arrays = [
    numberField(system.particles, 'mass_amu'),
    Float64Array.from(molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z])),
    integerField(constraints, 'i'), integerField(constraints, 'j'),
    numberField(constraints, 'distance_nm'),
    integerField(bonds, 'i'), integerField(bonds, 'j'), numberField(bonds, 'r0_nm'),
    numberField(bonds, 'k_kj_nm2'),
    integerField(angles, 'i'), integerField(angles, 'j'), integerField(angles, 'k'),
    numberField(angles, 'theta0_rad'), numberField(angles, 'k_kj_rad2'),
    integerField(torsions, 'i'), integerField(torsions, 'j'), integerField(torsions, 'k'),
    integerField(torsions, 'l'), integerField(torsions, 'periodicity'),
    numberField(torsions, 'phase_rad'), numberField(torsions, 'k_kj'),
    numberField(system.nonbonded, 'charge_e'), numberField(system.nonbonded, 'sigma_nm'),
    numberField(system.nonbonded, 'epsilon_kj'),
    integerField(exceptions, 'i'), integerField(exceptions, 'j'),
    numberField(exceptions, 'chargeprod_e2'), numberField(exceptions, 'sigma_nm'),
    numberField(exceptions, 'epsilon_kj'), new Float64Array(), new Float64Array(),
  ];
  const pointers = arrays.map((array) => allocate(module, array,
    array instanceof Int32Array ? 'HEAP32' : 'HEAPF64',
    array instanceof Int32Array ? 2 : 3));
  try {
    const ok = module._molarium_initialize_sage(
      molecule.atoms.length, pointers[0], pointers[1],
      constraints.length, pointers[2], pointers[3], pointers[4],
      bonds.length, pointers[5], pointers[6], pointers[7], pointers[8],
      angles.length, pointers[9], pointers[10], pointers[11], pointers[12], pointers[13],
      torsions.length, pointers[14], pointers[15], pointers[16], pointers[17], pointers[18],
      pointers[19], pointers[20], pointers[21], pointers[22], pointers[23],
      exceptions.length, pointers[24], pointers[25], pointers[26], pointers[27], pointers[28],
      0, pointers[29], pointers[30], 0.001, 0,
    );
    if (!ok) throw new Error(module.UTF8ToString(module._molarium_last_error()));
  } finally {
    pointers.forEach((pointer) => { if (pointer) module._free(pointer); });
  }
}

function readForces(module, atomCount) {
  const length = atomCount * 3;
  const pointer = module._malloc(length * Float64Array.BYTES_PER_ELEMENT);
  try {
    if (!module._molarium_get_forces(pointer, length))
      throw new Error(module.UTF8ToString(module._molarium_last_error()));
    return Array.from(module.HEAPF64.slice(pointer >> 3, (pointer >> 3) + length));
  } finally {
    module._free(pointer);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function integrityCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(integrityCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${integrityCanonical(value[key])}`).join(',')}}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Integrity hashes require finite numbers');
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return JSON.stringify(`~f64:${bytes.toString('hex')}`);
  }
  return JSON.stringify(value);
}

const canonicalSha256 = (value) => sha256(Buffer.from(integrityCanonical(value)));

function topologyOf(molecule) {
  return {
    atoms:molecule.atoms.map((atom) => ({ atomId:atom.atomId, element:atom.element,
      formalCharge:Number(atom.formalCharge || 0), aromatic:Boolean(atom.aromatic) })),
    bonds:molecule.bonds.map((bond) => ({ a:Math.min(bond.a, bond.b),
      b:Math.max(bond.a, bond.b), order:Number(bond.order), aromatic:Boolean(bond.aromatic) }))
      .sort((left, right) => left.a - right.a || left.b - right.b
        || left.order - right.order || Number(left.aromatic) - Number(right.aromatic)),
  };
}

function validatePose(pose) {
  const molecule = pose.molecule;
  const atomIds = molecule.atoms.map((atom) => atom.atomId);
  if (atomIds.some((atomId) => typeof atomId !== 'string' || !atomId)
    || new Set(atomIds).size !== atomIds.length)
    throw new Error(`${pose.id}: persistent atom IDs must be present and unique`);
  const integrity = pose.integrity;
  if (!integrity) throw new Error(`${pose.id}: missing packet integrity record`);
  const expected = {
    atomOrderSha256:canonicalSha256(atomIds),
    topologySha256:canonicalSha256(topologyOf(molecule)),
    coordinatesSha256:canonicalSha256(molecule.atoms.map(({ x, y, z }) => [x, y, z])),
    numericSystemSha256:canonicalSha256(molecule.parameterization.system),
    atomCount:molecule.atoms.length,
    bondCount:molecule.bonds.length,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (integrity[name] !== value) throw new Error(`${pose.id}: integrity mismatch for ${name}`);
  }
}

const [packetName, moduleName, wasmName, outputName] = process.argv.slice(2);
if (!packetName || !moduleName || !wasmName || !outputName)
  throw new Error('Usage: score_openmm_wasm.mjs PACKET.json MODULE.js MODULE.wasm OUTPUT.json');

const [packetBytes, moduleBytes, wasmBytes] = await Promise.all([
  readFile(packetName), readFile(moduleName), readFile(wasmName),
]);
const packet = JSON.parse(packetBytes);
if (packet.schema !== 'molarium.analogue-pose-panel/v1' || !Array.isArray(packet.poses))
  throw new Error('Unsupported pose packet schema');
const createOpenMM = (await import(pathToFileURL(moduleName))).default;
const module = await createOpenMM({
  instantiateWasm(imports, receiveInstance) {
    WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) => receiveInstance(instance));
    return {};
  },
});
const poses = [];
for (const pose of packet.poses) {
  validatePose(pose);
  initialize(module, pose.molecule);
  const energyKjMol = module._molarium_get_potential_energy();
  if (!Number.isFinite(energyKjMol))
    throw new Error(`${pose.id}: ${module.UTF8ToString(module._molarium_last_error())}`);
  const forces = readForces(module, pose.molecule.atoms.length);
  poses.push({ id:pose.id, energyKjMol, energyKcalMol:energyKjMol * KJ_TO_KCAL,
    forcesKjMolNm:forces, forceSha256:canonicalSha256(forces) });
  module._molarium_destroy();
}
const result = {
  schema:'molarium.openmm-wasm-single-points/v1',
  source:{ packetSha256:sha256(packetBytes), moduleJsSha256:sha256(moduleBytes),
    moduleWasmSha256:sha256(wasmBytes), openmmVersion:'8.2.0' },
  poses,
};
await writeFile(outputName, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${outputName} (${poses.length} poses)`);
