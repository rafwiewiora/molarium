#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { actionScriptFromAudit, actionScriptSha256 } from '../design-history/replay.mjs';

function valueFor(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseSequences(specification) {
  if (!specification) return null;
  const result = new Set();
  for (const token of specification.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) throw new Error(`Invalid audit sequence or range: ${token}`);
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first) throw new Error(`Invalid audit sequence range: ${token}`);
    for (let sequence = first; sequence <= last; sequence++) result.add(sequence);
  }
  return [...result].sort((a, b) => a - b);
}

function usage() {
  return [
    'Usage: node scripts/audit-to-action-script.mjs --input AUDIT.json --output SCRIPT.json [options]',
    '',
    'Options:',
    '  --label TEXT                 script label',
    '  --omit-read-only            omit session/designRoute/structureStory inspections',
    '  --sequences 1-12,20,24-30   include only these source audit sequences',
    '  --captions FILE.json        object mapping source sequence numbers to captions',
    '  --caption-from-request-id   use an audit request ID when no explicit caption exists',
    '  --include-audit-metadata    retain sequence/request ID on individual steps',
  ].join('\n');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

const inputArgument = valueFor('--input'), outputArgument = valueFor('--output');
if (!inputArgument || !outputArgument) throw new Error(usage());
const input = resolve(inputArgument), output = resolve(outputArgument);
const bytes = await readFile(input), audit = JSON.parse(bytes);
const captionsPath = valueFor('--captions');
const captionsBySequence = captionsPath
  ? JSON.parse(await readFile(resolve(captionsPath), 'utf8')) : {};
const sourceAuditSha256 = createHash('sha256').update(bytes).digest('hex');
const script = actionScriptFromAudit(audit, {
  label:valueFor('--label') || `Replay of ${audit.routeId || 'Chemist Actions audit'}`,
  includeReadOnly:!process.argv.includes('--omit-read-only'),
  includeSequences:parseSequences(valueFor('--sequences')),
  captionsBySequence,
  captionFromRequestId:process.argv.includes('--caption-from-request-id'),
  includeAuditMetadata:process.argv.includes('--include-audit-metadata'),
  provenance:{ path:relative(process.cwd(), input), sha256:sourceAuditSha256 },
});
const scriptSha256 = await actionScriptSha256(script);
await writeFile(output, `${JSON.stringify(script, null, 2)}\n`);
console.log(`${relative(process.cwd(), output)}: ${script.actions.length} actions; ${scriptSha256}`);
