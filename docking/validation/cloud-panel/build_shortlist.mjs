#!/usr/bin/env node
/** Select unique feasible poses plus one best infeasible control per analogue. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [sourceName, outputName] = process.argv.slice(2);
if (!sourceName || !outputName)
  throw new Error('Usage: build_shortlist.mjs PANEL.json SHORTLIST.json');
const sourceBytes = await readFile(sourceName);
const source = JSON.parse(sourceBytes);
if (source.schema !== 'molarium.analogue-pose-panel/v1' || !Array.isArray(source.poses))
  throw new Error('Unsupported analogue pose panel schema');

const groups = new Map();
for (const pose of source.poses) {
  if (!pose?.id || !pose?.caseId || !pose?.integrity?.coordinatesSha256)
    throw new Error('Every pose must have an ID, case ID, and coordinate hash');
  if (!groups.has(pose.caseId)) groups.set(pose.caseId, []);
  groups.get(pose.caseId).push(pose);
}

const selected = [];
const cases = [];
for (const [caseId, poses] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
  const uniqueByCoordinates = new Map();
  for (const pose of poses.sort((left, right) => left.id.localeCompare(right.id))) {
    if (!uniqueByCoordinates.has(pose.integrity.coordinatesSha256))
      uniqueByCoordinates.set(pose.integrity.coordinatesSha256, pose);
  }
  const unique = [...uniqueByCoordinates.values()];
  const feasible = unique.filter((pose) => pose.analogue?.feasible === true);
  let retained, rule;
  if (feasible.length) {
    retained = feasible;
    rule = 'all-unique-feasible';
  } else {
    const ranked = unique.filter((pose) => Number.isFinite(pose.analogue?.scoreKcalMol))
      .sort((left, right) => left.analogue.scoreKcalMol - right.analogue.scoreKcalMol
        || left.id.localeCompare(right.id));
    retained = ranked.slice(0, 1);
    rule = 'best-unique-infeasible-control';
  }
  selected.push(...retained);
  cases.push({ caseId, inputPoses:poses.length, uniquePoses:unique.length,
    selectedPoses:retained.length, rule });
}

const shortlist = { ...source,
  protocol:{ ...(source.protocol || {}), shortlist:{
    rule:'deduplicate exact coordinate hashes; retain every unique feasible pose, otherwise the lowest browser-score infeasible control',
    sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'), cases } },
  poses:selected };
await writeFile(outputName, `${JSON.stringify(shortlist, null, 2)}\n`);
console.log(`wrote ${outputName} (${selected.length}/${source.poses.length} poses)`);
