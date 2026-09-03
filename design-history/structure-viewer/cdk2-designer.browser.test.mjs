import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root=resolve(import.meta.dirname,'../..');
const browser=await startMolariumBrowser({root,
  appPath:'design-history/structure-viewer/?story=cdk2-designer-hit-to-lead&render=1&frame=0',
  width:1600,height:900});

const cameraState=(camera)=>({target:camera.target,position:camera.position,up:camera.up,
  radius:camera.radius,radiusMax:camera.radiusMax});
const execute=async(action,args,requestId)=>{
  const envelope=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action,args,requestId})})`);
  const frame=envelope.result.frame;
  await waitFor(async()=>browser.evaluate(`document.body.dataset.frame==='${frame}'
    &&document.body.dataset.renderReady==='1'`),90000,requestId);
  return envelope.result;
};
const assertFrame=(state,expectedCamera,label)=>{
  if(JSON.stringify(cameraState(state.camera))!==JSON.stringify(expectedCamera))
    throw Error(`${label} changed the master camera: ${JSON.stringify(state.camera)}`);
  if(!state.refs.includes('protein')||!state.refs.includes('pocket'))
    throw Error(`${label} dropped the fixed hit-derived receptor: ${JSON.stringify(state.refs)}`);
  const ligandRefs=state.refs.filter((ref)=>['hit','prediction','crystal'].includes(ref));
  if(ligandRefs.length!==1)
    throw Error(`${label} must show exactly one ligand, received ${JSON.stringify(ligandRefs)}`);
};

try{
  await waitFor(async()=>browser.evaluate(`document.body.dataset.ready==='1'
    &&document.body.dataset.renderReady==='1'`),90000,'CDK2 designer success story');
  const initial=await execute('structureStory.inspect',{},'cdk2-designer-initial');
  const expectedCamera=cameraState(initial.camera);
  const cueIds=['hit-pose','select-c19','grow-chlorine','validate-6cp','carry-forward',
    'select-c19-again','grow-sulfonamide','validate-n76','success'];
  for(const cueId of cueIds){
    const start=await execute('structureStory.selectCue',{cueId},`cdk2-${cueId}-start`);
    assertFrame(start,expectedCamera,`${cueId} start`);
    const end=await execute('structureStory.selectFrame',{frame:start.cueEndFrame},
      `cdk2-${cueId}-end`);
    assertFrame(end,expectedCamera,`${cueId} end`);
  }
  const audit=await browser.evaluate(`window.MolariumChemistActions.history()`);
  if(!cueIds.every((cueId)=>audit.some((entry)=>entry.action==='structureStory.selectCue'
    &&entry.args.cueId===cueId)))
    throw Error(`CDK2 public Agent API audit is incomplete: ${JSON.stringify(audit)}`);
  console.log('CDK2 designer story browser test passed: one camera, one hit-derived receptor, one ligand per frame');
}finally{await browser.close()}
