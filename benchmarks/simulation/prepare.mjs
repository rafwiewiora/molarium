import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { obc2Parameters } from '../../openff/implicit-solvent.js';
import { configureSimulationSystem } from '../../openff/simulation-options.js';
const root = new URL('../../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protocolBytes = await readFile(new URL('./protocol.json', import.meta.url));
const protocol = JSON.parse(protocolBytes), cases = [], sources = [];
function add(id, molecule, options = {}, extra = {}) {
  const config = configureSimulationSystem(molecule, molecule.parameterization.system, options);
  cases.push({ id, molecule, options, configuredSystem: config.system,
    implicitSolvent: options.implicitSolvent === 'obc2' ? obc2Parameters(molecule, config.system) : null, ...extra });
}
function tiny() {
  const atoms = [[0, 0, 0], [1.61, 0.14, 0], [2.01, 1.72, 0.25], [3.23, 1.85, 1.13]]
    .map(([x,y,z]) => ({ element: 'C', x, y, z }));
  return { atoms, bonds: [{a:0,b:1,order:1},{a:1,b:2,order:1},{a:2,b:3,order:1}],
    parameterization: { forcefield: 'analytic test System', chargeModel: 'explicit numeric charges', system: {
      particles: atoms.map(() => ({ mass_amu: 12 })), constraints: [],
      bonds: [{ i:0,j:1,r0_nm:0.15,k_kj_nm2:200000 }],
      angles: [{ i:0,j:1,k:2,theta0_rad:1.9,k_kj_rad2:250 }],
      torsions: [{ i:0,j:1,k:2,l:3,periodicity:3,phase_rad:0.37,k_kj:2.7 }],
      nonbonded: atoms.map((_,i) => ({charge_e: [0.2,-0.3,0.15,-0.05][i],sigma_nm:0.25+i*0.02,epsilon_kj:0.15+i*0.03})),
      exceptions: [{i:0,j:1,chargeprod_e2:0,sigma_nm:0.2,epsilon_kj:0},
        {i:0,j:3,chargeprod_e2:-0.005,sigma_nm:0.27,epsilon_kj:0.08}],
    } } };
}
function isolate(m, term) {
  const v = structuredClone(m), s = v.parameterization.system;
  for (const field of ['bonds','angles','torsions']) if (field !== term) s[field] = [];
  for (const row of s.nonbonded) {
    if (term !== 'coulomb' && term !== 'nonbonded') row.charge_e = 0;
    if (term !== 'lj' && term !== 'nonbonded') row.epsilon_kj = 0;
  }
  for (const row of s.exceptions) {
    if (term !== 'coulomb' && term !== 'nonbonded') row.chargeprod_e2 = 0;
    if (term !== 'lj' && term !== 'nonbonded') row.epsilon_kj = 0;
  }
  return v;
}
for (const term of ['bonds','angles','torsions','lj','coulomb','nonbonded'])
  add(`analytic-${term}`, isolate(tiny(), term));
const improper = isolate(tiny(), 'torsions');
improper.parameterization.system.torsions = [{i:1,j:0,k:2,l:3,periodicity:2,phase_rad:Math.PI,k_kj:1.7}];
add('analytic-improper', improper);
add('analytic-total', tiny());
add('analytic-obc2', tiny(), {implicitSolvent:'obc2'});
const zero = isolate(tiny(), 'zero'); add('zero-forces', zero);
for (const distanceNm of [0.79,0.7999,0.8001,0.81,1.2]) {
  const m = tiny(); m.atoms = m.atoms.slice(0,2); m.atoms[1].x = distanceNm*10; m.atoms[1].y = 0;
  m.bonds = []; const s = m.parameterization.system;
  s.particles = s.particles.slice(0,2); s.nonbonded = s.nonbonded.slice(0,2);
  s.bonds = []; s.angles = []; s.torsions = []; s.exceptions = [];
  add(`cutoff-pair-${distanceNm}`, m, {cutoffNm:0.8});
  const exception = structuredClone(m);
  exception.parameterization.system.exceptions = [{i:0,j:1,chargeprod_e2:-0.03,sigma_nm:0.26,epsilon_kj:0.08}];
  add(`cutoff-exception-${distanceNm}`, exception, {cutoffNm:0.8});
}
for (const [name,path] of [['trpcage','openff/rosemary-trp-cage.json'],['ubiquitin','openff/rosemary-ubiquitin.json']]) {
  const bytes = await readFile(new URL(path, root)), fixture = JSON.parse(bytes);
  sources.push({path,sha256:sha(bytes),source:fixture.source});
  const base = fixture.molecule;
  for (const term of ['bonds','angles','torsions','lj','coulomb']) add(`${name}-${term}`,isolate(base,term));
  for (const snapshot of ['original','perturbed','translated-500A']) {
    const m = structuredClone(base);
    m.atoms.forEach((a,i) => ['x','y','z'].forEach((axis,k) => {
      if (snapshot === 'perturbed') a[axis] += 0.02 * Math.sin(17*i+7*k+0.3);
      if (snapshot === 'translated-500A') a[axis] += 500;
    }));
    for (const solvent of ['vacuum','obc2']) add(`${name}-${snapshot}-${solvent}`,m,{implicitSolvent:solvent},
      {performance: snapshot === 'original', classification: snapshot === 'translated-500A' ? 'stress' : 'normal'});
  }
  add(`${name}-cutoff-obc2`,base,{implicitSolvent:'obc2',cutoffNm:1.2},{performance:true});
  add(`${name}-hbonds-obc2`,base,{implicitSolvent:'obc2',constraintMode:'hbonds'}, {performance:true});
}
// Optional independently exported upstream DHFR fixture, never synthesized from a different protein.
try {
  if (process.argv.includes('--without-upstream')) throw Object.assign(new Error('explicit small suite'),{code:'SKIP_UPSTREAM'});
  const path = new URL('./generated/openmm-dhfr-gbsa.json', import.meta.url);
  const bytes = await readFile(path), f = JSON.parse(bytes);
  sources.push({path:'generated/openmm-dhfr-gbsa.json',sha256:sha(bytes),source:f.source});
  const expected = obc2Parameters(f.molecule,f.molecule.parameterization.system);
  if (!isDeepStrictEqual(expected, f.implicitSolvent))
    throw new Error('Upstream DHFR OBC parameters differ from production WebGPU; do not silently substitute');
  add('openmm-dhfr-gbsa',f.molecule,{implicitSolvent:'obc2',cutoffNm:2,
    maximumNeighbors:f.molecule.atoms.length-1},{performance:true,upstream:f.source});
} catch (error) {
  if (error.code === 'ENOENT') throw new Error('Export upstream DHFR first, or explicitly use --without-upstream for the 46-case subset');
  if (error.code !== 'SKIP_UPSTREAM') throw error;
}
const outputIndex=process.argv.indexOf('--output');
const output = outputIndex<0?new URL('./generated/packet.json', import.meta.url):new URL(process.argv[outputIndex+1],`file://${process.cwd()}/`);
await mkdir(new URL('./generated/', import.meta.url),{recursive:true});
await writeFile(output,JSON.stringify({schema:'molarium.simulation-benchmark-packet/v1',protocol,protocolSha256:sha(protocolBytes),sources,cases})+'\n');
console.log(`Prepared ${cases.length} cases: ${output.pathname}`);
