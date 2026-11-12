import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..','dist');
const headerText=await readFile(join(root,'_headers'),'utf8');
const headers=Object.fromEntries(headerText.split('\n').filter(l=>/^  [\w-]+:/.test(l)).map(l=>{
  const i=l.indexOf(':');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const path=new URL(req.url).pathname;
  if(path.split('/').includes('..'))return new Response('Forbidden',{status:403});
  return new Response(Bun.file(join(root,path==='/'?'index.html':path)),{headers});
}});
const download=await mkdtemp(join(tmpdir(),'molarium-fold-export-'));
const b=await startMolariumBrowser({url:process.env.MOLARIUM_FOLD_URL??`http://127.0.0.1:${server.port}/?blank=1`});
try{
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'release API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  await b.client.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});
  const sequence='NLYIQWLKDGGPSSGRPPPS';
  const cofold=process.argv.includes('--cofold');
  await b.evaluate(`(()=>{
    document.querySelector('#fold-model').value=${JSON.stringify(cofold?'localfold-openbind0':'localfold-af2')};
    document.querySelector('#fold-model').dispatchEvent(new Event('change'));
    document.querySelector('#protein-sequence').value=${JSON.stringify(sequence)};
    document.querySelector('#fold-msa-mode').value='provided';
    document.querySelector('#fold-msa-mode').dispatchEvent(new Event('change'));
    document.querySelector('#fold-a3m').value=${JSON.stringify('>query\n'+sequence+'\n>homolog\n'+sequence+'\n')};
    document.querySelector('#fold-ligand').value='c1ccccc1C(=O)[O-]';
    document.querySelector('#fold-recycles').value='0';
    document.querySelector('#fold-protein').click();
  })()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#fold-status').textContent.startsWith('Complete')
    ||document.querySelector('#fold-status').textContent.startsWith('Fold failed')`),180000,'actual UI inference');
  const status=await b.evaluate(`document.querySelector('#fold-status').textContent`);
  assert.match(status,/^Complete/);
  await b.evaluate(`document.querySelector('#download-fold-record').click()`);
  const record=await waitFor(async()=>JSON.parse(await readFile(join(download,'molarium-prediction.json'),'utf8')),15000,'record download');
  assert.equal(record.provenance.request.sequence,sequence);
  assert.equal(record.provenance.request.msaMode,'provided');
  assert.ok(record.provenance.alignmentSha256);assert.ok(record.plddt.length>0);assert.ok(record.pae.length>0);
  assert.equal(record.pae.length,record.confidenceLayout.tokens**2);
  const display=await b.evaluate(`({model:document.querySelector('#fold-model').value,
    sequence:document.querySelector('#protein-sequence').value,
    plddt:document.querySelector('#protein-plddt').textContent})`);
  assert.equal(display.sequence,sequence);
  if(cofold){assert.equal(record.component.atoms.length,9);assert.match(record.pdb,/HETATM/);
    assert.equal(record.confidenceLayout.pdbAtoms.length,162);}
  if(cofold)await waitFor(()=>b.evaluate(`Boolean(document.querySelector('#structure-2d-drawing svg'))`),20000,'ligand 2D depiction');
  await b.evaluate(`document.querySelector('#protein-fold-toggle').scrollIntoView({block:'start'})`);
  if(process.env.MOLARIUM_FOLD_SCREENSHOT)await writeFile(process.env.MOLARIUM_FOLD_SCREENSHOT,await b.capturePng());
  console.log(JSON.stringify({status,display,model:record.model,atoms:record.pdb.split('\n').filter(l=>/^(ATOM  |HETATM)/.test(l)).length,
    plddt:record.meanPlddt,ptm:record.ptm,iptm:record.iptm,paeEntries:record.pae.length,
    modelManifestSha256:record.provenance.modelManifestSha256,downloadDirectory:download}));
  console.log('Production CSP, real Fold button, supplied A3M and downloaded prediction record: PASS');
}finally{await b.close();server.stop(true);}
