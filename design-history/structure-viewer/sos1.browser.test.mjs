import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root=resolve(import.meta.dirname,'../..');
const browser=await startMolariumBrowser({root,
  appPath:'design-history/structure-viewer/?story=sos1-hit-only-success&render=1&frame=0',
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
    90000,'SOS1 full fragment-to-lead structure story');
  const hit=await selectCue('hit-only-start');
  for(const ref of ['protein','pocket','hit','phe-peptide','phe-highlight'])
    if(!hit.refs.includes(ref))throw Error(`SOS1 hit opening is missing ${ref}: ${JSON.stringify(hit)}`);

  const rewrite=await selectCue('awt-frozen-prediction');
  for(const ref of ['pocket','ligand','phe-peptide','phe-highlight'])
    if(!rewrite.refs.includes(ref))throw Error(`SOS1 scaffold rewrite is missing ${ref}: ${JSON.stringify(rewrite)}`);
  if(rewrite.refs.includes('inherited')||rewrite.refs.includes('added'))
    throw Error(`SOS1 scaffold rewrite contains disconnected visual partitions: ${JSON.stringify(rewrite)}`);

  const growth=await selectCue('grow-into-phe890');
  for(const ref of ['pocket','ligand','phe-peptide','phe-highlight','clashes'])
    if(!growth.refs.includes(ref))throw Error(`SOS1 growth is missing ${ref}: ${JSON.stringify(growth)}`);

  const flip=await selectCue('phe890-flip-slow-motion');
  const flipEnd=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action:'structureStory.selectFrame',args:{frame:'__FRAME__'},requestId:'sos1-test-flip-end',
  }).replace('"__FRAME__"',String(flip.cueEndFrame))})`);
  if(flipEnd.result.scene!=='pheFlip8'
    ||flipEnd.result.refs.filter((ref)=>ref==='ligand').length!==1
    ||flipEnd.result.refs.filter((ref)=>ref==='phe-highlight').length!==1
    ||!flipEnd.result.refs.includes('phe-peptide'))
    throw Error(`SOS1 flip endpoint failed: ${JSON.stringify(flipEnd.result)}`);

  const finalEdit=await selectCue('grow-bay-293');
  for(const ref of ['pocket','ligand','phe-peptide','phe-highlight'])
    if(!finalEdit.refs.includes(ref))throw Error(`SOS1 final edit is missing ${ref}: ${JSON.stringify(finalEdit)}`);
  const reveal=await selectCue('reveal-5ovi');
  const revealEnd=await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action:'structureStory.selectFrame',args:{frame:'__FRAME__'},requestId:'sos1-test-reveal-end',
  }).replace('"__FRAME__"',String(reveal.cueEndFrame))})`);
  if(revealEnd.result.scene!=='axhValidation'||revealEnd.result.refs.includes('ligand')
    ||!revealEnd.result.refs.includes('crystal')||!revealEnd.result.refs.includes('phe-highlight')
    ||!revealEnd.result.refs.includes('phe-peptide'))
    throw Error(`SOS1 post-freeze crystal reveal failed: ${JSON.stringify(revealEnd.result)}`);

  const audit=await browser.evaluate(`window.MolariumChemistActions.history()`);
  if(!audit.some((entry)=>entry.action==='structureStory.selectCue'
    &&entry.args.cueId==='grow-into-phe890'))
    throw Error(`SOS1 public Agent API audit is incomplete: ${JSON.stringify(audit)}`);
  console.log('SOS1 full story browser test passed: 5OVE hit → Agent API growth → predicted Phe890 motion → clean crystal reveal');
}finally{await browser.close()}
