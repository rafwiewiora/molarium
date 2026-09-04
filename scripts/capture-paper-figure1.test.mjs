import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { figure1ActionPlan, verifyBq5Inspection,
  verifyVisibleBq5Depiction } from './capture-paper-figure1.mjs';
import { verifyLocalLabCaptureState } from './local-lab-capture.mjs';

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

const atoms = Array.from({ length:16 }, (_, index) => ({
  atomId:`bq5-${index}`, element:index < 3 ? 'N' : 'C', formalCharge:0,
  aromatic:index < 11, atomName:`A${index}`, residueName:'BQ5', chain:'S', residueIndex:1101,
}));
const bonds = Array.from({ length:15 }, (_, index) => ({
  atomIds:[`bq5-${index}`, `bq5-${index + 1}`], order:index < 6 ? 1.5 : 1,
  aromatic:index < 6,
}));
bonds.push(
  { atomIds:['bq5-0', 'bq5-5'], order:1.5, aromatic:true },
  { atomIds:['bq5-6', 'bq5-10'], order:1.5, aromatic:true },
  { atomIds:['bq5-10', 'bq5-15'], order:1, aromatic:false },
);
const ligand = verifyBq5Inspection({ scope:'ligand', truncated:false, atoms, bonds });
assert.equal(ligand.heavyAtomCount, 16);
assert.equal(ligand.heavyBondCount, 18);
assert.match(ligand.graphSha256, /^[a-f0-9]{64}$/);

assert.throws(() => verifyBq5Inspection({ scope:'ligand', truncated:false,
  atoms:atoms.map((atom, index) => index ? atom : { ...atom, residueName:'GLY' }), bonds }),
/not exclusively BQ5/);
assert.throws(() => verifyBq5Inspection({ scope:'ligand', truncated:false,
  atoms, bonds:bonds.map((bond) => ({ ...bond, order:1, aromatic:false })) }),
/CCD aromatic\/multiple-bond chemistry/);

const svg = '<svg>' + atoms.map((_, index) =>
  `<path class="atom-${index}"/>`).join('') + bonds.map((_, index) =>
  `<path class="bond-${index}"/>`).join('') + '</svg>';
assert.deepEqual(verifyVisibleBq5Depiction({ visible:true, label:'BQ5 ligand', pending:false,
  error:null, hasSvg:true, atomIndices:atoms.map((_, index) => index),
  bondIndices:bonds.map((_, index) => index), svg, svgLength:svg.length }, ligand), {
  label:'BQ5 ligand', heavyAtomCount:16, heavyBondCount:18,
  svgSha256:verifyVisibleBq5Depiction({ visible:true, label:'BQ5 ligand', pending:false,
    error:null, hasSvg:true, atomIndices:atoms.map((_, index) => index),
    bondIndices:bonds.map((_, index) => index), svg, svgLength:svg.length }, ligand).svgSha256,
});
assert.throws(() => verifyVisibleBq5Depiction({ visible:true, label:'6EPM complex',
  pending:false, error:null, hasSvg:true,
  atomIndices:Array.from({ length:200 }, (_, index) => index),
  bondIndices:bonds.map((_, index) => index), svg, svgLength:svg.length }, ligand),
/not labelled as BQ5/);

const plan = figure1ActionPlan('HEADER 6EPM');
assert.deepEqual(plan.map((request) => request.action), [
  'session.loadStructure', 'protein.prepare', 'view.setMode', 'view.setDisplay',
  'view.setComponentVisibility', 'view.focusComponent', 'session.inspect',
]);
assert.equal(plan[0].args.content, 'HEADER 6EPM');
assert.equal(plan[1].args.ligandPolicy, 'ccd');
assert.equal(plan[4].args.ordinal, 0);
assert.equal(plan[5].args.ordinal, 1);
assert.equal(plan[6].args.scope, 'ligand');

const source = await readFile(new URL('./capture-paper-figure1.mjs', import.meta.url), 'utf8');
assert(!source.includes('window.molariumTest'), 'Figure 1 capture must not use test-only state');
assert(!source.includes('loadMolecule('), 'Figure 1 capture must not mutate the viewer directly');
assert.match(source, /window\.MolariumChemistActions\.execute/);
assert.match(source, /verifyBq5Inspection\(inspection\)/);
assert.match(source, /verifyVisibleBq5Depiction\(await readVisibleDepiction/);
assert.match(source, /verifyBrowserLocalLabCapture\(browser\)/);
assert.match(source, /localOnly:true/);
assert.doesNotMatch(source, /localOnly:false/);
assert.match(source, /promoteCompletedRender\(\{ stagingDirectory/);
assert.match(source, /complete:true/);

console.log('Figure 1 deterministic public-action capture checks passed');
