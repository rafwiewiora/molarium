// New, provenance-separated DV-01/02/03 regression; historical evidence is immutable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';
import { serializeRegisteredLigandDefinition } from '../../design-history/structures/registered-ligand-graph.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[2] || 'outputs/design-contact-remediation');
await mkdir(output, { recursive:false });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = ['app.js','docking/contact-state.mjs','docking/contact-capture-policy.mjs',
  'docking/contact-remap.mjs','docking/browser-adapter.mjs','docking/protocol.mjs',
  'docking/registered-donor-hydrogen.mjs',
  'docking/benchmark/design-contact-remediation.mjs',
  'design-history/structures/generated/cdk2-prospective-campaign.json'];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async (path) =>
  [path,hash(await readFile(join(root,path)))])));
const result = { schema:'molarium.design-contact-remediation/v1',startedAt:new Date().toISOString(),
  provenance:{ gitHead:execFileSync('git',['rev-parse','HEAD'],{ cwd:root,encoding:'utf8' }).trim(),
    dirtyStatus:execFileSync('git',['status','--short'],{ cwd:root,encoding:'utf8' }),sourceSha256 },
  protocol:{ findings:['DV-01','DV-02','DV-03'], regressionVersion:2,
    searchChains:64,featureSeedingProtocol:'v5',
    coordinateInputs:'registered hit only; no analogue crystal coordinates',
    scope:'development regression, not an accuracy or performance benchmark' },records:[],checks:{} };
const save = () => writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
await save();
const browser = await startMolariumBrowser({ root,appPath:'?validation=contact-remediation' });
const execute = async (action,args={}) => {
  console.log(action); const started=Date.now();
  const auditArgs = action === 'session.loadStructure' ? { ...args,content:`sha256:${hash(args.content)}` } : args;
  try {
    const response = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({ action,args })})`);
    result.records.push({ action,args:auditArgs,response,elapsedMs:Date.now()-started });
    await save(); return response.result;
  } catch (error) {
    result.records.push({ action,args:auditArgs,error:String(error),elapsedMs:Date.now()-started });
    await save(); throw error;
  }
};
const inspect = () => execute('session.inspect',{ scope:'pocket',includeCoordinates:true,maximumAtoms:500 });
const prepare = (ligandPolicy='ccd') => execute('protein.prepare',{ pH:7.4,histidine:'auto',
  repairMissingHeavy:true,ligandPolicy,waterPolicy:'retain',gapPolicy:'cap' });
const distance = (a,b) => Math.hypot(...a.map((value,index) => value-b[index]));
function checkLiveGeometry(state) {
  const byId = new Map(state.atoms.map((atom) => [atom.atomId,atom.coordinatesAngstrom]));
  let checked=0;
  for (const contact of state.contacts) {
    const hbond=contact.hydrogenBond;
    assert.equal(hbond.geometrySource,'current-molecule-coordinates');
    if (!hbond.measurable) continue;
    const [d,h,a] = ['donor','hydrogen','acceptor'].map((role) => {
      const participant=hbond.participants[role];
      const coordinates=byId.get(participant.atomId);
      assert(coordinates,`Contact ${contact.contactId} participant omitted from pocket inspection`);
      assert.deepEqual(participant.coordinatesAngstrom,coordinates);
      return coordinates;
    });
    const da=distance(d,a),ha=distance(h,a),dh=distance(d,h);
    const angle=Math.acos(Math.max(-1,Math.min(1,(dh*dh+ha*ha-da*da)/(2*dh*ha))))*180/Math.PI;
    assert(Math.abs(hbond.donorAcceptorDistanceAngstrom-da)<1e-9);
    assert(Math.abs(hbond.hydrogenAcceptorDistanceAngstrom-ha)<1e-9);
    assert(Math.abs(hbond.dhaAngleDegrees-angle)<1e-8);
    assert.equal(hbond.satisfied,hbond.available&&da>=2.4&&da<=3.5&&ha>=1.2&&ha<=2.7&&angle>=120);
    checked++;
  }
  return checked;
}
function ccdDefinition(text,id) {
  const lines=text.split(/\r?\n/);
  const rows=(prefix)=>{
    let i=lines.findIndex((line)=>line.startsWith(prefix+'.'));
    assert(i>=0); const columns=[];
    while(lines[i]?.startsWith(prefix+'.'))columns.push(lines[i++].trim().slice(prefix.length+1));
    const data=[];
    for(;i<lines.length&&!lines[i].startsWith('#')&&!lines[i].startsWith('loop_');i++) {
      if(!lines[i].trim())continue;
      const values=lines[i].match(/"[^"]*"|'[^']*'|\S+/g).map((value)=>value.replace(/^(["'])(.*)\1$/,'$2'));
      assert.equal(values.length,columns.length);
      data.push(Object.fromEntries(columns.map((column,index)=>[column,values[index]])));
    }
    return data;
  };
  return {id,atoms:rows('_chem_comp_atom').map((atom)=>({id:atom.atom_id,
    element:atom.type_symbol[0]+atom.type_symbol.slice(1).toLowerCase(),formalCharge:Number(atom.charge),
    aromatic:atom.pdbx_aromatic_flag==='Y',leaving:atom.pdbx_leaving_atom_flag==='Y'})),
  bonds:rows('_chem_comp_bond').map((bond)=>({a:bond.atom_id_1,b:bond.atom_id_2,
    order:({SING:1,DOUB:2,TRIP:3,AROM:1.5})[bond.value_order],aromatic:bond.pdbx_aromatic_flag==='Y'}))};
}
try {
  await waitFor(()=>browser.evaluate('Boolean(window.MolariumChemistActions)'),90000,'public API');
  result.provenance.browser = await browser.evaluate('navigator.userAgent');
  await execute('designRoute.load',{routeId:'cdk2-hit-only'});
  await prepare(); await execute('view.setMode',{mode:'build'});
  await execute('pose.captureReference',{mode:'propagate'});
  const baseline=await inspect(); assert(baseline.contacts.length>=2); checkLiveGeometry(baseline);
  const water=baseline.contacts.find((contact)=>contact.label.includes('N7'));
  const anchor=baseline.contacts.find((contact)=>contact.label.includes('LEU')&&contact.label.includes('N3'));
  assert(water?.required&&anchor?.required,'Both original CDK2 hypotheses must start required');
  await execute('pose.setContact',{contactId:anchor.contactId,required:false});
  const staged=await execute('designRoute.applyStep',{stepId:'add-meta-chloro'});
  const edited=await inspect();
  const waterAfter=edited.contacts.find((contact)=>contact.contactId===water.contactId);
  assert.equal(waterAfter.required,true); assert.equal(waterAfter.available,true);
  assert.equal(waterAfter.hydrogenBond.participants.hydrogen.atomId,water.hydrogenBond.participants.hydrogen.atomId);
  assert.deepEqual(waterAfter.hydrogenBond.participants.hydrogen.coordinatesAngstrom,
    water.hydrogenBond.participants.hydrogen.coordinatesAngstrom);
  assert.equal(edited.contacts.find((contact)=>contact.contactId===anchor.contactId).required,false);
  assert.deepEqual(staged.designStep.contactPolicy.unresolvedRequiredContactIds,[]);
  assert(staged.designStep.donorHydrogenLineage.preserved.some((entry)=>entry.contactId===water.contactId));
  result.checks.requiredAndOmittedIntentPreserved=true;
  result.checks.unchangedSingleDonorHydrogenPreserved=staged.designStep.donorHydrogenLineage;
  await execute('pose.setContact',{contactId:anchor.contactId,required:true});
  const refinement=(await execute('pose.refine',{searchChains:64,featureSeedingProtocol:'v5'})).refinement;
  assert(refinement.selectedFeasible); assert(refinement.feasible>0);
  assert(refinement.motionPolicy.protectedAtomIds.length>0);
  assert(refinement.motionPolicy.affectedRotorReleasedAtomIds.length>0);
  const hypothetical=await inspect(); checkLiveGeometry(hypothetical);
  assert(hypothetical.contacts.some((contact)=>contact.candidateHydrogenBond));
  await execute('pose.apply',{index:refinement.selectedRank-1});
  const applied=await inspect(); checkLiveGeometry(applied);
  assert(baseline.contacts.filter((contact)=>contact.required).every((before)=>applied.contacts.some((contact)=>
    contact.contactId===before.contactId&&contact.required&&contact.available&&contact.hydrogenBond.satisfied)));
  result.checks.originalContactSetRecovery={ feasible:refinement.feasible,candidates:refinement.candidates,
    requiredContactIds:applied.contacts.filter((contact)=>contact.required).map((contact)=>contact.contactId),
    motionPolicy:refinement.motionPolicy };
  await execute('protein.parameterize');
  await execute('optimization.run',{method:'pocket-webgpu'});
  const relaxed=await inspect(); checkLiveGeometry(relaxed);
  const changes=relaxed.contacts.flatMap((contact)=>{
    const before=applied.contacts.find((entry)=>entry.contactId===contact.contactId)?.hydrogenBond;
    return before?.measurable&&contact.hydrogenBond.measurable
      ? [Math.abs(before.hydrogenAcceptorDistanceAngstrom-contact.hydrogenBond.hydrogenAcceptorDistanceAngstrom)] : [];
  });
  assert(Math.max(...changes)>0.001,'Relaxation must actually perturb a measurable contact');
  result.checks.liveGeometryAfterRelaxation={ maximumHaChangeAngstrom:Math.max(...changes),
    checkedContacts:relaxed.contacts.filter((contact)=>contact.hydrogenBond.measurable).length };
  await execute('history.undo'); await execute('view.setMode',{mode:'build'});
  const restored=await inspect(); checkLiveGeometry(restored);
  const receptorIds=['donor','hydrogen','acceptor'].map((role)=>anchor.hydrogenBond.participants[role])
    .filter((participant)=>participant?.scope==='receptor').map((participant)=>participant.atomId);
  await execute('geometry.translateAtoms',{atomIds:receptorIds,deltaAngstrom:{x:10,y:0,z:0}});
  const moved=await inspect(); checkLiveGeometry(moved);
  assert.equal(moved.contacts.find((contact)=>contact.contactId===anchor.contactId).hydrogenBond.satisfied,false);
  await execute('history.undo');
  result.checks.liveGeometryAfterReceptorMotion=true;
  // A changed requirement must invalidate prior feasibility, even when coordinates do not change.
  await execute('pose.refine',{searchChains:8});
  await execute('pose.setContact',{contactId:anchor.contactId,required:false});
  await assert.rejects(()=>execute('pose.apply',{index:0}),/does not exist|Select a docking pose/);
  result.checks.changedRequirementInvalidatesCandidate=true;

  const corpus=JSON.parse(await readFile(join(import.meta.dirname,'run-input.v0.1.json')));
  const reference=corpus.cases.find((entry)=>entry.id==='prospective-parp2-4zzy-d7n-amide-to-nitrile').reference;
  const pdb=await readFile(join(import.meta.dirname,reference.coordinateFile));
  const ccd=await readFile(join(import.meta.dirname,reference.ccdFile));
  assert.equal(hash(pdb),reference.coordinateSha256); assert.equal(hash(ccd),reference.ccdSha256);
  let model=1;
  const content=pdb.toString().split(/\r?\n/).filter((line)=>{
    if(line.startsWith('MODEL ')){model=Number(line.slice(10,14))||1;return false;}
    if(line.startsWith('ENDMDL'))return false;
    if(line.startsWith('ATOM  '))return model===1;
    if(!line.startsWith('HETATM'))return !line.startsWith('CONECT')&&!line.startsWith('END');
    return model===1&&(['HOH','WAT'].includes(line.slice(17,20).trim())
      ||line.slice(17,20).trim()===reference.ligandComponentId&&line.slice(21,22).trim()===reference.ligandChain
        &&Number(line.slice(22,26))===reference.ligandResidueNumber);
  }).join('\n')+'\nEND\n';
  result.provenance.parp2Reference={...reference,filteredPdbSha256:hash(content)};
  await writeFile(join(output,'parp2-reference.pdb'),content,{flag:'wx'});
  await execute('session.loadStructure',{content,format:'pdb',name:'PARP2 contact policy',polish:false});
  const definition=ccdDefinition(ccd.toString(),reference.ligandComponentId);
  await execute('ligand.installRegisteredGraph',{locator:{residueName:reference.ligandComponentId,
    chain:reference.ligandChain,residueIndex:reference.ligandResidueNumber},definition,
    graphSha256:hash(serializeRegisteredLigandDefinition(definition))});
  await prepare('registered'); await execute('view.setMode',{mode:'build'});
  await execute('pose.captureReference',{mode:'propagate'});
  const parp=await inspect(); checkLiveGeometry(parp);
  const fluorine=parp.contacts.find((contact)=>contact.evidenceClass==='weak-covalent-fluorine-hypothesis');
  assert(fluorine,'PARP2 F27 contact hypothesis must remain auditable');
  assert.equal(fluorine.required,false); assert.equal(fluorine.available,true);
  assert.match(fluorine.conventionalAcceptorHeuristic,/^outside-/);
  assert(parp.contacts.filter((contact)=>contact!==fluorine).every((contact)=>contact.required));
  await execute('pose.setContact',{contactId:fluorine.contactId,required:true});
  assert((await inspect()).contacts.find((contact)=>contact.contactId===fluorine.contactId).required);
  await execute('pose.setContact',{contactId:fluorine.contactId,required:false});
  result.checks.fluorineOptionalWithExplicitOverride=true;
  // Orthogonal negative: genuinely remove the carbonyl feature, not merely its
  // generated hydrogen identity; keep requirements until an explicit omission.
  await execute('chemistry.setEditPolicy',{mode:'staged'});
  const carbonyl=parp.atoms.find((atom)=>atom.residueName==='D7N'&&atom.atomName==='O28');
  assert(carbonyl);
  await execute('chemistry.deleteAtom',{atomId:carbonyl.atomId});
  await execute('chemistry.finish');
  const removed=await inspect();
  const unavailableRequired=removed.contacts.filter((contact)=>contact.required&&!contact.available);
  assert.equal(unavailableRequired.length,2);
  await assert.rejects(()=>execute('pose.refine',{searchChains:8}),/selected contact.*no role-compatible/i);
  result.checks.unavailableRequiredRefinementRejected=true;
  result.checks.genuineFeatureRemovalContactIds=unavailableRequired.map((contact)=>contact.contactId);
  for(const contact of unavailableRequired)
    await execute('pose.setContact',{contactId:contact.contactId,required:false});
  assert((await inspect()).contacts.every((contact)=>!contact.required));
  result.status='passed';
} catch (error) { result.status='failed';result.error=String(error);process.exitCode=1; }
finally {
  result.finishedAt=new Date().toISOString();
  result.provenance.sourceSha256AtCompletion=Object.fromEntries(await Promise.all(sources.map(async(path)=>
    [path,hash(await readFile(join(root,path)))])));
  await save(); await browser.close();
}
console.log(JSON.stringify({status:result.status,checks:result.checks,error:result.error}));
