import { MOLARIUM_CCD_PROTOCOL, protocolSnapshot } from './protocol.mjs';

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

export async function createLabbook({ runId, startedAt, protocolOverrides = {}, inputs,
  selections, environment = {}, application = {} }) {
  if (!runId || !startedAt) throw new Error('A labbook requires a runId and ISO start time');
  const protocol = protocolSnapshot(protocolOverrides);
  return {
    schema:'molarium.docking.labbook/v1',
    runId:String(runId),
    startedAt:String(startedAt),
    completedAt:null,
    application:{ name:'Molarium', ...application },
    protocol,
    protocolSha256:await sha256Object(protocol),
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

export function renderLabbookMarkdown(labbook) {
  const constraintCount = labbook.selections?.hydrogenBonds?.length || 0;
  const lines = [
    `# ${labbook.protocol.name} labbook`, '',
    `**Run:** \`${labbook.runId}\`  `,
    `**Started:** ${labbook.startedAt}  `,
    `**Completed:** ${labbook.completedAt || 'in progress'}  `,
    `**Protocol:** \`${labbook.protocol.id}@${labbook.protocol.version}\`  `,
    `**Protocol SHA-256:** \`${labbook.protocolSha256}\`  `,
    `**Labbook SHA-256:** ${labbook.labbookSha256 ? `\`${labbook.labbookSha256}\`` : 'pending'}`, '',
    '## Inputs', '',
    `- Receptor: ${markdownCell(labbook.inputs?.receptor?.label)} — \`${markdownCell(labbook.inputs?.receptor?.sha256)}\``,
    `- Ligand: ${markdownCell(labbook.inputs?.ligand?.label)} — \`${markdownCell(labbook.inputs?.ligand?.sha256)}\``,
    `- Core atom matches: ${labbook.selections?.coreAtomPairs?.length || 0}`,
    `- Required H-bond constraints: ${constraintCount}`, '',
    'The audit stores input hashes and selections; it does not include proprietary coordinates.', '',
    '## Method lineage', '',
    ...labbook.protocol.lineage.map((source) =>
      `- [${source.method}](${source.url}) — ${source.citation}${source.doi ? ` DOI: \`${source.doi}\`.` : ''}`),
    '', 'This is an independent Molarium protocol. It does not reproduce GlideScore, ICM Score, or proprietary product code.', '',
    '## Events', '',
    '| # | Time | Stage | Status | Entry SHA-256 |',
    '| ---: | --- | --- | --- | --- |',
    ...labbook.events.map((event) => `| ${event.index + 1} | ${markdownCell(event.at)} | ${markdownCell(event.stage)} | ${markdownCell(event.status)} | \`${event.entrySha256}\` |`),
  ];
  if (labbook.outcome) lines.push('', '## Outcome', '', '```json', JSON.stringify(labbook.outcome, null, 2), '```');
  return `${lines.join('\n')}\n`;
}

export { MOLARIUM_CCD_PROTOCOL };
