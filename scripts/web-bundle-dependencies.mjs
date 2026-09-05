import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export async function browserModuleClosure(root, initialFiles) {
  const files = new Set(initialFiles), queue = initialFiles.filter((path) =>
    /\.(?:mjs|js)$/.test(path) && !path.startsWith('scripts/'));
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const path = queue[cursor], source = await readFile(resolve(root, path), 'utf8');
    const dependencies = [
      ...source.matchAll(/\bfrom\s*['"](\.[^'"\n]+)['"]/g),
      ...source.matchAll(/\bimport\s*(?:\(\s*)?['"](\.[^'"\n]+)['"]/g),
      ...source.matchAll(/new\s+URL\(\s*['"](\.[^'"\n]+\.(?:mjs|js))['"]\s*,\s*import\.meta\.url/g),
    ];
    for (const match of dependencies) {
      const dependency = relative(root, resolve(root, dirname(path), match[1]));
      assert(dependency && dependency !== '..' && !dependency.startsWith('../'),
        `Browser dependency escapes repository: ${path} -> ${match[1]}`);
      if (files.has(dependency)) continue;
      await readFile(resolve(root, dependency)); // fail at build time if missing
      files.add(dependency);
      if (/\.(?:mjs|js)$/.test(dependency)) queue.push(dependency);
    }
  }
  return [...files];
}

export async function sos1ReleaseWebFiles(root) {
  const prefix = 'design-history/publications/sos1/designer-intent-2026-09-04';
  const declaration = `${prefix}/release.json`;
  let release;
  try { release = JSON.parse(await readFile(resolve(root, declaration), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const paths = new Set([declaration, 'sos1.html']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string') {
      assert(value.path.startsWith(`${prefix}/`) && !value.path.split('/').includes('..'));
      paths.add(value.path);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(release);
  const popupDeclaration = `${prefix}/checkpoint-popups-v1/movie.json`;
  try {
    const popupMovie = JSON.parse(await readFile(resolve(root, popupDeclaration), 'utf8'));
    paths.add(popupDeclaration); visit(popupMovie);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return [...paths];
}
