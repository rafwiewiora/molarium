import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const b=await startMolariumBrowser({root:resolve(import.meta.dirname,'..'),appPath:'?blank=1'});
try{
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  assert.equal(await b.evaluate(`document.querySelector('#fold-model').value`),'localfold-af2');
  await b.evaluate(`document.querySelector('#fold-model').value='localfold-openbind0';
    document.querySelector('#fold-model').dispatchEvent(new Event('change'));`);
  assert.equal(await b.evaluate(`document.querySelector('#fold-ligand-fields').classList.contains('hidden')`),false);
  await b.evaluate(`document.querySelector('#fold-msa-mode').value='provided';
    document.querySelector('#fold-msa-mode').dispatchEvent(new Event('change'));`);
  assert.equal(await b.evaluate(`document.querySelector('#fold-a3m').classList.contains('hidden')`),false);
  // Local Lab's browser-enforced policy must block external model loading before dispatch.
  const disabledBefore=await b.evaluate(`document.querySelector('#fold-protein').disabled`);
  await assert.rejects(b.evaluate(`window.MolariumChemistActions.execute({action:'protein.predict',
    args:{model:'localfold-openbind0',sequence:'ACDE',ligand:{type:'smiles',value:'CCO'},msaMode:'single'}})`),
    /disabled by Local Lab/);
  assert.equal(await b.evaluate(`document.querySelector('#fold-protein').disabled`),disabledBefore);
  await assert.rejects(b.evaluate(`window.MolariumChemistActions.execute({action:'protein.predict',
    args:{model:'localfold-af2',sequence:'ACDE',ligand:{type:'smiles',value:'CCO'}}})`),/OpenBind/);
  console.log('Folding UI choices, explicit modality and Local Lab boundary: PASS');
}finally{await b.close();}
