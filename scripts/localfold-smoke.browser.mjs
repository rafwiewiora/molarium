import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const b=await startMolariumBrowser({root:resolve(import.meta.dirname,'..'),appPath:'?blank=1',localOnly:false});
try{
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady&&window.molariumTest)'),60000,'API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  const cases=process.argv.includes('--chemistry')?[
    ['aromatic-charged','localfold-openbind0','NLYIQWLKDGGPSSGRPPPS',{type:'smiles',value:'c1ccccc1C(=O)[O-]'}],
    ['ccd','localfold-openbind0','NLYIQWLKDGGPSSGRPPPS',{type:'ccd',value:'EOH'}]]
    :process.argv.includes('--ligand-only')?[['cofold','localfold-openbind0','NLYIQWLKDGGPSSGRPPPS',{type:'smiles',value:'CCO'}]]
    :[['protein','localfold-af2','NLYIQWLKDGGPSSGRPPPS'],['long-protein','localfold-af2','A'.repeat(129)],
      ['cofold','localfold-openbind0','NLYIQWLKDGGPSSGRPPPS',{type:'smiles',value:'CCO'}]];
  const reports=[];
  for(const [name,model,sequence,ligand]of cases){
    console.log('Starting',name);
    const result=await b.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action:'protein.predict',
      args:{model,sequence,ligand,msaMode:'single',recycles:process.argv.includes('--chemistry')?2:0,
        steps:process.argv.includes('--chemistry')?25:5,seed:0}})}).then(r=>r)`);
    assert.equal(result.status,'completed');
    const output=await b.evaluate(`(()=>{const m=window.molariumTest.current().molecule;return {
      atoms:m.atoms.length,chains:[...new Set(m.atoms.map(a=>a.chain))],
      finite:m.atoms.every(a=>[a.x,a.y,a.z].every(Number.isFinite)),
      ligandAtoms:m.atoms.filter(a=>a.chain==='B').map(a=>({name:a.atomName,element:a.element})),
      ligandBonds:m.bonds.filter(b=>b.topology==='registered ligand definition'),
      registeredGraph:m.source?.registeredLigandGraph??null,
      model:m.prediction.model,meanPlddt:m.prediction.meanPlddt,ptm:m.prediction.ptm,
      revision:m.prediction.provenance.upstream.revision,
      alignment:m.prediction.provenance.alignment,
      input:m.prediction.provenance.request,
      geometry:m.prediction.geometry??null,
      ligandCharge:m.atoms.filter(a=>a.chain==='B').reduce((s,a)=>s+(a.formalCharge??a.charge??0),0),
      componentAtoms:m.prediction.component?.atoms.length??0,
      componentBonds:m.prediction.component?.bonds.length??0,
      preparationPolicy:document.querySelector('#preparation-ligands').value,
      modelManifestSha256:m.prediction.provenance.modelManifestSha256,
      elapsedMs:m.prediction.elapsedMs};})()`);
    assert.ok(output.finite);assert.ok(output.atoms>sequence.length*3);
    if(ligand){assert.equal(output.ligandAtoms.length,output.componentAtoms);
      assert.equal(output.ligandBonds.length,output.componentBonds);assert.equal(output.preparationPolicy,'registered');}
    if(name==='aromatic-charged'){
      assert.equal(output.ligandCharge,-1);assert.ok(output.ligandBonds.some(b=>b.aromatic&&b.order===1.5));
    }
    reports.push({name,...output});console.log(JSON.stringify(reports.at(-1)));
  }
  if(process.env.MOLARIUM_FOLD_REPORT)await writeFile(process.env.MOLARIUM_FOLD_REPORT,JSON.stringify(reports,null,2)+'\n');
  if(process.env.MOLARIUM_FOLD_SCREENSHOT)await writeFile(process.env.MOLARIUM_FOLD_SCREENSHOT,await b.capturePng());
  console.log('LocalFold actual-model browser integration: PASS');
}catch(error){console.log('Last UI status:',await b.evaluate(`document.querySelector('#fold-status').textContent`));throw error;}
finally{await b.close();}
