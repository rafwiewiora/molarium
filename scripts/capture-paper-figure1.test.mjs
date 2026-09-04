import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { figure1ActionPlan, verifyBq5Inspection,
  verifyVisibleBq5Depiction } from './capture-paper-figure1.mjs';
import { verifyLocalLabCaptureState } from './local-lab-capture.mjs';
import { serializeRegisteredLigandDefinition } from
  '../design-history/structures/registered-ligand-graph.mjs';

const localLab = verifyLocalLabCaptureState({
  responsePolicy:'local-only-v1',
  contentSecurityPolicy:"default-src 'self'; connect-src 'self'; object-src 'none'",
  runtimeMode:'local-lab', runtimeLocalOnly:true, runtimePolicy:'local-only-v1',
  allowedNetworkOrigins:['http://127.0.0.1:50001'], documentMode:'local-lab',
  badgeMode:'local-lab', badgeLocalLab:true,
  badgeText:'Local Lab · network locked', foldDisabled:true,
  msaEndpointDisabled:true, ccdRetrievalDisabled:true,
}, 'http://127.0.0.1:50001');
assert.equal(localLab.verified, true);
assert.throws(() => verifyLocalLabCaptureState({ ...localLab,
  responsePolicy:'connected-v1' }, 'http://127.0.0.1:50001'), /not enforcing/);
assert.throws(() => verifyLocalLabCaptureState({ ...localLab,
  badgeText:'Local Lab · network locked', foldDisabled:false },
  'http://127.0.0.1:50001'), /fold control enabled/);

const bq5Definition = JSON.parse(await readFile(new URL(
  '../design-history/structures/ligands/bq5-rcsb-ccd.json', import.meta.url), 'utf8'));
const atoms = bq5Definition.atoms.map((atom, index) => ({
  atomId:`bq5-${index}`, element:atom.element, formalCharge:atom.formalCharge,
  aromatic:atom.aromatic, atomName:atom.id, residueName:'BQ5', chain:'S', residueIndex:1101,
}));
const atomIdByName = new Map(atoms.map((atom) => [atom.atomName, atom.atomId]));
const bonds = bq5Definition.bonds.map((bond) => ({
  atomIds:[atomIdByName.get(bond.a), atomIdByName.get(bond.b)],
  order:bond.order, aromatic:bond.aromatic,
}));
const ligand = verifyBq5Inspection({ scope:'ligand', truncated:false, atoms, bonds },
  bq5Definition);
assert.equal(ligand.heavyAtomCount, 16);
assert.equal(ligand.heavyBondCount, 18);
assert.equal(ligand.graphSha256, bq5Definition.graphSha256);

assert.throws(() => verifyBq5Inspection({ scope:'ligand', truncated:false,
  atoms:atoms.map((atom, index) => index ? atom : { ...atom, residueName:'GLY' }), bonds },
  bq5Definition),
/not exclusively BQ5/);
assert.throws(() => verifyBq5Inspection({ scope:'ligand', truncated:false,
  atoms, bonds:bonds.map((bond) => ({ ...bond, order:1, aromatic:false })) }, bq5Definition),
/CCD aromatic\/multiple-bond chemistry/);
assert.throws(() => verifyBq5Inspection({ scope:'ligand', truncated:false,
  atoms, bonds:bonds.map((bond, index) => index === 6 ? { ...bond, order:2 } : bond) },
  bq5Definition), /does not equal the pinned registered graph/,
'same-size but chemically different inspected graphs must fail closed');

const depictionAtomIndices = Array.from({ length:ligand.heavyAtomCount }, (_, index) => index);
const depictionBondIndices = Array.from({ length:ligand.heavyBondCount }, (_, index) => index);
const svg = '<svg>' + depictionAtomIndices.map((index) =>
  `<path class="atom-${index}"/>`).join('') + depictionBondIndices.map((index) =>
  `<path class="bond-${index}"/>`).join('') + '</svg>';
assert.deepEqual(verifyVisibleBq5Depiction({ visible:true, label:'BQ5 ligand', pending:false,
  error:null, hasSvg:true, atomIndices:depictionAtomIndices,
  bondIndices:depictionBondIndices, svg, svgLength:svg.length }, ligand), {
  label:'BQ5 ligand', heavyAtomCount:16, heavyBondCount:18,
  svgSha256:verifyVisibleBq5Depiction({ visible:true, label:'BQ5 ligand', pending:false,
    error:null, hasSvg:true, atomIndices:depictionAtomIndices,
    bondIndices:depictionBondIndices, svg, svgLength:svg.length }, ligand).svgSha256,
});
assert.throws(() => verifyVisibleBq5Depiction({ visible:true, label:'6EPM complex',
  pending:false, error:null, hasSvg:true,
  atomIndices:Array.from({ length:200 }, (_, index) => index),
  bondIndices:depictionBondIndices, svg, svgLength:svg.length }, ligand),
/not labelled as BQ5/);

assert.equal(createHash('sha256').update(serializeRegisteredLigandDefinition(
  bq5Definition)).digest('hex'), bq5Definition.graphSha256);
assert.equal(bq5Definition.source.contentSha256,
  '82cba5e4347e1afaa92e99065e1efcfb4854b7d30d4654fc7e340b9a9e1e71a9');
const plan = figure1ActionPlan('HEADER 6EPM', bq5Definition);
assert.deepEqual(plan.map((request) => request.action), [
  'session.loadStructure', 'ligand.installRegisteredGraph', 'protein.prepare',
  'view.setMode', 'view.setDisplay', 'view.focusComponent', 'session.inspect',
]);
assert.equal(plan[0].args.content, 'HEADER 6EPM');
assert.equal(plan[1].args.graphSha256, bq5Definition.graphSha256);
assert.deepEqual(plan[1].args.locator,
  { residueName:'BQ5', chain:'S', residueIndex:1101, insertionCode:'' });
assert.equal(plan[2].args.ligandPolicy, 'registered');
assert.equal(plan[5].args.ordinal, 0);
assert.equal(plan[6].args.scope, 'ligand');

const source = await readFile(new URL('./capture-paper-figure1.mjs', import.meta.url), 'utf8');
assert(!source.includes('window.molariumTest'), 'Figure 1 capture must not use test-only state');
assert(!source.includes('loadMolecule('), 'Figure 1 capture must not mutate the viewer directly');
assert.match(source, /window\.MolariumChemistActions\.execute/);
assert.match(source, /verifyBq5Inspection\(inspection, bq5Definition\)/);
assert.match(source, /verifyVisibleBq5Depiction\(await readVisibleDepiction/);
assert.match(source, /verifyBrowserLocalLabCapture\(browser\)/);
assert.match(source, /localOnly:true/);
assert.doesNotMatch(source, /localOnly:false/);
assert.doesNotMatch(source, /selection\.replace/);
assert.match(source, /exact reviewed public-action sequence/);
assert.match(source, /fig1_molarium_interface\.capture-manifest\.json/);
assert.match(source, /fig1_molarium_interface\.chemist-action-audit\.json/);
assert.match(source, /promoteCompletedRender\(\{ stagingDirectory/);
assert.match(source, /complete:true/);

const [appSource, apiSource, webBuildSource, manifestSource] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../chemist-actions.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./build-web.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./generate-local-lab-manifest.mjs', import.meta.url), 'utf8'),
]);
assert.match(apiSource, /'ligand\.installRegisteredGraph'/);
assert.match(appSource, /'ligand\.installRegisteredGraph':async/);
assert.match(appSource, /prepare-ligands-from-registered-graph/);
for (const bundler of [webBuildSource, manifestSource])
  assert.match(bundler, /design-history\/structures\/ligands\/bq5-rcsb-ccd\.json/,
    'The pinned BQ5 graph must be part of every reviewed production bundle');

console.log('Figure 1 deterministic public-action capture checks passed');
