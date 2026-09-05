#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentValue, buildAcceptedSos1ReplayScript, requireExplicitRunDirectory,
  sha256, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runDirectory = requireExplicitRunDirectory(process.argv.slice(2), { root });
const output = resolve(root, argumentValue(process.argv.slice(2), '--output')
  || `${relative(root, runDirectory)}/accepted-selected-route.action-script.json`);
const verified = await verifyAcceptedSos1Run(runDirectory);
const replay = await buildAcceptedSos1ReplayScript(verified);
const bytes = Buffer.from(`${JSON.stringify(replay.script, null, 2)}\n`);
await mkdir(dirname(output), { recursive:true });
await writeFile(output, bytes);
console.log(JSON.stringify({ output:relative(root, output), fileSha256:sha256(bytes),
  actionScriptSha256:replay.actionScriptSha256, actions:replay.script.actions.length,
  acceptedRun:verified.runId }, null, 2));
