import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root=resolve(import.meta.dirname,'../..');
const browser=await startMolariumBrowser({root,
  appPath:'design-history/structure-viewer/?story=at7519-hit-only-success&render=1&frame=0',
  width:1600,height:900});

const cameraState=(camera)=>({target:camera.target,position:camera.position,up:camera.up,
  radius:camera.radius,radiusMax:camera.radiusMax});
const assertFixedCamera=(expected,actual,label)=>{
  if(JSON.stringify(cameraState(actual))!==JSON.stringify(expected))
    throw Error(`${label} changed the fixed camera: ${JSON.stringify({expected,actual:cameraState(actual)})}`);
};
const execute=async(action,args,requestId)=>{
  const envelope=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action,args,requestId})})`);
  const frame=envelope.result.frame;
  await waitFor(async()=>browser.evaluate(`document.body.dataset.frame==='${frame}'
    && document.body.dataset.renderReady==='1'`),90000,requestId);
  return envelope.result;
};

try{
  await waitFor(async()=>browser.evaluate(`document.body.dataset.ready==='1'
    && document.body.dataset.renderReady==='1'`),90000,'AT7519 fixed-camera story');
  const initial=await execute('structureStory.inspect',{},'at7519-camera-initial');
  const expected=cameraState(initial.camera);
  const cueIds=['hit-only-start','scaffold-hop-predict-reveal','acetamide-predict-reveal',
    'benzamide-predict-reveal','torsion-lock-predict-reveal','candidate-predict-reveal','success'];
  for(const cueId of cueIds){
    const start=await execute('structureStory.selectCue',{cueId},`at7519-${cueId}-start`);
    assertFixedCamera(expected,start.camera,`${cueId} start`);
    if(start.refs.filter((ref)=>ref==='ligand').length!==1
      ||!start.refs.includes('protein')||!start.refs.includes('pocket'))
      throw Error(`${cueId} start violated the fixed-receptor one-ligand grammar: ${JSON.stringify(start)}`);
    const end=await execute('structureStory.selectFrame',{frame:start.cueEndFrame},
      `at7519-${cueId}-end`);
    assertFixedCamera(expected,end.camera,`${cueId} end`);
    if(end.refs.filter((ref)=>ref==='ligand').length!==1
      ||!end.refs.includes('protein')||!end.refs.includes('pocket'))
      throw Error(`${cueId} end violated the fixed-receptor one-ligand grammar: ${JSON.stringify(end)}`);
  }
  const audit=await browser.evaluate(`window.MolariumChemistActions.history()`);
  if(!cueIds.every((cueId)=>audit.some((entry)=>entry.action==='structureStory.selectCue'
    &&entry.args.cueId===cueId)))
    throw Error(`AT7519 public Agent API audit is incomplete: ${JSON.stringify(audit)}`);
  console.log('AT7519 browser test passed: one literal camera snapshot across every prediction and crystal cut');
}finally{await browser.close()}
