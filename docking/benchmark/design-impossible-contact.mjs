// Orthogonal negative: chemistry stays intact, but the asserted H-bond is geometrically impossible.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {startMolariumBrowser,waitFor} from '../../scripts/headless-chrome.mjs';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(process.argv[2]||'outputs/impossible-contact.json');
const result={schema:'molarium.impossible-contact-development-check/v1',startedAt:new Date().toISOString(),
  runnerSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  protocol:{route:'cdk2-hit-only',searchChains:8,contact:'2A6 N3 acceptor <- LYS A33 NZ donor',
    rationale:'Deliberately incompatible extra H-bond with unchanged hard ligand core; not a historical designer-intent claim'},records:[]};
await writeFile(output,JSON.stringify(result),{flag:'wx'});
const browser=await startMolariumBrowser({root,appPath:'?validation=impossible-contact'});
const execute=async(action,args={})=>{
  console.log(action);const start=Date.now();
  try {const response=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
    result.records.push({action,args,response,elapsedMs:Date.now()-start});return response.result;
  }catch(e){result.records.push({action,args,error:String(e),elapsedMs:Date.now()-start});throw e;}
};
try {
  await waitFor(()=>browser.evaluate('Boolean(window.MolariumChemistActions)'),90000,'public API');
  await execute('designRoute.load',{routeId:'cdk2-hit-only'});
  await execute('protein.prepare',{pH:7.4,histidine:'auto',repairMissingHeavy:true,ligandPolicy:'ccd',waterPolicy:'retain',gapPolicy:'cap'});
  await execute('view.setMode',{mode:'build'});
  await execute('pose.captureReference',{mode:'propagate'});
  const baseline=await execute('session.inspect',{scope:'pocket',includeCoordinates:true,maximumAtoms:500});
  const initialIds=new Set(baseline.contacts.map(c=>c.contactId));
  const ligandAtom=baseline.atoms.find(a=>a.residueName==='2A6'&&a.atomName==='N3');
  const receptorAtom=baseline.atoms.find(a=>a.residueName==='LYS'&&a.chain==='A'&&a.residueIndex===33&&a.atomName==='NZ');
  assert(ligandAtom&&receptorAtom,'Public inspection must resolve both named atoms');
  await execute('pose.addContact',{ligandAtomId:ligandAtom.atomId,receptorAtomId:receptorAtom.atomId,ligandRole:'acceptor'});
  const state=await execute('session.inspect',{scope:'pocket',includeCoordinates:true,maximumAtoms:500});
  const added=state.contacts.filter(c=>!initialIds.has(c.contactId));assert.equal(added.length,1);
  const atoms=new Map(state.atoms.map(a=>[a.atomId,a.coordinatesAngstrom]));
  const p=added[0].hydrogenBond.participants,d=atoms.get(p.donor.atomId),a=atoms.get(p.acceptor.atomId);
  result.donorAcceptorAngstrom=Math.hypot(...d.map((v,i)=>v-a[i]));
  assert(result.donorAcceptorAngstrom>3.5,'Test contact must actually start outside the registered geometric range');
  result.impossible=(await execute('pose.refine',{searchChains:8})).refinement;
  assert.equal(result.impossible.feasible,0,'Impossible required contact must produce no feasible poses');
  try {await execute('pose.apply',{index:result.impossible.selectedRank-1});result.applyRejected=false;}
  catch(e){result.applyRejected=true;result.applyError=String(e);}
  assert.equal(result.applyRejected,true,'Applying an infeasible pose must fail closed');
  await execute('pose.setContact',{contactId:added[0].contactId,required:false});
  result.omittedControl=(await execute('pose.refine',{searchChains:8})).refinement;
  assert(result.omittedControl.feasible>0,'Explicitly omitting the impossible hypothesis must restore baseline feasibility');
  result.status='passed';
}catch(e){result.status='failed';result.error=String(e);process.exitCode=1;}
finally {await writeFile(output,JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:result.status,distance:result.donorAcceptorAngstrom,impossible:result.impossible?.feasible,control:result.omittedControl?.feasible,error:result.error}));
