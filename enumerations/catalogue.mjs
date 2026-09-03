import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnumerationPlan } from './action-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function planSha256(entry) {
  return createHash('sha256').update(canonicalJson(entry.operations)).digest('hex');
}

export function validateEnumerationCatalogue(catalogue) {
  assert.equal(catalogue.schemaVersion, 1);
  assert.match(catalogue.catalogueId, /^molarium-/);
  assert.equal(catalogue.reference?.pdbId, '7KPA');
  assert.equal(catalogue.reference?.componentId, 'D84');
  assert.ok(Array.isArray(catalogue.transformations) && catalogue.transformations.length >= 3);
  assert.equal(new Set(catalogue.transformations.map((entry) => entry.id)).size,
    catalogue.transformations.length, 'transformation IDs must be unique');
  for (const entry of catalogue.transformations) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(entry.name && entry.family && entry.hypothesis);
    assert.match(entry.expectedProductGraphSha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(entry.requiredContactKeys));
    assert.ok(Array.isArray(entry.risks) && entry.risks.length);
    validateEnumerationPlan(entry);
  }
  return catalogue;
}

export async function readEnumerationCatalogue() {
  const bytes = await readFile(path.join(here, 'catalogue.v0.1.json'));
  return { bytes, catalogue:validateEnumerationCatalogue(JSON.parse(bytes)) };
}
