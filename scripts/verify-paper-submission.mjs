import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const submissionPath = 'paper/submissions/chemrxiv-v1-2026-09-08';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => createHash('sha256').update(data).digest('hex');

export async function verifyEntries(base, entries) {
  const seen = new Set();
  for (const entry of entries) {
    assert(typeof entry.path === 'string' && !isAbsolute(entry.path), 'Expected repository-relative path');
    const path = resolve(base, entry.path);
    const rel = relative(base, path);
    assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Path escapes repository');
    assert(!seen.has(rel), `Duplicate artifact: ${rel}`);
    seen.add(rel);
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `Invalid SHA-256: ${rel}`);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes > 0, `Invalid size: ${rel}`);
    const bytes = await readFile(path);
    assert.equal(bytes.length, entry.bytes, `Size mismatch: ${rel}`);
    assert.equal(hash(bytes), entry.sha256, `Hash mismatch: ${rel}`);
  }
  return entries.length;
}

export async function verifySubmission(base = root) {
  const json = async path => JSON.parse(await readFile(resolve(base, path), 'utf8'));
  const metadata = await json(`${submissionPath}/submission.json`);
  assert.equal(metadata.schema, 'molarium.paper-submission/v1');
  assert.equal(metadata.pdf.sha256, 'caa49f6fa273387ce52d0f51e15bbfc6ad23518e25350e49b004cb1259740cad');
  assert.equal(metadata.source.sha256, '6964b04e39738a985e521bd8dc05bd0fff4bfad1abe715be47593b2382f80804');
  assert.equal(metadata.exactSubmittedLatexAvailable, true);
  assert.equal(metadata.frozenScienceChanged, false);
  await verifyEntries(base, [metadata.pdf, metadata.source, ...metadata.sourceAssets]);
  const tex = await readFile(resolve(base, metadata.source.path), 'utf8');
  const graphics = [...tex.matchAll(/\\safeincludegraphics\[[^\]]*\]\{([^}]+)\}/g)].map(m => m[1]);
  assert.equal(graphics.length, 6);
  assert.deepEqual(metadata.sourceAssets.map(e => e.path), graphics.map(p => `${submissionPath}/${p}`));
  const figures = await json(metadata.figureVerification);
  assert.equal(figures.pdfSha256, metadata.pdf.sha256);
  assert.equal(figures.sourceSha256, metadata.source.sha256);
  assert.equal(figures.allSixFiguresMatch, true);
  assert.equal(figures.figures.length, 6);
  figures.figures.forEach((f, i) => {
    assert.equal(f.source, graphics[i]);
    assert.equal(f.sourceFileSha256, metadata.sourceAssets[i].sha256);
    assert.equal(f.exactPixelMatch, true);
  });
  const archive = await json(metadata.archive);
  assert.equal(archive.submittedPdfSha256, metadata.pdf.sha256);
  const count = await verifyEntries(base, archive.files);
  const html = await readFile(resolve(base, 'sos1.html'), 'utf8');
  assert(html.includes(`href="/${metadata.pdf.path}"`));
  assert(html.includes('ChemRxiv-submitted v1'));
  for (const file of ['scripts/build-web.mjs', 'scripts/generate-local-lab-manifest.mjs']) {
    const source = await readFile(resolve(base, file), 'utf8');
    assert(source.includes(`'${metadata.pdf.path}'`), `${file} omits submitted PDF`);
    assert(source.includes(`'${submissionPath}/submission.json'`), `${file} omits metadata`);
  }
  return { submittedPdf: metadata.pdf.sha256, finalSource: metadata.source.sha256, figures: 6, archivedOriginals: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifySubmission(), null, 2));
}
