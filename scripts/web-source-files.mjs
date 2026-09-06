import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserModuleClosure, sos1ReleaseWebFiles } from './web-bundle-dependencies.mjs';

// The production builder remains the single declaration, including the existing
// publication-promotion writer. Read only its strict literal array; never execute
// the builder or interpret arbitrary source expressions to choose served files.
export async function sourceWebFiles(root) {
  const source = await readFile(join(root,'scripts/build-web.mjs'),'utf8');
  const match = source.match(/^const files = \[([\s\S]*?)^\];/m);
  if (!match) throw new Error('Missing explicit production file declaration');
  const body = match[1].replace(/\/\/[^\n]*/g,'');
  const paths = [...body.matchAll(/'([^'\n]+)'/g)].map(entry=>entry[1]);
  if (!paths.length || body.replace(/'[^'\n]+'/g,'').replace(/[\s,]/g,''))
    throw new Error('Production file declaration must contain only literal paths');
  if (paths.some(path=>path.startsWith('/') || path.includes('\\')
      || path.split('/').some(part=>part.startsWith('.'))))
    throw new Error('Production file declaration must contain safe relative public paths');
  return browserModuleClosure(root,[...paths,...await sos1ReleaseWebFiles(root)]);
}
