import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const script = process.argv[2];
if (!script || path.basename(script) !== script || !script.endsWith('.py'))
  throw new Error('Expected a Python tool name from docking/benchmark');

const python = process.env.MOLARIUM_RDKIT_PYTHON || 'python3';
const child = spawn(python, [path.join(root, script), ...process.argv.slice(3)], {
  cwd:root,
  stdio:'inherit',
});
child.on('error', (error) => {
  console.error(`Unable to start ${python}: ${error.message}`);
  console.error('Activate the benchmark RDKit environment or set MOLARIUM_RDKIT_PYTHON.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`RDKit Python tool stopped by ${signal}`);
    process.exitCode = 1;
  } else process.exitCode = code ?? 1;
});
