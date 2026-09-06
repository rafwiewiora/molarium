import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';

// Independent coverage declaration: a packet cannot redefine what "full suite"
// means by omitting cases. A changed protocol needs a new reviewed declaration.
const smallCases = [
  ...['bonds','angles','torsions','lj','coulomb','nonbonded','improper','total','obc2']
    .map(term => `analytic-${term}`), 'zero-forces',
  ...[0.79,0.7999,0.8001,0.81,1.2].flatMap(distance =>
    [`cutoff-pair-${distance}`, `cutoff-exception-${distance}`]),
  ...['trpcage','ubiquitin'].flatMap(name => [
    ...['bonds','angles','torsions','lj','coulomb'].map(term => `${name}-${term}`),
    ...['original','perturbed','translated-500A'].flatMap(snapshot =>
      ['vacuum','obc2'].map(solvent => `${name}-${snapshot}-${solvent}`)),
    `${name}-cutoff-obc2`, `${name}-hbonds-obc2`,
  ]),
];
export const SUITES = Object.freeze({
  'openmm-full-47':Object.freeze([...smallCases, 'openmm-dhfr-gbsa']),
  'openmm-small-46':Object.freeze(smallCases),
});
const protocolBytes = readFileSync(new URL('./protocol.json', import.meta.url));
const protocolSha256 = createHash('sha256').update(protocolBytes).digest('hex');
const protocol = JSON.parse(protocolBytes);

function caseIds(dataset, label) {
  if (!Array.isArray(dataset?.cases) || !dataset.cases.length)
    throw new Error(`${label} must contain nonempty cases`);
  const ids = dataset.cases.map(c => c?.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
    throw new Error(`${label} contains invalid or duplicate case IDs`);
  return ids;
}

export function validateScoreInputs(packet, reference, actual,
    {suite = 'openmm-full-47', diagnostic = false} = {}) {
  if (!Object.hasOwn(SUITES, suite)) throw new Error(`Unknown benchmark suite: ${suite}`);
  if (packet.data.schema !== 'molarium.simulation-benchmark-packet/v1')
    throw new Error('Unsupported packet schema');
  if (packet.data.protocolSha256 !== protocolSha256
      || !isDeepStrictEqual(packet.data.protocol, protocol))
    throw new Error('Protocol content or hash differs from the reviewed protocol');
  if (reference.data.schema !== 'molarium.native-openmm-benchmark/v1'
      || reference.data.platform !== 'Reference')
    throw new Error('The oracle must be native OpenMM Reference with its supported result schema');
  if (!['molarium.native-openmm-benchmark/v1', 'molarium.webgpu-simulation-benchmark/v1']
    .includes(actual.data.schema)) throw new Error('Unsupported measured-result schema');
  const ids = caseIds(packet.data, 'Packet');
  const expected = SUITES[suite];
  if (ids.some(id => !expected.includes(id))) throw new Error('Unknown case in benchmark packet');
  const complete = ids.length === expected.length && expected.every(id => ids.includes(id));
  if (!complete && !diagnostic)
    throw new Error(`Missing cases from ${suite}; use --diagnostic for a non-gating subset`);
  for (const c of packet.data.cases)
    if (!Array.isArray(c.molecule?.atoms) || !c.molecule.atoms.length)
      throw new Error(`Case ${c.id} must declare a nonempty atom array`);
  for (const result of [reference.data, actual.data]) {
    if (result.error) throw new Error(`Failed benchmark: ${result.error}`);
    if (result.packetSha256 !== packet.sha256 || result.protocolSha256 !== protocolSha256)
      throw new Error('Packet or protocol provenance mismatch');
    const measuredIds = caseIds(result, 'Result');
    if (measuredIds.length !== ids.length || measuredIds.some(id => !ids.includes(id)))
      throw new Error('Missing or unexpected result cases');
  }
  return {suite, expectedCases:expected.length, observedCases:ids.length, complete,
    diagnostic, fullSuite:complete && suite === 'openmm-full-47' && !diagnostic};
}

export function validateObservation(value, atomCount, label, {reference = false} = {}) {
  if (!value || !Number.isFinite(value.energy) || !Array.isArray(value.forces)
      || value.forces.length !== 3 * atomCount || !value.forces.every(Number.isFinite))
    throw new Error(`${label} must contain finite energy and exactly 3N (${3 * atomCount}) Cartesian forces`);
  if (reference || value.components != null) {
    if (!value.components || typeof value.components !== 'object' || Array.isArray(value.components)
        || !Object.keys(value.components).length || !Object.values(value.components).every(Number.isFinite))
      throw new Error(`${label} must contain finite, nonempty energy components`);
  }
}
