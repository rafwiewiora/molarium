#!/usr/bin/env bun

// Validate the browser parameterizer and OpenMM WASM against golden JSON made
// by the OpenFF Toolkit -> Interchange -> native OpenMM reference pipeline.

import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parameterizeSage } from './sage-parameterizer.js';
import createMolariumOpenMM from '../openmm/molarium-openmm.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const require = createRequire(import.meta.url);
const initRDKitModule = require(join(projectRoot, 'rdkit/dist/RDKit_minimal.js'));
const source = Bun.argv[2];

if (!source) {
  console.error('usage: bun openff/validate-golden.js /path/to/goldens-or.zip');
  process.exit(2);
}

const ELEMENTS = Object.freeze({
  1: 'H', 5: 'B', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 14: 'Si', 15: 'P',
  16: 'S', 17: 'Cl', 35: 'Br', 53: 'I',
});

function unzip(args) {
  const result = Bun.spawnSync(['unzip', ...args]);
  if (result.exitCode) throw new Error(result.stderr.toString().trim() || 'unzip failed');
  return result.stdout.toString();
}

async function readGoldens(path) {
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    const files = (await readdir(absolute)).filter((name) => name.endsWith('.json') && name !== 'index.json').sort();
    return Promise.all(files.map(async (name) => JSON.parse(await Bun.file(join(absolute, name)).text())));
  }
  const names = unzip(['-Z1', absolute]).split(/\r?\n/)
    .filter((name) => name.endsWith('.json') && basename(name) !== 'index.json').sort();
  return names.map((name) => JSON.parse(unzip(['-p', absolute, name])));
}

function moleculeFromGolden(golden) {
  return {
    name: golden.name,
    smiles: golden.smiles_input,
    charge: golden.graph.atoms.reduce((sum, atom) => sum + atom.formal_charge, 0),
    atoms: golden.graph.atoms.map((atom, index) => ({
      element: ELEMENTS[atom.atomic_number], charge: atom.formal_charge,
      aromatic: atom.is_aromatic,
      x: golden.conformer_nm[index][0] * 10,
      y: golden.conformer_nm[index][1] * 10,
      z: golden.conformer_nm[index][2] * 10,
    })),
    bonds: golden.graph.bonds.map((bond) => ({
      a: bond.i, b: bond.j, order: bond.is_aromatic ? 1.5 : bond.order,
    })),
  };
}

function close(first, second, absolute = 1e-8, relative = 1e-7) {
  return Math.abs(first - second) <= absolute + relative * Math.max(1, Math.abs(first), Math.abs(second));
}

function reverseKey(values) {
  const reverse = values.slice().reverse();
  const forwardText = values.join(':');
  const reverseText = reverse.join(':');
  return forwardText <= reverseText ? forwardText : reverseText;
}

function pairKey(term) { return [term.i, term.j].sort((a, b) => a - b).join(':'); }
function angleKey(term) { return reverseKey([term.i, term.j, term.k]); }
function torsionKey(term) {
  return `${reverseKey([term.i, term.j, term.k, term.l])}:${term.periodicity}:${term.phase_rad.toPrecision(15)}:${term.k_kj.toPrecision(15)}`;
}

function keyed(list, key) { return new Map(list.map((term) => [key(term), term])); }

function compareMapped(errors, label, goldenTerms, candidateTerms, key, fields) {
  const golden = keyed(goldenTerms || [], key);
  const candidate = keyed(candidateTerms || [], key);
  for (const identity of golden.keys()) if (!candidate.has(identity)) errors.push(`${label} missing ${identity}`);
  for (const identity of candidate.keys()) if (!golden.has(identity)) errors.push(`${label} extra ${identity}`);
  for (const [identity, expected] of golden) {
    const actual = candidate.get(identity);
    if (!actual) continue;
    for (const field of fields) {
      if (!close(expected[field], actual[field]))
        errors.push(`${label} ${identity} ${field}: ${actual[field]} != ${expected[field]}`);
    }
  }
}

function labelIdentity(handler, atoms) {
  if (handler === 'vdW') return String(atoms[0]);
  if (handler === 'Bonds' || handler === 'Constraints') return atoms.slice().sort((a, b) => a - b).join(':');
  if (handler === 'Angles' || handler === 'ProperTorsions') return reverseKey(atoms);
  if (handler === 'ImproperTorsions') return `${atoms[1]}:${[atoms[0], atoms[2], atoms[3]].sort((a, b) => a - b).join(':')}`;
  return atoms.join(':');
}

function compareGolden(golden, candidate) {
  const errors = [];
  const expected = golden.system;
  const actual = candidate.system;
  if (actual.particles.length !== expected.particles.length) errors.push('particle count differs');
  expected.particles.forEach((particle, index) => {
    if (!close(particle.mass_amu, actual.particles[index]?.mass_amu)) errors.push(`particle ${index} mass differs`);
  });
  compareMapped(errors, 'nonbonded', expected.nonbonded, actual.nonbonded, (term) => String(term.index),
    ['charge_e', 'sigma_nm', 'epsilon_kj']);
  compareMapped(errors, 'exception', expected.exceptions, actual.exceptions, pairKey,
    ['chargeprod_e2', 'sigma_nm', 'epsilon_kj']);
  compareMapped(errors, 'angle', expected.angles, actual.angles, angleKey,
    ['theta0_rad', 'k_kj_rad2']);

  const expectedTorsions = (expected.torsions || []).map(torsionKey).sort();
  const actualTorsions = (actual.torsions || []).map(torsionKey).sort();
  if (JSON.stringify(expectedTorsions) !== JSON.stringify(actualTorsions)) errors.push('torsion terms differ');

  const expectedBonds = keyed(expected.bonds || [], pairKey);
  const actualBonds = keyed(actual.bonds || [], pairKey);
  const convertedConstraints = new Set((golden.labels?.Constraints || []).map((term) =>
    term.atoms.slice().sort((a, b) => a - b).join(':')));
  for (const [identity, bond] of expectedBonds) {
    const candidateBond = actualBonds.get(identity);
    if (!candidateBond) errors.push(`bond missing ${identity}`);
    else for (const field of ['r0_nm', 'k_kj_nm2']) {
      if (!close(bond[field], candidateBond[field])) errors.push(`bond ${identity} ${field} differs`);
    }
  }
  for (const identity of actualBonds.keys()) {
    if (!expectedBonds.has(identity) && !convertedConstraints.has(identity)) errors.push(`unexpected bond ${identity}`);
  }
  for (const identity of convertedConstraints) {
    if (!actualBonds.has(identity)) errors.push(`constraint ${identity} was not converted to a harmonic bond`);
  }

  if (golden.labels) for (const [handler, terms] of Object.entries(golden.labels)) {
    const candidateLabels = new Map((candidate.labels[handler] || []).map((term) =>
      [labelIdentity(handler, term.atoms), term.id]));
    for (const term of terms) {
      const identity = labelIdentity(handler, term.atoms);
      if (candidateLabels.get(identity) !== term.id)
        errors.push(`${handler} label ${identity}: ${candidateLabels.get(identity)} != ${term.id}`);
    }
  }
  return { errors, expectedBonds, actualBonds };
}

function integerField(terms, field) { return Int32Array.from(terms, (term) => term[field]); }
function numberField(terms, field) { return Float64Array.from(terms, (term) => term[field]); }

function allocate(module, array) {
  if (!array.byteLength) return 0;
  const pointer = module._malloc(array.byteLength);
  module[array instanceof Int32Array ? 'HEAP32' : 'HEAPF64'].set(array, pointer >> (array instanceof Int32Array ? 2 : 3));
  return pointer;
}

function initializeOpenMM(module, molecule, system) {
  const { constraints, bonds, angles, torsions, exceptions } = system;
  const arrays = [
    numberField(system.particles, 'mass_amu'),
    Float64Array.from(molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z])),
    integerField(constraints, 'i'), integerField(constraints, 'j'), numberField(constraints, 'distance_nm'),
    integerField(bonds, 'i'), integerField(bonds, 'j'), numberField(bonds, 'r0_nm'), numberField(bonds, 'k_kj_nm2'),
    integerField(angles, 'i'), integerField(angles, 'j'), integerField(angles, 'k'),
    numberField(angles, 'theta0_rad'), numberField(angles, 'k_kj_rad2'),
    integerField(torsions, 'i'), integerField(torsions, 'j'), integerField(torsions, 'k'), integerField(torsions, 'l'),
    integerField(torsions, 'periodicity'), numberField(torsions, 'phase_rad'), numberField(torsions, 'k_kj'),
    numberField(system.nonbonded, 'charge_e'), numberField(system.nonbonded, 'sigma_nm'), numberField(system.nonbonded, 'epsilon_kj'),
    integerField(exceptions, 'i'), integerField(exceptions, 'j'), numberField(exceptions, 'chargeprod_e2'),
    numberField(exceptions, 'sigma_nm'), numberField(exceptions, 'epsilon_kj'),
  ];
  const pointers = arrays.map((array) => allocate(module, array));
  try {
    const ok = module._molarium_initialize_sage(
      molecule.atoms.length, pointers[0], pointers[1],
      constraints.length, pointers[2], pointers[3], pointers[4],
      bonds.length, pointers[5], pointers[6], pointers[7], pointers[8],
      angles.length, pointers[9], pointers[10], pointers[11], pointers[12], pointers[13],
      torsions.length, pointers[14], pointers[15], pointers[16], pointers[17], pointers[18], pointers[19], pointers[20],
      pointers[21], pointers[22], pointers[23],
      exceptions.length, pointers[24], pointers[25], pointers[26], pointers[27], pointers[28],
      0, 0, 0, 0.001, 0,
    );
    if (!ok) throw new Error(module.UTF8ToString(module._molarium_last_error()));
  } finally {
    pointers.forEach((pointer) => { if (pointer) module._free(pointer); });
  }
}

function convertedBondEnergyKj(golden, comparison) {
  let energy = 0;
  for (const [identity, bond] of comparison.actualBonds) {
    if (comparison.expectedBonds.has(identity)) continue;
    const first = golden.conformer_nm[bond.i];
    const second = golden.conformer_nm[bond.j];
    const distance = Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
    energy += 0.5 * bond.k_kj_nm2 * (distance - bond.r0_nm) ** 2;
  }
  return energy;
}

const goldens = await readGoldens(source);
if (!goldens.length) throw new Error('No molecule golden JSON files were found');
const rdkit = await initRDKitModule({
  locateFile: (file) => join(projectRoot, 'rdkit/dist', file),
});
const openmm = await createMolariumOpenMM({
  wasmBinary: await Bun.file(join(projectRoot, 'openmm/molarium-openmm.wasm')).arrayBuffer(),
});

let failures = 0;
for (const golden of goldens) {
  const molecule = moleculeFromGolden(golden);
  const candidate = await parameterizeSage(rdkit, molecule);
  const comparison = compareGolden(golden, candidate);
  initializeOpenMM(openmm, molecule, candidate.system);
  const actualEnergyKj = openmm._molarium_get_potential_energy();
  openmm._molarium_destroy();
  const expectedEnergyKj = golden.energies.total_kj + convertedBondEnergyKj(golden, comparison);
  if (!close(actualEnergyKj, expectedEnergyKj, 1e-5, 1e-7)) {
    comparison.errors.push(`OpenMM energy ${actualEnergyKj} != converted golden ${expectedEnergyKj} kJ/mol`);
  }
  if (comparison.errors.length) {
    failures++;
    console.error(`FAIL ${golden.name} (${comparison.errors.length} differences)`);
    comparison.errors.slice(0, 12).forEach((error) => console.error(`  ${error}`));
  } else {
    console.log(`PASS ${golden.name} · ${candidate.system.particles.length} atoms · ${(actualEnergyKj / 4.184).toFixed(6)} kcal/mol`);
  }
}

console.log(`${goldens.length - failures}/${goldens.length} golden systems pass`);
if (failures) process.exitCode = 1;
