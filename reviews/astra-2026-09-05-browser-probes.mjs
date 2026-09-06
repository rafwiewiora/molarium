// Isolated local Chrome profile and loopback-only server; no production writes.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startMolariumBrowser,waitFor} from '../scripts/headless-chrome.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const molecule={atoms:[{element:'C',x:0,y:0,z:0},{element:'C',x:1.5,y:0,z:0}],bonds:[],
  parameterization:{forcefield:'Synthetic review fixture',system:{particles:[{mass_amu:12},{mass_amu:12}],constraints:[],
    bonds:[{i:0,j:1,r0_nm:0.14,k_kj_nm2:1000}],angles:[],torsions:[],
    nonbonded:[{charge_e:0,sigma_nm:0.3,epsilon_kj:0.1},{charge_e:0,sigma_nm:0.3,epsilon_kj:0.1}],exceptions:[]}}};
const browser=await startMolariumBrowser({root,appPath:'benchmarks/simulation/runner.html'});
try{
  const result=await browser.evaluate(`(async()=>{
    const adapter=await navigator.gpu.requestAdapter();
    const run=options=>new Promise((resolve,reject)=>{
      const worker=new Worker('/stormm-worker.js',{type:'module'});
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('Review worker timeout'));},30000);
      worker.onmessage=({data})=>{if(data.type==='progress')return;clearTimeout(timer);worker.terminate();
        resolve({type:data.type,error:data.message,frameCount:data.frameCount,frameSteps:Array.from(data.frameSteps||[]),
          positionCount:data.positions?.length,initialEnergy:data.initialEnergy,finalEnergy:data.finalEnergy});};
      worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};
      worker.postMessage({type:'run',id:1,job:'dynamics',molecule:${JSON.stringify(molecule)},
        options:{stormmSystem:'current',replicaCount:1,steps:2,temperature:0,implicitSolvent:'none',savedFrameCount:2,...options}});
    });
    const control=await run({}),invalidFrames=await run({savedFrameCount:'not-a-number'}),unsupportedCutoff=await run({cutoffNm:0.8});
    const dotfile=await fetch('/.git');
    return {userAgent:navigator.userAgent,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},
      control,invalidFrames,unsupportedCutoff,gitMetadataRoute:{status:dotfile.status,bytes:(await dotfile.arrayBuffer()).byteLength}};
  })()`);
  await browser.client.call('Page.navigate',{url:new URL('/',browser.appUrl).href});
  await waitFor(()=>browser.evaluate('document.readyState === "complete" && Boolean(window.MolariumChemistActionsReady)'),20000,'public application');
  result.privacyPanel=await browser.evaluate(`(async()=>{
    const visible=()=>Boolean(document.querySelector('#project-info-dialog')?.open)
      && !document.querySelector('[data-project-section="privacy"]').classList.contains('hidden');
    document.querySelector('#network-policy-button').click();
    const immediate=visible(),start=performance.now();
    while(!visible()&&performance.now()-start<5000)await new Promise(resolve=>setTimeout(resolve,20));
    return {immediate,afterWaiting:visible()};
  })()`);
  const paths=['stormm-worker.js','stormm/core.mjs','stormm/engine.mjs','server.js','app.js'];
  const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,
    createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')])));
  const report={schema:'molarium.adversarial-browser-probes/v1',generatedAt:new Date().toISOString(),
    reviewedCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,findings:result};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
