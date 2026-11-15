// Browser/IndexedDB/visual contract test. Provider responses are fixtures;
// this never contacts a model endpoint or counts as neural inference.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..');
const pdb=await readFile(resolve(root,'test/fixtures/7kpa.pdb'),'utf8');
const key='nvapi-'+ 'browserFixture'.repeat(3);
const install=`(()=>{
 const original=globalThis.fetch.bind(globalThis),pdb=${JSON.stringify(pdb)};
 globalThis.fixtureMode='wait';
 globalThis.fetch=async(url,options={})=>{
  const path=String(url);
  if(!path.startsWith('/api/cofold/nvidia/'))return original(url,options);
  const calls=JSON.parse(localStorage.getItem('hosted-fixture-calls')||'[]');
  calls.push({path,method:options.method});localStorage.setItem('hosted-fixture-calls',JSON.stringify(calls));
  if(path.endsWith('/submit')){
   if(globalThis.fixtureMode==='lost')throw Error('Synthetic lost submission response');
   const n=calls.filter(c=>c.method==='POST').length;
   return Response.json({status:'queued',requestId:'12345678-1234-1234-1234-'+String(n).padStart(12,'0')},{status:202});
  }
  if(globalThis.fixtureMode==='wait')return new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(new DOMException('Paused','AbortError')),{once:true});
  });
  return Response.json({status:'complete',requestId:path.split('/').pop(),data:{
   structures:[{format:'pdb',structure:pdb},{format:'pdb',structure:pdb}],confidence_scores:[.7,.8]}});
 };
})()`;
const b=await startMolariumBrowser({root,appPath:'server-cofolding.html',localOnly:false,width:1440,height:1100});
try{
 await waitFor(()=>b.evaluate('Boolean(window.MolariumHosted)'),30000,'hosted UI');
 await b.client.call('Page.addScriptToEvaluateOnNewDocument',{source:install});
 await b.evaluate(install);
 await b.evaluate(`document.querySelector('#model').value='openfold3';document.querySelector('#model').dispatchEvent(new Event('change'));`);
 assert.deepEqual(await b.evaluate(`['steps-label','recycles-label'].map(id=>document.getElementById(id).hidden)`),[true,true]);
 assert.equal(await b.evaluate(`document.querySelector('#samples').max`),'5');
 await b.evaluate(`document.querySelector('#model').value='boltz2';document.querySelector('#model').dispatchEvent(new Event('change'));
 document.querySelector('#api-key').value=${JSON.stringify(key)};
 window.fixtureStart=MolariumHosted.start({name:'Browser contract fixture',sequence:'ACDEFG',compounds:'CCO ethanol\\nc1ccccc1 benzene',samples:2,msaMode:'single'}).catch(e=>({error:e.message}));true;`);
 await waitFor(()=>b.evaluate(`JSON.parse(localStorage.getItem('hosted-fixture-calls')||'[]').some(c=>c.method==='GET')`),10000,'accepted IDs');
 await b.evaluate('MolariumHosted.pause()');await b.evaluate('window.fixtureStart');
 const saved=await b.evaluate('MolariumHosted.export()');
 assert.equal(saved.jobs.length,2);assert.ok(saved.jobs.every(j=>j.status==='queued'&&j.providerRequestId));
 assert.equal(saved.run.status,'paused');assert.ok(!JSON.stringify(saved).includes(key));
 const id=saved.run.id;
 await b.client.call('Page.reload');
 await waitFor(()=>b.evaluate('Boolean(window.MolariumHosted)'),30000,'reloaded UI');
 assert.equal(await b.evaluate(`document.querySelector('#api-key').value`),'');
 await assert.rejects(b.evaluate(`MolariumHosted.resume(${JSON.stringify(id)})`),/API key/);
 await b.evaluate(`(async()=>{document.querySelector('#api-key').value=${JSON.stringify(key)};globalThis.fixtureMode='complete';
 await MolariumHosted.resume(${JSON.stringify(id)});})()`);
 const result=await b.evaluate('MolariumHosted.export()');
 assert.equal(result.run.status,'complete');assert.equal(result.run.lastError,null);
 assert.equal(result.jobs.reduce((n,j)=>n+j.structures.length,0),4);
 assert.ok(result.jobs.every(j=>j.rawResponse.confidence_scores[1]===.8));
 assert.equal(await b.evaluate(`JSON.parse(localStorage.getItem('hosted-fixture-calls')).filter(c=>c.method==='POST').length`),2);
 assert.equal(await b.evaluate(`JSON.stringify(localStorage).includes(${JSON.stringify(key)})`),false);
 assert.ok(!JSON.stringify(result).includes(key));
 await b.evaluate(`document.querySelector('[data-sample="0"]').click()`);
 await waitFor(()=>b.evaluate(`document.querySelector('#viewer').dataset.state==='ready'`),30000,'parsed original structure with viewable atoms');
 assert.equal(await b.evaluate(`document.querySelector('#error').hidden`),true);
 await b.evaluate(`document.querySelector('#note').value='Locally preferred fixture pose';document.querySelector('[data-choice="preferred"]').click();`);
 await waitFor(()=>b.evaluate(`MolariumHosted.export().then(b=>b.jobs.some(j=>Object.values(j.decisions).some(d=>d.value==='preferred')))`),10000,'saved human choice');
 const reviewed=await b.evaluate('MolariumHosted.export()');
 const choice=reviewed.jobs.flatMap(j=>Object.values(j.decisions)).find(d=>d.value==='preferred');
 assert.equal(choice.note,'Locally preferred fixture pose');assert.equal(choice.structureSha256.length,64);
 await b.evaluate(`window.reviewedFixture=${JSON.stringify(reviewed)}`);
 await assert.rejects(b.evaluate(`(async()=>{const v=structuredClone(window.reviewedFixture);v.jobs[0].structures[0].structure+='tampered';await MolariumHosted.import(v);})()`),/integrity check/);
 await assert.rejects(b.evaluate(`MolariumHosted.import(window.reviewedFixture)`),/already exists/);
 await b.evaluate(`(async()=>{const v=structuredClone(window.reviewedFixture);v.run.id=crypto.randomUUID();for(const j of v.jobs){j.runId=v.run.id;j.id=v.run.id+'::'+j.compound.id;}await MolariumHosted.import(v);})()`);
 assert.equal((await b.evaluate('MolariumHosted.export()')).run.retrieveOnly,true);
 assert.equal((await b.evaluate('MolariumHosted.export()')).jobs.flatMap(j=>Object.values(j.decisions)).filter(d=>d.value==='preferred').length,1);
 if(process.env.MOLARIUM_HOSTED_SCREENSHOT)await writeFile(process.env.MOLARIUM_HOSTED_SCREENSHOT,await b.capturePng());
 await b.client.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 assert.ok(await b.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),'Mobile layout must not overflow');
 await b.evaluate(`(async()=>{globalThis.fixtureMode='lost';await MolariumHosted.start({sequence:'ACDEFG',compounds:'CCO uncertain',msaMode:'single'}).catch(()=>{});})()`);
 assert.equal((await b.evaluate('MolariumHosted.export()')).jobs[0].status,'submission-unknown');
 const calls=await b.evaluate(`JSON.parse(localStorage.getItem('hosted-fixture-calls')).length`);
 await assert.rejects(b.evaluate(`(async()=>MolariumHosted.resume((await MolariumHosted.export()).run.id))()`),/unknown outcome/);
 assert.equal(await b.evaluate(`JSON.parse(localStorage.getItem('hosted-fixture-calls')).length`),calls);
 // Validate the actual application relay route without sending any provider request.
 assert.equal((await fetch(new URL('/api/cofold/nvidia/submit',b.appUrl),{method:'POST'})).status,401);
 console.log('Hosted browser contract: queued IDs survive reload, GET-only recovery, original structures, local choices, no persisted key, mobile layout, unknown POST blocked. PASS');
}finally{await b.close();}
const local=await startMolariumBrowser({root,appPath:'server-cofolding.html',localOnly:true});
try{
 await waitFor(()=>local.evaluate('Boolean(window.MolariumHosted)'),30000,'Local Lab hosted UI');
 assert.equal(await local.evaluate(`document.querySelector('#start').disabled`),true);
 await assert.rejects(local.evaluate(`MolariumHosted.start({sequence:'ACD',compounds:'CCO one'})`),/connected mode/);
 const response=await fetch(new URL('/api/cofold/nvidia/submit',local.appUrl),{method:'POST',headers:{Authorization:'Bearer '+key}});
 assert.equal(response.status,403);
 console.log('Local Lab client + actual relay deny server folding: PASS');
}finally{await local.close();}
