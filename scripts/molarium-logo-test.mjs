import { readFile } from 'node:fs/promises';

const expectedLetterPath = 'M8.5 36.5 14.5 12.5 24 29.5 33.5 12.5 39.5 36.5';
const expectedFlaskPath = 'M21 8v10L11.5 34.5A4.5 4.5 0 0 0 15.5 41h17a4.5 4.5 0 0 0 4-6.5L27 18V8Z';
const files = {
  mark:await readFile(new URL('../assets/molarium-mark.svg', import.meta.url), 'utf8'),
  logo:await readFile(new URL('../assets/molarium-logo.svg', import.meta.url), 'utf8'),
  page:await readFile(new URL('../index.html', import.meta.url), 'utf8'),
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const [name, source] of Object.entries({ mark:files.mark, logo:files.logo })) {
  assert(source.includes(expectedLetterPath), `${name} does not use the canonical letter M geometry`);
  assert(source.includes(expectedFlaskPath), `${name} does not use the canonical flask geometry`);
  assert((source.match(/data-molarium-letter/g) || []).length === 1,
    `${name} must contain one blended letter M`);
  assert((source.match(/data-molarium-flask/g) || []).length === 1,
    `${name} must contain one chemistry flask`);
  assert((source.match(/data-molarium-foam/g) || []).length === 1,
    `${name} must contain one foam group`);
  assert((source.match(/<circle\b/g) || []).length === 6, `${name} must contain six foam bubbles`);
}

assert((files.page.match(new RegExp(expectedLetterPath, 'g')) || []).length === 3,
  'the header, blank canvas, and calculation loader must use the same letter M');
assert((files.page.match(new RegExp(expectedFlaskPath, 'g')) || []).length === 3,
  'the header, blank canvas, and calculation loader must use the same flask');
assert((files.page.match(/data-molarium-foam/g) || []).length === 3,
  'the header, blank canvas, and calculation loader must all contain foam');

console.log('Molarium logo geometry: 3/3 sources consistent · flask + foam + blended M');
