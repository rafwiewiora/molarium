import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL, protocolSnapshot } from './protocol.mjs';

function canonicalValue(value) {
  if (ArrayBuffer.isView(value)) return Array.from(value, canonicalValue);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError('Labbook records cannot contain non-finite numbers');
  return value;
}

export function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

export async function sha256Text(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Object(value) { return sha256Text(canonicalJson(value)); }

export async function inputProvenance({ receptorText, ligandText, receptorLabel = 'receptor',
  ligandLabel = 'ligand', receptorAtoms = null, ligandAtoms = null }) {
  if (typeof receptorText !== 'string' || typeof ligandText !== 'string')
    throw new TypeError('Input provenance requires the exact receptor and ligand text');
  return {
    receptor:{ label:receptorLabel, sha256:await sha256Text(receptorText), atoms:receptorAtoms },
    ligand:{ label:ligandLabel, sha256:await sha256Text(ligandText), atoms:ligandAtoms },
    coordinatePayloadIncluded:false,
  };
}

export async function createLabbook({ runId, startedAt, protocol = null, protocolOverrides = {}, inputs,
  selections, environment = {}, application = {} }) {
  if (!runId || !startedAt) throw new Error('A labbook requires a runId and ISO start time');
  const resolvedProtocol = protocol ? canonicalValue(protocol) : protocolSnapshot(protocolOverrides);
  return {
    schema:'molarium.docking.labbook/v1',
    runId:String(runId),
    startedAt:String(startedAt),
    completedAt:null,
    application:{ name:'Molarium', ...application },
    protocol:resolvedProtocol,
    protocolSha256:await sha256Object(resolvedProtocol),
    inputs:canonicalValue(inputs),
    selections:canonicalValue(selections),
    environment:canonicalValue(environment),
    events:[],
    outcome:null,
  };
}

export async function appendLabbookEvent(labbook, event) {
  if (labbook.labbookSha256) throw new Error('A completed labbook is immutable');
  const previousEntrySha256 = labbook.events.at(-1)?.entrySha256 || null;
  const body = canonicalValue({
    index:labbook.events.length,
    at:String(event.at),
    stage:String(event.stage),
    status:String(event.status),
    details:event.details || {},
    previousEntrySha256,
  });
  const entry = { ...body, entrySha256:await sha256Object(body) };
  labbook.events.push(entry);
  return entry;
}

export async function completeLabbook(labbook, { completedAt, outcome }) {
  await appendLabbookEvent(labbook, {
    at:completedAt, stage:'run', status:'completed', details:outcome,
  });
  labbook.completedAt = String(completedAt);
  labbook.outcome = canonicalValue(outcome);
  labbook.labbookSha256 = await sha256Object({ ...labbook, labbookSha256:undefined });
  return labbook;
}

export async function verifyLabbook(labbook) {
  if (await sha256Object(labbook.protocol) !== labbook.protocolSha256)
    return { valid:false, reason:'protocol hash mismatch' };
  let previousEntrySha256 = null;
  for (let index = 0; index < labbook.events.length; index++) {
    const entry = labbook.events[index];
    const { entrySha256, ...body } = entry;
    if (entry.index !== index || entry.previousEntrySha256 !== previousEntrySha256)
      return { valid:false, reason:`event chain mismatch at ${index}` };
    if (await sha256Object(body) !== entrySha256)
      return { valid:false, reason:`event hash mismatch at ${index}` };
    previousEntrySha256 = entrySha256;
  }
  if (labbook.labbookSha256) {
    const actual = await sha256Object({ ...labbook, labbookSha256:undefined });
    if (actual !== labbook.labbookSha256) return { valid:false, reason:'labbook hash mismatch' };
  }
  return { valid:true, reason:null, events:labbook.events.length };
}

function markdownCell(value) { return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' '); }

function markdownNumber(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

export function renderLabbookMarkdown(labbook) {
  const constraintCount = labbook.selections?.hydrogenBonds?.length || 0;
  const outcome = labbook.outcome || {};
  const execution = labbook.environment || {};
  const physical = outcome.selectedPhysicalComponents || {};
  const refinement = outcome.selectedRefinement || {};
  const propagation = labbook.protocol?.id === 'molarium-pose-propagation-1';
  const lines = [
    `# ${labbook.protocol.name} labbook`, '',
    `> Experimental ${propagation ? 'edit-lineage pose propagation' : 'fixed-core pose ranking'} with a rigid receptor. This is not a binding free-energy calculation.`, '',
    '| Record | Value |', '| --- | --- |',
    `| Run | \`${markdownCell(labbook.runId)}\` |`,
    `| Started | ${markdownCell(labbook.startedAt)} |`,
    `| Completed | ${markdownCell(labbook.completedAt || 'in progress')} |`,
    `| Protocol | \`${labbook.protocol.id}@${labbook.protocol.version}\` |`,
    `| Protocol SHA-256 | \`${labbook.protocolSha256}\` |`,
    `| Labbook SHA-256 | ${labbook.labbookSha256 ? `\`${labbook.labbookSha256}\`` : 'pending'} |`, '',
    '## Result', '',
    `- Generated/scored poses: **${outcome.generatedConformers ?? '—'} / ${outcome.scoredConformers ?? '—'}**`,
    `- Constraint-feasible poses: **${outcome.feasiblePoses ?? '—'}**`,
    `- Selected score: **${markdownNumber(outcome.selectedScoreKcalMol)} kcal/mol**`,
    `- Physical / restraint: **${markdownNumber(outcome.selectedPhysicalKcalMol)} / ${markdownNumber(outcome.selectedConstraintPenaltyKcalMol)} kcal/mol**`,
    `- Core RMSD: **${markdownNumber(outcome.selectedCoreRmsdAngstrom, 3)} Å**`, '',
    '### Selected torsion search', '',
    `- Method: **${markdownCell(refinement.method)}**`,
    `- Free rotors / proposals: **${refinement.rotatableBondCount ?? '—'} / ${refinement.proposals ?? '—'}**`,
    `- Accepted / improved: **${refinement.accepted ?? '—'} / ${refinement.improved ?? '—'}**`,
    `- Objective: **${markdownNumber(refinement.startObjectiveKcalMol)} → ${markdownNumber(refinement.bestObjectiveKcalMol)} kcal/mol**`, '',
    '| Selected physical component | kcal/mol |', '| --- | ---: |',
    `| Lennard-Jones cross term | ${markdownNumber(physical.lennardJonesKcalMol)} |`,
    `| Coulomb cross term | ${markdownNumber(physical.coulombKcalMol)} |`,
    `| Relative ligand strain | ${markdownNumber(physical.ligandStrainKcalMol)} |`, '',
    '## Inputs', '',
    '| Input | Atoms | SHA-256 |', '| --- | ---: | --- |',
    `| ${markdownCell(labbook.inputs?.receptor?.label)} | ${labbook.inputs?.receptor?.atoms ?? '—'} | \`${markdownCell(labbook.inputs?.receptor?.sha256)}\` |`,
    `| ${markdownCell(labbook.inputs?.ligand?.label)} | ${labbook.inputs?.ligand?.atoms ?? '—'} | \`${markdownCell(labbook.inputs?.ligand?.sha256)}\` |`, '',
    'The audit stores input hashes and selections; it does not include proprietary coordinates.', '',
    '## Selections', '',
    `- ${propagation ? 'Automatically inherited heavy atoms' : 'Conserved core matches'}: **${labbook.selections?.coreAtomPairs?.length || 0}**`,
    ...(propagation ? [
      `- Added heavy atoms: **${labbook.selections?.atomLineage?.addedAtomIds?.length || 0}**`,
      `- Removed heavy atoms: **${labbook.selections?.atomLineage?.removedAtomIds?.length || 0}**`,
    ] : []),
    `- Required H-bond constraints: **${constraintCount}**`,
    ...((labbook.selections?.hydrogenBonds || []).map((entry) =>
      `  - ${markdownCell(entry.label || entry.id)} (${markdownCell(entry.receptorRole || 'receptor role unspecified')})`)), '',
    ...((labbook.selections?.omittedHydrogenBonds || []).length ? [
      `- Omitted reference contacts: **${labbook.selections.omittedHydrogenBonds.length}**`,
      ...labbook.selections.omittedHydrogenBonds.map((entry) =>
        `  - ${markdownCell(entry.label || entry.id)} — ${markdownCell(entry.reason)}`), ''
    ] : []),
    '## Execution', '',
    '| Setting | Value |', '| --- | --- |',
    `| Location | ${markdownCell(execution.execution)} |`,
    `| Network used | ${execution.networkUsed === false ? 'No' : markdownCell(execution.networkUsed)} |`,
    `| Deterministic seed | \`${markdownCell(execution.deterministicSeed)}\` |`,
    `| Receptor parameters | ${markdownCell(execution.receptorForcefield)} · ${markdownCell(execution.receptorChargeModel)} |`,
    `| Edited-ligand parameters | ${markdownCell(execution.ligandForcefield)} · ${markdownCell(execution.ligandChargeModel)} |`,
    `| Conformer engine | ${markdownCell(execution.conformerBackend)} · RDKit ${markdownCell(execution.rdkitVersion)} |`,
    `| Conformer cleanup | ${markdownCell((execution.conformerPreparationForcefields || []).join(', '))} |`, '',
    '## Method lineage', '',
    ...labbook.protocol.lineage.map((source) =>
      `- [${source.method}](${source.url}) — ${source.citation}${source.doi ? ` DOI: \`${source.doi}\`.` : ''}`),
    '', 'This is an independent Molarium protocol. It does not reproduce GlideScore, ICM Score, or proprietary product code.', '',
    '## Hash-linked run events', '',
    ...labbook.events.flatMap((event) => [
      `### ${event.index + 1}. ${markdownCell(event.stage)} — ${markdownCell(event.status)}`,
      '', `Time: ${markdownCell(event.at)}  `,
      `Previous: ${event.previousEntrySha256 ? `\`${event.previousEntrySha256}\`` : 'chain origin'}  `,
      `Entry: \`${event.entrySha256}\``, '',
      '```json', JSON.stringify(event.details, null, 2), '```', '',
    ]),
  ];
  if (outcome.topPoses?.length) lines.push('## Top poses', '',
    '| Rank | Feasible | Total | Physical | Penalty | Core RMSD |',
    '| ---: | --- | ---: | ---: | ---: | ---: |',
    ...outcome.topPoses.map((pose) => `| ${pose.rank} | ${pose.feasible ? 'yes' : 'no'} | ${markdownNumber(pose.totalScoreKcalMol)} | ${markdownNumber(pose.physicalEnergyKcalMol)} | ${markdownNumber(pose.constraintPenaltyKcalMol)} | ${markdownNumber(pose.coreRmsdAngstrom, 3)} Å |`), '');
  lines.push('## Full outcome record', '', '```json', JSON.stringify(labbook.outcome, null, 2), '```');
  return `${lines.join('\n')}\n`;
}

export { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL };
