import { readFile } from 'node:fs/promises';

const expectedBondPath = 'M9.5 35 12.5 13 24 28 35.5 13 38.5 35';
const files = {
  mark:await readFile(new URL('../assets/molarium-mark.svg', import.meta.url), 'utf8'),
  logo:await readFile(new URL('../assets/molarium-logo.svg', import.meta.url), 'utf8'),
  page:await readFile(new URL('../index.html', import.meta.url), 'utf8'),
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const [name, source] of Object.entries({ mark:files.mark, logo:files.logo })) {
  assert(source.includes(expectedBondPath), `${name} does not use the canonical molecular M geometry`);
  assert((source.match(/<circle\b/g) || []).length === 5, `${name} must contain five atom nodes`);
  assert((source.match(/data-molarium-bonds/g) || []).length === 1,
    `${name} must contain one canonical bond network`);
  assert((source.match(/data-molarium-atoms/g) || []).length === 1,
    `${name} must label its atom-node group`);
}

assert((files.page.match(new RegExp(expectedBondPath, 'g')) || []).length === 4,
  'the header and calculation-loader marks must each contain matching foreground and shadow bonds');
assert((files.page.match(/data-molarium-atoms/g) || []).length === 2,
  'the header and calculation-loader marks must both contain atom nodes');
assert(!Object.values(files).some((source) => source.includes('M10 34V14.5L24 28')),
  'the retired folded-ribbon mark is still present');

console.log('Molarium logo geometry: 3/3 sources consistent · 5 atoms · 4 bonds');
