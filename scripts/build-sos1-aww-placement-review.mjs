#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadA010GraphCheckpoint } from './sos1-aww-graph-checkpoint.mjs';
import { pdbFromInspectionAtoms } from './build-sos1-aww-factorial-review.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [outputArg, ...attemptArgs] = process.argv.slice(2);
assert(outputArg && attemptArgs.length,
  'Usage: node scripts/build-sos1-aww-placement-review.mjs <new-output> <attempt-directory> ...');
const output = resolve(outputArg);
const source = await loadA010GraphCheckpoint(join(resolve(attemptArgs[0]), 'aww-graph-only-campaign.json'));
const base = source.molecule.atoms.map((atom) => ({ ...atom,
  atomId:atom.designAtomId, coordinatesAngstrom:[atom.x, atom.y, atom.z] }));
const ligand = (atoms) => atoms.filter((atom) => atom.residueName === 'AWW' && atom.element !== 'H');
const phe = base.filter((atom) => atom.residueName === 'PHE' && atom.residueIndex === 890
  && atom.chain === 'A' && atom.element !== 'H');
const color = ['#268a73','#487db8','#cc8832','#9962b5','#b54858','#247f87'];
const sphere = (atoms) => {
  const center = [0,1,2].map((axis) => atoms.reduce((sum, atom) =>
    sum + atom.coordinatesAngstrom[axis], 0) / atoms.length);
  return { center, radius:Math.max(...atoms.map((atom) => Math.hypot(
    ...atom.coordinatesAngstrom.map((v, axis) => v - center[axis])))) };
};
const ligands = [{ id:'inherited', label:'Inherited graph placement', compound:'Inherited AWW',
  pdbId:'5OVE-only', sourceLabel:'a010 exact graph checkpoint', color:'#718296',
  badge:'source', defaultVisible:false, metricDisplay:'Before intent',
  designPoint:'Unmodified graph edit before the designer-directed rotation.',
  ligandPdb:pdbFromInspectionAtoms(ligand(base)), focusPdb:pdbFromInspectionAtoms(phe, { proteinRecords:true }),
  source:{ url:relative(output, join(resolve(attemptArgs[0]), 'aww-graph-only-campaign.json')),
    sha256:source.sha256 } }];
const records = [];
for (const [index, attemptArg] of attemptArgs.entries()) {
  const attempt = resolve(attemptArg);
  const summary = JSON.parse(await readFile(join(attempt, 'summary.json')));
  assert.equal(summary.sourceSha256, source.sha256);
  const candidateBytes = await readFile(join(attempt, 'placement-candidates.jsonl'));
  assert.equal(createHash('sha256').update(candidateBytes).digest('hex'), summary.candidateFile.sha256);
  const candidateLines = candidateBytes.toString().trim().split('\n');
  assert.equal(candidateLines.length, summary.candidateCount);
  let selected;
  if (summary.status.startsWith('placement-passed')) {
    const result = JSON.parse(await readFile(join(attempt, 'selected-placement.json')));
    selected = { ...result.selected, coordinates:result.selectedCoordinates, eligible:true };
  } else {
    const candidates = candidateLines.map(JSON.parse);
    candidates.sort((a, b) => Number(b.directionalGatePassed) - Number(a.directionalGatePassed)
      || a.contacts.outsideAllowedResponseContactCount - b.contacts.outsideAllowedResponseContactCount
      || a.contactGeometry.donorAcceptorDistanceAngstrom - b.contactGeometry.donorAcceptorDistanceAngstrom);
    selected = candidates[0];
  }
  const atoms = structuredClone(base);
  for (const coordinate of selected.coordinates)
    atoms[coordinate.atomIndex].coordinatesAngstrom = coordinate.coordinatesAngstrom;
  const id = `direction-${summary.designerPrimaryRotationDegrees}`;
  const geometry = selected.contactGeometry;
  records.push({ id, attempt:relative(root, attempt), summary, selected });
  ligands.push({ id, label:`+${summary.designerPrimaryRotationDegrees}° · ${selected.eligible ? 'passes placement' : 'rejected'}`,
    compound:`+${summary.designerPrimaryRotationDegrees}°`, pdbId:'5OVE-only', color:color[index % color.length],
    sourceLabel:`Declared +${summary.designerPrimaryRotationDegrees}° direction`, badge:selected.eligible ? 'review' : 'rejected',
    defaultVisible:index === attemptArgs.length - 1,
    metricDisplay:`${geometry.donorAcceptorDistanceAngstrom.toFixed(2)} Å / ${geometry.dhaAngleDegrees.toFixed(1)}°`,
    designPoint:`Fixed-atom severe contacts: ${selected.contacts.outsideAllowedResponseContactCount}; movable contacts: ${selected.contacts.allowedResponseContactCount}. ${selected.eligible ? 'Placement only; receptor response uncomputed.' : 'Diagnostic coordinates; ineligible for receptor prediction.'}`,
    ligandPdb:pdbFromInspectionAtoms(ligand(atoms)), focusPdb:pdbFromInspectionAtoms(phe, { proteinRecords:true }),
    source:{ url:`../${relative(dirname(output), join(attempt, 'summary.json'))}`, sha256:summary.candidateFile.sha256 } });
}
const pocketResidues = new Set([879,884,890,901]);
const pocket = base.filter((atom) => atom.record === 'ATOM' && atom.element !== 'H'
  && pocketResidues.has(atom.residueIndex));
const data = { schema:'molarium.structure-overlay-review/v1', title:'AWW declared-direction placement review',
  subtitle:'Exact saved branch coordinates in the unchanged starting pocket',
  boundary:'Designer intent was inferred from the reported series. Coordinates are generated from the current checkpoint. These placement diagnostics precede receptor prediction.',
  labels:{ ligandHeading:'Declared branch rotations', firstOnlyButton:'Inherited graph only',
    focusButton:'Focus Phe890', protein:'Starting receptor cartoon', pocket:'ASN879 / TYR884 / PHE890 / LEU901',
    focusSnapshots:'Phe890 in the starting receptor', focusSnapshotsDefaultVisible:false,
    alignmentHeading:'Placement gates', alignmentNote:'All views share one coordinate frame. CB and backbone remain fixed. Contact metrics are donor–acceptor distance and D–H–A angle.',
    metricHeading:'Contact', statusPill:'Placement review', statusTone:'reject' },
  sources:{ primaryLiterature:'Current-scene designer intent; no later-coordinate input', viewer:'Mol* 5.11.0' },
  receptor:{ pdbId:'5OVE-only', proteinPdb:pdbFromInspectionAtoms(base.filter((atom) =>
    atom.record === 'ATOM'), { proteinRecords:true }), pocketPdb:pdbFromInspectionAtoms(pocket, { proteinRecords:true }),
    pocket:{ cutoffAngstrom:5 }, focusResidues:[879,884,890,901] },
  overlaySphere:sphere([...ligand(base), ...phe]), switchSphere:sphere([...phe,
    ...base.filter((atom) => atom.residueName === 'TYR' && atom.residueIndex === 884)]), ligands };
await mkdir(output);
await mkdir(join(output, 'vendor'));
// Local Lab permits scripts from the same origin, but not inline script text.
// Preserve the native viewer code verbatim in a separate served asset.
const viewerHtml = await readFile(join(root, 'design-history/structure-review/index.html'), 'utf8');
const inlineViewer = viewerHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(inlineViewer, 'Native review template has no viewer script');
const localLabHtml = viewerHtml.replace(inlineViewer[0], '<script src="./review.js"></script>');
await Promise.all([
  writeFile(join(output, 'index.html'), localLabHtml, { flag:'wx' }),
  writeFile(join(output, 'review.js'), inlineViewer[1], { flag:'wx' }),
  ...['molstar-5.11.0.js','molstar-5.11.0.css'].map((name) => copyFile(
    join(root, 'docking/validation/pose-viewer/vendor', name), join(output, 'vendor', name))),
  copyFile(join(root, 'docking/validation/pose-viewer/MOLSTAR-LICENSE.txt'), join(output, 'MOLSTAR-LICENSE.txt')),
  writeFile(join(output, 'data.json'), `${JSON.stringify(data)}\n`, { flag:'wx' }),
  writeFile(join(output, 'review-provenance.json'), `${JSON.stringify(records, null, 2)}\n`, { flag:'wx' }),
]);
console.log(output);
