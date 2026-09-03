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
const complete = main.replace(marker,
  `% Appendix B inlined from appendix-b-workflows.tex for a single editable source file.\n${appendixB}`);
await writeFile(resolve(output, 'Molarium_complete.tex'), complete);

for (const filename of [
  'fig1_molarium_interface.png',
  'fig2_sos1_hit_to_bay293.png',
  'fig2_architecture.png',
  'fig3_build_loop_compact.png',
  'fig4_evidence_ladder_fixed.png',
  'fig5_value_layers_fixed.png',
]) await copyFile(resolve(paper, 'figures', filename), resolve(output, 'figures', filename));

console.log(output);
