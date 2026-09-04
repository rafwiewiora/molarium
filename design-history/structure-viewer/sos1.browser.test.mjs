import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root=resolve(import.meta.dirname,'../..');
const browser=await startMolariumBrowser({root,
  appPath:'design-history/structure-viewer/?story=sos1-hit-to-bay293-review&render=1&frame=0',
  width:1600,height:900});

const selectCue=async(cueId)=>{
  const selected=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action:'structureStory.selectCue',args:{cueId},requestId:`sos1-test-${cueId}`})})`);
  await waitFor(async()=>browser.evaluate(`document.body.dataset.frame==='${selected.result.frame}'
    && document.body.dataset.renderReady==='1'`),90000,`SOS1 ${cueId}`);
  return selected.result;
};

try{
  await waitFor(async()=>browser.evaluate(`['1','error'].includes(document.body.dataset.ready||'')`),
    90000,'SOS1 accepted prediction checkpoint review');
  const steps=['scaffold-rewrite','fragment-merge','open-phe890-pocket','finish-bay-293'];
  for(const stepId of steps){
    const checkpoint=await selectCue(`${stepId}-checkpoint`);
    for(const suffix of ['pocket','ligand','phe890']){
      const ref=`${stepId}-${suffix}`;
      if(!checkpoint.refs.includes(ref))
        throw Error(`SOS1 ${stepId} is missing ${ref}: ${JSON.stringify(checkpoint)}`);
    }
    if(checkpoint.checkpoint?.stepId!==stepId
      ||checkpoint.checkpoint?.sourceAction!=='session.inspect')
      throw Error(`SOS1 ${stepId} lost its frozen-checkpoint binding: ${JSON.stringify(checkpoint)}`);
    if(checkpoint.precomputedReview?.calculationPolicy!=='never-run')
      throw Error(`SOS1 review exposed a calculation path: ${JSON.stringify(checkpoint)}`);
  }

  const audit=await browser.evaluate(`window.MolariumChemistActions.history()`);
  if(!audit.some((entry)=>entry.action==='structureStory.selectCue'
    &&entry.args.cueId==='open-phe890-pocket-checkpoint'))
    throw Error(`SOS1 public Agent API audit is incomplete: ${JSON.stringify(audit)}`);
  console.log('SOS1 accepted checkpoint review passed: four frozen prediction states, no calculation or holdout scene');
}finally{await browser.close()}
