#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  if (typeof value === 'number') {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return JSON.stringify(`~f64:${bytes.toString('hex')}`);
  }
  return JSON.stringify(value);
}
const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');
const fileDigest = (value) => createHash('sha256').update(value).digest('hex');

const molecule = {
  atoms:[
    { atomId:'test:0', element:'C', formalCharge:0, aromatic:false, x:0, y:0, z:0 },
    { atomId:'test:1', element:'C', formalCharge:0, aromatic:false, x:1.5, y:0, z:0 },
  ],
  bonds:[{ a:0, b:1, order:1, aromatic:false }],
  parameterization:{ forcefield:'analytic-test', sourceSha256:'test', system:{
    particles:[{ mass_amu:12 }, { mass_amu:12 }], constraints:[],
    bonds:[{ i:0, j:1, r0_nm:0.1, k_kj_nm2:1000 }], angles:[], torsions:[],
    nonbonded:[
      { charge_e:0, sigma_nm:0.3, epsilon_kj:0 },
      { charge_e:0, sigma_nm:0.3, epsilon_kj:0 },
    ], exceptions:[],
  } },
};
const atomIds = molecule.atoms.map((atom) => atom.atomId);
const topology = { atoms:molecule.atoms.map((atom) => ({ atomId:atom.atomId,
  element:atom.element, formalCharge:0, aromatic:false })), bonds:molecule.bonds };
const pose = { id:'analytic-harmonic-bond', molecule, integrity:{
  atomOrderSha256:digest(atomIds), topologySha256:digest(topology),
  coordinatesSha256:digest(molecule.atoms.map(({ x, y, z }) => [x, y, z])),
  numericSystemSha256:digest(molecule.parameterization.system), atomCount:2, bondCount:1,
} };
const directory = await mkdtemp(join(tmpdir(), 'molarium-openmm-wasm-test-'));
try {
  const input = join(directory, 'input.json');
  const output = join(directory, 'output.json');
  await writeFile(input, `${JSON.stringify({ schema:'molarium.analogue-pose-panel/v1',
    poses:[pose] })}\n`);
  execFileSync(process.execPath, [
    resolve('docking/validation/cloud-panel/score_openmm_wasm.mjs'), input,
    resolve('openmm/molarium-openmm.js'), resolve('openmm/molarium-openmm.wasm'), output,
  ], { stdio:'pipe' });
  const result = JSON.parse(await readFile(output, 'utf8')).poses[0];
  assert.ok(Math.abs(result.energyKjMol - 1.25) < 1e-12);
  assert.ok(Math.abs(Math.abs(result.forcesKjMolNm[0]) - 50) < 1e-10);
  assert.ok(Math.abs(result.forcesKjMolNm[0] + result.forcesKjMolNm[3]) < 1e-12);

  const corrupted = structuredClone(pose);
  corrupted.molecule.atoms[1].x = 1.6;
  await writeFile(input, `${JSON.stringify({ schema:'molarium.analogue-pose-panel/v1',
    poses:[corrupted] })}\n`);
  assert.throws(() => execFileSync(process.execPath, [
    resolve('docking/validation/cloud-panel/score_openmm_wasm.mjs'), input,
    resolve('openmm/molarium-openmm.js'), resolve('openmm/molarium-openmm.wasm'), output,
  ], { stdio:'pipe' }), /Command failed/);
} finally {
  await rm(directory, { recursive:true, force:true });
}

const provenance = JSON.parse(await readFile('openmm/BUILD-PROVENANCE.json', 'utf8'));
const wasmBytes = await readFile('openmm/molarium-openmm.wasm');
assert.equal(provenance.schema, 'molarium.openmm-wasm-build-provenance/v1');
assert.equal(fileDigest(wasmBytes), provenance.outputs['molarium-openmm.wasm']);
assert.equal(fileDigest(await readFile('openmm/molarium-openmm.js')),
  provenance.outputs['molarium-openmm.js']);
assert.equal(fileDigest(await readFile('openmm/molarium_openmm.cpp')),
  provenance.inputs.bridgeSha256);
assert.equal(fileDigest(await readFile('openmm/openmm-8.2-emscripten.patch')),
  provenance.inputs.emscriptenPatchSha256);
assert.equal(fileDigest(await readFile('openmm/openmm-8.2-emscripten-ccma.patch')),
  provenance.inputs.serialCcmaPatchSha256);

const nativeReportBytes = await readFile(
  'docking/validation/cloud-panel/openmm-wasm-native-validation-2026-08-23.json');
const nativeReport = JSON.parse(nativeReportBytes);
assert.equal(nativeReport.schema, 'molarium.openmm-wasm-native-validation/v1');
assert.deepEqual(nativeReport.gate, { passed:true, poseCount:5 });
assert.equal(fileDigest(nativeReportBytes), provenance.validation.reportSha256);
for (const poseResult of nativeReport.poses) {
  assert.equal(poseResult.comparison.gate.passed, true);
  assert.ok(poseResult.comparison.absoluteEnergyDeltaKcalMol <= 1e-2);
  assert.ok(poseResult.comparison.forceRelativeRms <= 1e-3);
}

const browserReport = JSON.parse(await readFile(
  'docking/validation/cloud-panel/browser-sage-openmm-validation-2026-08-23.json', 'utf8'));
const browserReportBytes = await readFile(
  'docking/validation/cloud-panel/browser-sage-openmm-validation-2026-08-23.json');
assert.equal(fileDigest(browserReportBytes), provenance.validation.browserReportSha256);
assert.equal(browserReport.schema, 'molarium.browser-sage-openmm-validation/v1');
assert.deepEqual(browserReport.gate, { passed:true, poseCount:5 });
assert.equal(browserReport.source.packetSha256, nativeReport.source.packetSha256);
const nativeById = new Map(nativeReport.poses.map((entry) => [entry.id, entry]));
for (const poseResult of browserReport.poses) {
  const native = nativeById.get(poseResult.id);
  assert.ok(native);
  assert.equal(poseResult.openmmWasmSha256, provenance.outputs['molarium-openmm.wasm']);
  assert.equal(poseResult.numericSystemSha256, poseResult.parameterizedSystemSha256);
  assert.equal(poseResult.implicitSolvent, null);
  assert.equal(poseResult.constraintMode, 'none');
  assert.equal(poseResult.constraintCount, 0);
  assert.equal(poseResult.cutoffNm, null);
  assert.equal(poseResult.gate.passed, true);
  assert.ok(poseResult.absoluteEnergyDeltaKcalMol <= 1e-2);
  assert.ok(poseResult.forceRelativeRms <= 1e-3);
  assert.ok(Math.abs(poseResult.openmmPotentialEnergyKcalMol
    - native.nativePotentialEnergyKcalMol) <= 1e-10);
  assert.ok(Math.abs(poseResult.sagePotentialEnergyKcalMol
    - native.nativePotentialEnergyKcalMol) <= 1e-2);
}

console.log('OpenMM WASM scorer: analytic integrity, pinned build, native parity, and real-browser Sage parity passed');
