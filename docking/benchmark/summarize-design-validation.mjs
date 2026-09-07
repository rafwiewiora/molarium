import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const [inputArg,outputArg]=process.argv.slice(2);
assert(inputArg&&outputArg,'Usage: node summarize-design-validation.mjs INPUT OUTPUT');
const input=resolve(inputArg),output=resolve(outputArg);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const protocolBytes=await readFile(join(input,'protocol.json'));
const protocol=JSON.parse(protocolBytes);
assert.equal(protocol.schema,'molarium.design-function-validation/v1');
assert.equal(new Set(protocol.panel.map(x=>x.id)).size,protocol.panel.length);
assert(protocol.panel.length>0,'Empty panels cannot pass');
await mkdir(output,{recursive:true});
const livePass=c=>c.measurable===true&&c.available===true
  &&[c.donorAcceptorAngstrom,c.hydrogenAcceptorAngstrom,c.dhaDegrees].every(Number.isFinite)
  &&c.donorAcceptorAngstrom>=2.4&&c.donorAcceptorAngstrom<=3.5
  &&c.hydrogenAcceptorAngstrom>=1.2&&c.hydrogenAcceptorAngstrom<=2.7&&c.dhaDegrees>=120;
const contacts=rows=>(rows||[]).map(c=>({...c,liveGeometryPass:livePass(c),
  cachedDistanceDeltaAngstrom:c.cachedHydrogenAcceptorAngstrom==null?null:
    c.hydrogenAcceptorAngstrom-c.cachedHydrogenAcceptorAngstrom}));
const summary={schema:'molarium.design-function-validation-summary/v1',sourceCommit:protocol.sourceCommit,
  protocolSha256:hash(protocolBytes),runnerSha256:protocol.runnerSha256,
  hardware:'Apple M1 Pro; local macOS Chrome; single-device functional tests, no speed-comparison claim',
  interpretation:protocol.interpretation,results:[]};
for(const spec of protocol.panel) {
  const bytes=await readFile(join(input,spec.id+'.json')),r=JSON.parse(bytes),s=r.stages;
  assert.equal(r.id,spec.id);assert.equal(r.status,'completed-observations',`${spec.id} did not finish`);
  assert(s.positive?.refinement&&s.positive?.protectedDisplacement,'Missing positive coordinate audit');
  const initialRequired=s.baseline.ligand.contacts.filter(c=>c.required);
  const editedContacts=new Map(s.positive.edited.contacts.map(c=>[c.contactId,c]));
  const droppedRequiredContacts=initialRequired.filter(c=>!editedContacts.get(c.contactId)?.required)
    .map(c=>({id:c.contactId,label:c.label,after:editedContacts.get(c.contactId)||null}));
  const positive=s.positive.refinement;
  const relaxation=stage=>stage?{accepted:stage.response?.optimization?.accepted??null,error:stage.error||null,
    maximumLigandHeavyDisplacementAngstrom:stage.ligandDisplacement?.maximumAngstrom??null,
    ligandHeavyAtomsMovingOver001Angstrom:stage.ligandDisplacement?.moved.filter(x=>x.distance>0.01).length??null,
    sampledPocketAtoms:stage.pocket?.atoms.length??null,pocketInspectionTruncated:stage.pocket?.truncated??null,
    contactAudit:contacts(stage.liveContacts),undoMaximumLigandDisplacementAngstrom:stage.undoLigand?.maximumAngstrom??null,
    fixedAtomMotion:stage.response?.optimization?.registeredPoseRetention?.fixedAtomMotion||null}:null;
  const elapsed=action=>r.records.filter(x=>x.action===action).map(x=>({elapsedMs:x.elapsedMs,error:x.error||null}));
  const record={id:r.id,rawSha256:hash(bytes),rawBytes:bytes.length,
    preparedAtomCount:s.preparation?.molecule.atoms,baselineFeasible:s.baseline.refinement.feasible,
    positive:{candidates:positive.candidates,feasible:positive.feasible,coverageComplete:positive.coverageComplete,
      selectedCore:positive.selectedCore,protectedDisplacement:s.positive.protectedDisplacement,
      releasedAtomIds:s.positive.releasedAtomIds,sameElementLineageDisplacement:s.positive.sameElementLineageDisplacement,
      contactAudit:contacts(s.positive.liveContacts),droppedRequiredContacts,
      requiredContactSetPreserved:droppedRequiredContacts.length===0,
      selectedSeedAudit:positive.featureGuidedSeeding?.selectedSeedAudit,
      poseSearchExecution:positive.poseSearchExecution},
    fastPocket:relaxation(s.fastPocket),inducedFit:relaxation(s.relaxation),
    rotamer:{residue:spec.rotamer,candidates:s.rotamers?.enumeration?.sidechainRotamers?.candidates.length,
      seedChiDegrees:s.rotamers?.applied?.sidechainRotamer?.chiDegrees,
      maximumDisplacementAngstrom:s.rotamers?.applied?.sidechainRotamer?.maximumDisplacementAngstrom,
      feasibleAfterReceptorRefresh:s.rotamers?.refinement?.feasible,
      measuredPocketUndoMaximumDisplacementAngstrom:s.rotamers?.undo?.maximumAngstrom,
      pocketInspectionTruncated:s.rotamers?.undo?.inputTruncated,error:s.rotamers?.error||null},
    negative:{operation:spec.negativeElement?`${spec.negativeAtom} -> ${spec.negativeElement}`:`delete ${spec.negativeAtom}`,
      chemistryValid:s.negative?.edited?.molecule?.chemistryValidation?.status==='valid',
      contacts:s.negative?.edited?.contacts.map(c=>({id:c.contactId,required:c.required,available:c.available})),
      error:s.negative?.error||null,feasible:s.negative?.refinement?.feasible??null},
    timings:{preparation:elapsed('protein.prepare'),refinement:elapsed('pose.refine'),optimization:elapsed('optimization.run')}};
  // These are contract observations, not a blanket scientific pass.
  record.propagationGates={nonemptyCandidates:positive.candidates>0,hasFeasible:positive.feasible>0,
    coverageComplete:positive.coverageComplete===true,protectedAtomsExact:s.positive.protectedDisplacement.maximumAngstrom===0,
    allAppliedRequiredContactsGeometricallySatisfied:record.positive.contactAudit.length>0&&record.positive.contactAudit.every(c=>c.liveGeometryPass),
    originalRequiredContactSetPreserved:record.positive.requiredContactSetPreserved};
  summary.results.push(record);
  await writeFile(join(output,spec.id+'.json.gz'),gzipSync(bytes),{flag:'wx'});
}
summary.allPropagationContractsPass=summary.results.every(r=>Object.values(r.propagationGates).every(x=>x===true));
await writeFile(join(output,'protocol.json'),protocolBytes,{flag:'wx'});
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary.results.map(r=>({id:r.id,gates:r.propagationGates,negative:r.negative})),null,2));
