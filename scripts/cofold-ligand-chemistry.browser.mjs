// Real offline-capable RDKit-WASM -> LocalFold chemistry check; no model inference.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'../dist'),panel=JSON.parse(await readFile(process.argv[2]??'reviews/cofold-recent-pdb-2026-11-13/panel.json'));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const path=new URL(req.url).pathname;return new Response(Bun.file(join(root,path==='/'?'index.html':path)),{headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}});}});
const b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/?blank=1`});
try{
 await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'API');
 const records=await b.evaluate(`(async()=>{
   const {normalizeLigandSmiles}=await import('./folding/ligand-normalization.mjs');
   const {smilesComponent}=await import('./vendor/localfold/shared/chem/component.js');
   const records=[];
   for(const c of ${JSON.stringify(panel.cases)}){
     const normalized=await normalizeLigandSmiles(c.smiles);
     const component=await smilesComponent(normalized.canonicalSmiles,{code:'LIG',seed:0});
     records.push({caseId:c.id,inputSmiles:c.smiles,...normalized,component});
   }
   let invalidRejected=false;
   try{await normalizeLigandSmiles('this is not SMILES');}catch{invalidRejected=true;}
   return {records,invalidRejected};
 })()`);
 assert.equal(records.records.length,panel.cases.length);assert.equal(records.invalidRejected,true);
 assert.ok(records.records.every(r=>r.rdkitVersion&&r.component.atoms.length));
 // This frozen chemistry-only fixture was independently checked with Python
 // RDKit, including raw model bond features and specified tetrahedral centres.
 const expected=JSON.parse(await readFile('reviews/cofold-recent-pdb-2026-11-13/normalized-chemistry.json'));
 const graph=c=>({atoms:c.atoms.map(a=>[a.element,a.charge??0]),bonds:c.bonds});
 for(const r of records.records){const e=expected.records.find(e=>e.caseId===r.caseId);
   if(!e)continue;
   assert.equal(r.canonicalSmiles,e.canonicalSmiles,r.caseId+' canonical representation');
   assert.deepEqual(graph(r.component),graph(e.component),r.caseId+' raw model chemistry');
 }
 const report={purpose:'Actual RDKit WebAssembly canonicalization and LocalFold conformer generation; no model inference.',...records};
 if(process.env.MOLARIUM_CHEMISTRY_REPORT)await writeFile(process.env.MOLARIUM_CHEMISTRY_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({cases:records.records.length,invalidRejected:true,rdkitVersion:records.records[0].rdkitVersion}));
}finally{await b.close();server.stop(true);}
