import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const paper = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || resolve(paper, 'build', 'Molarium_paper_source'));
const main = await readFile(resolve(paper, 'main.tex'), 'utf8');
const appendixB = await readFile(resolve(paper, 'appendix-b-workflows.tex'), 'utf8');
const marker = '\\input{appendix-b-workflows.tex}';
if (!main.includes(marker)) throw new Error(`Missing source marker: ${marker}`);

await mkdir(resolve(output, 'figures'), { recursive:true });
const intentMarker = '\\input{generated/sos1-designer-intent-results.tex}';
if (!main.includes(intentMarker)) throw new Error(`Missing source marker: ${intentMarker}`);
const intentResults = await readFile(resolve(paper, 'generated/sos1-designer-intent-results.tex'), 'utf8');
const complete = main.replace(marker,
  `% Appendix B inlined from appendix-b-workflows.tex for a single editable source file.\n${appendixB}`)
  .replace(intentMarker, `% Verified designer-intent measurements inlined.\n${intentResults}`);
await writeFile(resolve(output, 'Molarium_complete.tex'), complete);

const figures = new Set([...complete.matchAll(/\{(figures\/[a-zA-Z0-9_.-]+)\}/g)]
  .map((match) => match[1]));
if (figures.size !== 6) throw new Error(`Expected six manuscript figures, found ${figures.size}`);
for (const filename of figures)
  await copyFile(resolve(paper, filename), resolve(output, filename));

console.log(output);
