// Development regression panel: public JSON actions only; no hidden analogue coordinates.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {startMolariumBrowser, waitFor} from '../../scripts/headless-chrome.mjs';
import {serializeRegisteredLigandDefinition} from '../../design-history/structures/registered-ligand-graph.mjs';

const root=resolve(import.meta.dirname,'../..');
const digest=x=>createHash('sha256').update(x).digest('hex');
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=resolve(option('--output',join(root,'outputs/design-validation',new Date().toISOString().replaceAll(':','-'))));
await mkdir(dirname(out),{recursive:true});
await mkdir(out,{recursive:false}); // immutable attempt; never overwrite an earlier run
const corpus=JSON.parse(await readFile(join(import.meta.dirname,'run-input.v0.1.json')));
const panel=[
  {id:'parp2-distal-halogen',source:'prospective-parp2-4zzy-d7n-amide-to-nitrile',edit:{atom:'F5',element:'Cl'},negativeAtom:'O28',rotamer:{residueName:'SER',chain:'A',residueIndex:470}},
  {id:'p38-thiocarbonyl',source:'prospective-p38-3fly-fly-carbonyl-to-thiocarbonyl',edit:{atom:'O15',element:'S'},negativeAtom:'N12',negativeElement:'C',rotamer:{residueName:'MET',chain:'A',residueIndex:109}},
  {id:'cdk2-meta-chloro',source:'paired-cdk2-1h1q-2a6-to-1h1r-6cp',route:'cdk2-hit-only',step:'add-meta-chloro',negativeAtom:'N3',negativeElement:'C',rotamer:{residueName:'PHE',chain:'A',residueIndex:80}},
].filter(x=>!option('--case',null)||x.id===option('--case',null));
assert(panel.length,'Unknown --case');

// Only the two simple loop tables in these hash-pinned CCD fixtures are parsed.
// No CCD ideal coordinates are admitted to the registered graph.
function definitionFromCcd(text,id) {
  const lines=text.split(/\r?\n/);
  const rows=prefix=>{
    const start=lines.findIndex(x=>x.startsWith(prefix+'.'));
    assert(start>=0,`Missing ${prefix}`);
    let i=start; const columns=[];
    while(lines[i]?.startsWith(prefix+'.')) columns.push(lines[i++].trim().slice(prefix.length+1));
    const result=[];
    for(;i<lines.length&&!lines[i].startsWith('#')&&!lines[i].startsWith('loop_');i++) {
      if(!lines[i].trim())continue;
      const tokens=lines[i].match(/"[^"]*"|'[^']*'|\S+/g)?.map(x=>x.replace(/^(["'])(.*)\1$/,'$2'));
      assert.equal(tokens?.length,columns.length,`Unsupported CCD row in ${id}`);
      result.push(Object.fromEntries(columns.map((c,j)=>[c,tokens[j]])));
    }
    return result;
  };
  return {id,atoms:rows('_chem_comp_atom').map(x=>({id:x.atom_id,element:x.type_symbol[0]+x.type_symbol.slice(1).toLowerCase(),formalCharge:Number(x.charge),aromatic:x.pdbx_aromatic_flag==='Y',leaving:x.pdbx_leaving_atom_flag==='Y'})),
    bonds:rows('_chem_comp_bond').map(x=>({a:x.atom_id_1,b:x.atom_id_2,order:({SING:1,DOUB:2,TRIP:3,AROM:1.5})[x.value_order],aromatic:x.pdbx_aromatic_flag==='Y'}))};
}
function filterReference(text,ref) {
  let model=1;
  return text.split(/\r?\n/).filter(line=>{
    if(line.startsWith('MODEL ')){model=Number(line.slice(10,14))||1;return false;}
    if(line.startsWith('ENDMDL'))return false;
    if(line.startsWith('ATOM  '))return model===1;
    if(!line.startsWith('HETATM'))return !line.startsWith('CONECT')&&!line.startsWith('END');
    if(model!==1)return false;
    const name=line.slice(17,20).trim();
    return ['HOH','WAT'].includes(name)||(name===ref.ligandComponentId&&line.slice(21,22).trim()===ref.ligandChain&&Number(line.slice(22,26))===ref.ligandResidueNumber);
  }).join('\n')+'\nEND\n';
}
function displacement(before,after) {
  const map=new Map(after.atoms.map(x=>[x.atomId,x]));
  const rows=before.atoms.filter(x=>x.element!=='H'&&map.get(x.atomId)?.element===x.element).map(x=>({atomId:x.atomId,atomName:x.atomName,residueName:x.residueName,
    distance:Math.hypot(...x.coordinatesAngstrom.map((v,i)=>v-map.get(x.atomId).coordinatesAngstrom[i]))}));
  return {compared:rows.length,maximumAngstrom:Math.max(0,...rows.map(x=>x.distance)),moved:rows.filter(x=>x.distance>1e-8),inputTruncated:before.truncated,outputTruncated:after.truncated};
}
// Crucially use LIVE atom coordinates, not the cached pose or reference-point geometry.
function liveContacts(state) {
  const atoms=new Map(state.atoms.map(x=>[x.atomId,x]));
  return state.contacts.filter(x=>x.required).map(c=>{
    const p=c.hydrogenBond.participants;
    const [d,h,a]=[p.donor,p.hydrogen,p.acceptor].map(x=>atoms.get(x?.atomId)?.coordinatesAngstrom);
    if(!d||!h||!a)return {id:c.contactId,label:c.label,measurable:false};
    const dist=(x,y)=>Math.hypot(...x.map((v,i)=>v-y[i]));
    const dh=dist(d,h),ha=dist(h,a),da=dist(d,a);
    const cosine=d.map((v,i)=>(v-h[i])*(a[i]-h[i])).reduce((s,x)=>s+x,0)/(dh*ha);
    return {id:c.contactId,label:c.label,available:c.available,measurable:true,donorAcceptorAngstrom:da,hydrogenAcceptorAngstrom:ha,dhaDegrees:Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI,
      cachedSatisfied:c.hydrogenBond.satisfied,cachedHydrogenAcceptorAngstrom:c.hydrogenBond.hydrogenAcceptorDistanceAngstrom};
  });
}
const protocol={schema:'molarium.design-function-validation/v1',startedAt:new Date().toISOString(),panel,
  interpretation:'Development functional panel, selected using known preparation viability; not blind pose prediction or affinity validation.',
  preparation:{pH:7.4,histidine:'auto',repairMissingHeavy:true,ligandPolicy:'registered',waterPolicy:'retain',gapPolicy:'cap'},
  requiredContactPolicy:'Require captured contacts with a ligand N/O donor or acceptor; omit other elements, including organofluorine acceptors, explicitly before edits.',
  search:{searchChains:64,execution:'auto',featureSeedingProtocol:'v5'},
  tests:['unmodified baseline','positive graph edit','exact protected coordinates after apply; report edit-associated rotor releases separately','live H-bond geometry before/after both pocket methods','single-sidechain discrete branch and Undo','delete PARP2 O28 or replace p38 N12/CDK2 N3 by carbon; required contacts must not silently disappear'],
  runnerSha256:digest(await readFile(new URL(import.meta.url))),sourceCommit:(await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim()};
await writeFile(join(out,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
for(const spec of panel) {
  const records=[]; const result={id:spec.id,status:'running',stages:{}};
  let browser;
  const save=()=>writeFile(join(out,spec.id+'.json'),JSON.stringify({...result,records},null,2)+'\n');
  try {
    browser=await startMolariumBrowser({root,appPath:'?validation=design-functions'});
    await waitFor(()=>browser.evaluate("Boolean(window.MolariumChemistActions)"),90000,'public API');
    const execute=async(action,args={})=>{
      console.log(spec.id,action);
      const start=Date.now();
      try {const r=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
        records.push({action,args:action==='session.loadStructure'?{...args,content:`sha256:${digest(args.content)}`} : args,response:r,elapsedMs:Date.now()-start}); await save();return r.result;
      }catch(e){records.push({action,args,error:String(e),elapsedMs:Date.now()-start});await save();throw e;}
    };
    const inspect=scope=>execute('session.inspect',{scope,includeCoordinates:true,maximumAtoms:500});
    const entry=corpus.cases.find(x=>x.id===spec.source),ref=entry.reference;
    if(spec.route)await execute('designRoute.load',{routeId:spec.route});
    else {
      const pdb=await readFile(join(import.meta.dirname,ref.coordinateFile));
      const ccd=await readFile(join(import.meta.dirname,ref.ccdFile));
      assert.equal(digest(pdb),ref.coordinateSha256);assert.equal(digest(ccd),ref.ccdSha256);
      const content=filterReference(pdb.toString(),ref),definition=definitionFromCcd(ccd.toString(),ref.ligandComponentId);
      result.inputs={reference:ref,filteredPdbSha256:digest(content)};
      await writeFile(join(out,spec.id+'.pdb'),content,{flag:'wx'});
      await execute('session.loadStructure',{content,format:'pdb',name:spec.id,polish:false});
      await execute('ligand.installRegisteredGraph',{locator:{residueName:ref.ligandComponentId,chain:ref.ligandChain,residueIndex:ref.ligandResidueNumber},definition,graphSha256:digest(serializeRegisteredLigandDefinition(definition))});
    }
    await execute('view.setMode',{mode:'build'});
    result.stages.preparation=await execute('protein.prepare',{...protocol.preparation,ligandPolicy:spec.route?'ccd':'registered'});
    await execute('pose.captureReference',{mode:'propagate'});
    const captured=await inspect('ligand');
    for(const c of captured.contacts) {
      const ligand=Object.values(c.hydrogenBond.participants).find(x=>x?.scope==='ligand'&&x.element!=='H');
      await execute('pose.setContact',{contactId:c.contactId,required:['N','O'].includes(ligand?.element)});
    }
    result.stages.baseline={ligand:await inspect('ligand'),pocket:await inspect('pocket')};
    result.stages.baseline.liveContacts=liveContacts(result.stages.baseline.pocket);
    result.stages.baseline.refinement=(await execute('pose.refine',protocol.search)).refinement;
    await execute('chemistry.setEditPolicy',{mode:'staged'});
    if(spec.step)await execute('designRoute.applyStep',{stepId:spec.step});
    else {
      const atom=(await inspect('ligand')).atoms.find(x=>x.atomName===spec.edit.atom);
      assert(atom,'Positive-edit atom missing');
      await execute('chemistry.setAtom',{atomId:atom.atomId,element:spec.edit.element,formalCharge:0});
      await execute('chemistry.finish');
    }
    const edited=await inspect('ligand');
    result.stages.positive={edited,refinement:(await execute('pose.refine',protocol.search)).refinement};
    const positive=result.stages.positive.refinement;
    result.stages.positive.capture=(await execute('pose.inspectRefinementCapture',{includeCoordinates:true})).refinementCapture;
    if(positive.selectedFeasible) {
      await execute('pose.apply',{index:positive.selectedRank-1});
      const applied=await inspect('ligand'),pocket=await inspect('pocket');
      result.stages.positive.applied=applied;
      result.stages.positive.sameElementLineageDisplacement=displacement(result.stages.baseline.ligand,applied);
      const released=new Set((positive.featureGuidedSeeding?.releasedCoreAtomIndices||[]).map(i=>result.stages.positive.capture.atomIds[i]));
      for(const region of edited.transformedRingRegions||[])for(const id of region.releasedHeavyAtomIds||[])released.add(id);
      result.stages.positive.releasedAtomIds=[...released];
      result.stages.positive.protectedDisplacement=displacement({...result.stages.baseline.ligand,atoms:result.stages.baseline.ligand.atoms.filter(a=>!released.has(a.atomId))},applied);
      result.stages.positive.liveContacts=liveContacts(pocket);
      await execute('protein.parameterize');
      try {
        const response=await execute('optimization.run',{method:'pocket-webgpu'});
        const after=await inspect('ligand'),afterPocket=await inspect('pocket');
        result.stages.fastPocket={response,ligandDisplacement:displacement(applied,after),pocketDisplacement:displacement(pocket,afterPocket),liveContacts:liveContacts(afterPocket),pocket:afterPocket};
        await execute('history.undo');
        result.stages.fastPocket.undoLigand=displacement(applied,await inspect('ligand'));
        assert.equal(result.stages.fastPocket.undoLigand.maximumAngstrom,0,'Fast pocket Undo must restore input before induced-fit comparison');
      }catch(e){result.stages.fastPocket={...result.stages.fastPocket,error:String(e)};throw e;}
      try {
        await execute('view.setMode',{mode:'build'});
        const relaxation=await execute('optimization.run',{method:'induced-fit-webgpu'});
        const relaxedLigand=await inspect('ligand'),relaxedPocket=await inspect('pocket');
        result.stages.relaxation={response:relaxation,ligandDisplacement:displacement(applied,relaxedLigand),pocketDisplacement:displacement(pocket,relaxedPocket),liveContacts:liveContacts(relaxedPocket),pocket:relaxedPocket};
        await execute('history.undo');
        result.stages.relaxation.undoLigand=displacement(applied,await inspect('ligand'));
        assert.equal(result.stages.relaxation.undoLigand.maximumAngstrom,0,'Induced-fit Undo must restore input');
      }catch(e){result.stages.relaxation={error:String(e)};}
      try {
        await execute('view.setMode',{mode:'build'});
        result.stages.rotamers={enumeration:await execute('pose.enumerateSidechainRotamers',{receptorResidue:spec.rotamer,maximumCandidates:16})};
        const ensemble=result.stages.rotamers.enumeration;
        // Enumeration output is preserved even if no non-input branch is available.
        const candidates=ensemble.sidechainRotamers?.candidates||ensemble.rotamers?.candidates||[];
        const candidate=candidates.find(x=>x.source!=='input');
        if(candidate) {
          const before=await inspect('pocket');
          result.stages.rotamers.applied=await execute('pose.applySidechainRotamer',{coordinateSha256:candidate.coordinateSha256});
          const after=await inspect('pocket');
          result.stages.rotamers.displacement=displacement(before,after);
          result.stages.rotamers.liveContacts=liveContacts(after);
          result.stages.rotamers.receptorRefresh=await execute('pose.updateReceptorReference');
          result.stages.rotamers.refinement=(await execute('pose.refine',protocol.search)).refinement;
          await execute('history.undo');
          result.stages.rotamers.undo=displacement(before,await inspect('pocket'));
          await execute('pose.updateReceptorReference');
        }
      }catch(e){result.stages.rotamers={...result.stages.rotamers,error:String(e)};}
    }
    // Deliberately destructive molecular edit in this disposable test state only.
    // A failed chemical validation is distinct from a successful negative pose gate.
    try {
      const atom=(await inspect('ligand')).atoms.find(x=>x.atomName===spec.negativeAtom);
      assert(atom,'Negative-control atom missing');
      if(spec.negativeElement)await execute('chemistry.setAtom',{atomId:atom.atomId,element:spec.negativeElement,formalCharge:0});
      else await execute('chemistry.deleteAtom',{atomId:atom.atomId});
      await execute('chemistry.finish');
      result.stages.negative={edited:await inspect('ligand')};
      result.stages.negative.refinement=(await execute('pose.refine',protocol.search)).refinement;
      const r=result.stages.negative.refinement;
      if(!r.selectedFeasible) {
        try {await execute('pose.apply',{index:r.selectedRank-1});result.stages.negative.infeasibleApplyRejected=false;}
        catch(e){result.stages.negative.infeasibleApplyRejected=true;result.stages.negative.applyError=String(e);}
      }
    }catch(e){result.stages.negative={...result.stages.negative,error:String(e)};}
    result.status='completed-observations';
  }catch(e){result.status='blocked';result.error=String(e);}
  finally {await save();await browser?.close();}
  console.log(JSON.stringify({id:result.id,status:result.status,error:result.error,positive:result.stages.positive?.refinement?.selectedFeasible}));
}
console.log(out);
