// Validate portable review exports against the original scored coordinates and
// the exact graph/experimental state, including Foldarium's display alignment.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateLibrary} from '../../vendor/foldarium/library-format.js';
import {alignComplexPdb} from '../../vendor/foldarium/library-alignment.js';
import {ligandMol} from '../../vendor/foldarium/library-chemistry.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function checkStockReview({review,exports,plan:planPath,repository,components,attribution}) {
  const scoresRaw=await readFile(join(review,'scores.json')),scores=JSON.parse(scoresRaw);
  const manifest=JSON.parse(await readFile(join(exports,'manifest.json')));
  const planRaw=await readFile(planPath),plan=JSON.parse(planRaw);
  assert.equal(manifest.sourceScoresSha256,sha(scoresRaw));
  assert.equal(scores.planSha256,sha(planRaw));
  assert.equal(manifest.newNeuralForwards,0);assert.equal(manifest.copiedDecisions,0);
  if(manifest.datasetAttributionSha256) {
    assert.ok(attribution,'Provide the original dataset attribution file');
    const raw=await readFile(attribution);assert.equal(sha(raw),manifest.datasetAttributionSha256);
    assert.deepEqual(JSON.parse(raw),manifest.datasetAttribution);
  }
  assert.ok(manifest.caseIds.length>0);assert.equal(new Set(manifest.caseIds).size,manifest.caseIds.length);
  assert.equal(manifest.libraries.length,manifest.caseIds.length*2);
  let predictions=0,references=0,maxAlignmentDifference=0;
  const seen=new Set(),uniquePredictions=new Set();
  for(const entry of manifest.libraries) {
    assert.ok(manifest.caseIds.includes(entry.caseId));
    assert.equal(basename(entry.file),entry.file);assert.match(entry.file,/^[-a-z0-9_.]+\.library\.json$/);
    const key=JSON.stringify([entry.caseId,entry.referenceIncluded]);assert.ok(!seen.has(key));seen.add(key);
    const bytes=await readFile(join(exports,entry.file));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
    const library=validateLibrary(JSON.parse(bytes));assert.deepEqual(library.decisions,[]);
    const pair=plan.pairs.find(p=>p.caseId===entry.caseId);assert.ok(pair);
    const referenceBytes=await readFile(resolve(repository,pair.referenceFile));
    assert.equal(sha(referenceBytes),pair.referenceSha256);const reference=JSON.parse(referenceBytes);
    const componentBytes=await readFile(join(components,entry.caseId+'.json')),component=JSON.parse(componentBytes);
    const rows=scores.poses.filter(p=>p.caseId===entry.caseId&&p.seed<manifest.samplesPerCase);
    assert.equal(rows.length,manifest.samplesPerCase);
    assert.equal(library.run.compounds.length,1);assert.equal(library.run.compounds[0].id,entry.caseId);
    assert.equal(library.run.provenance.sourceScoresSha256,sha(scoresRaw));
    assert.equal(library.run.provenance.sourcePlanSha256,sha(planRaw));
    assert.equal(library.run.provenance.sourceEvidenceSha256,manifest.sourceEvidenceSha256);
    assert.equal(library.run.provenance.referenceIncluded,entry.referenceIncluded);
    if(manifest.datasetAttributionSha256) {
      assert.equal(library.run.provenance.datasetAttributionSha256,manifest.datasetAttributionSha256);
      assert.deepEqual(library.run.provenance.datasetAttribution,manifest.datasetAttribution);
    }
    assert.equal(library.poses.length,rows.length+Number(entry.referenceIncluded));
    const refs=library.poses.filter(p=>p.role==='experimental-reference');
    assert.equal(refs.length,Number(entry.referenceIncluded));
    if(refs.length) {
      const ref=refs[0];assert.equal(library.poses[0].id,ref.id);assert.equal(ref.result.pdb,reference.result.pdb);
      assert.deepEqual(ref.result.component,reference.result.component);assert.equal(ref.result.kind,'experimental');
      assert.equal(ref.result.iptm,null);assert.equal(ref.result.elapsedMs,null);
      assert.equal(ref.result.provenance.outputPdbSha256,sha(Buffer.from(ref.result.pdb)));references++;
      ligandMol(ref.result,ref.result.pdb);
    }
    for(const row of rows) {
      const pose=library.poses.find(p=>p.role==='prediction'&&p.seed===row.seed);assert.ok(pose);
      assert.equal(pose.status,row.status);assert.equal(pose.sample,row.seed+Number(entry.referenceIncluded));
      if(row.status!=='complete')continue;
      assert.equal(pose.result.kind,'prediction');assert.equal(pose.result.elapsedMs,null);
      assert.equal(sha(Buffer.from(pose.result.pdb)),row.outputPdbSha256);
      assert.equal(pose.result.provenance.outputPdbSha256,row.outputPdbSha256);
      assert.equal(pose.result.provenance.sourceReceiptSha256,row.receiptSha256);
      assert.equal(pose.result.provenance.sourceComponentSha256,sha(componentBytes));
      assert.deepEqual(pose.result.component,component);
      assert.equal(pose.result.iptm,row.confidence.iptm??null);assert.equal(pose.result.ptm,row.confidence.ptm??null);
      for(const key of ['ligandRmsdA','within2A','limitedValidityPass','diagnosticCategory'])assert.ok(!(key in pose.result));
      assert.ok(Number.isFinite(pose.result.provenance.recordedLauncherElapsedSeconds));
      const aligned=alignComplexPdb(pose.result.pdb,reference.result.pdb);
      const difference=Math.abs(aligned.rmsd-row.proteinCaRmsdA);maxAlignmentDifference=Math.max(difference,maxAlignmentDifference);
      assert.ok(difference<1e-6,`Display alignment differs from the scientific protein frame: ${entry.caseId} / ${row.seed}: ${difference}`);
      assert.equal(aligned.atoms,row.alignedCa);
      const mol=ligandMol(pose.result,aligned.pdb);assert.ok(mol.endsWith('$$$$'));
      const counts=mol.split('\n')[3];assert.equal(Number(counts.slice(0,3)),component.atoms.length);
      assert.equal(Number(counts.slice(3,6)),component.bonds.length);predictions++;
      uniquePredictions.add(JSON.stringify([entry.caseId,row.seed]));
    }
  }
  return {status:'pass',cases:manifest.caseIds.length,libraries:manifest.libraries.length,
    predictionRecords:predictions,uniquePredictions:uniquePredictions.size,experimentalReferences:references,maximumProteinAlignmentDifferenceA:maxAlignmentDifference,
    newNeuralForwards:0,copiedDecisions:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const options={};
  for(let i=2;i<process.argv.length;i+=2) {
    const name=process.argv[i];if(!['--review','--exports','--plan','--repository','--components','--attribution'].includes(name))throw Error('Unknown argument '+name);
    options[name.slice(2)]=resolve(process.argv[i+1]);
  }
  if(['review','exports','plan','repository','components'].some(k=>!options[k]))throw Error('Provide --review, --exports, --plan, --repository and --components');
  console.log(JSON.stringify(await checkStockReview(options)));
}
