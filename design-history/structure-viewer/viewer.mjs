import { cameraFromView, expandStructureTimeline, interpolateCamera } from './timeline.mjs';
import { CHEMIST_ACTION_SCOPES, createChemistActionsApi } from '../../chemist-actions.mjs';

const OPTS={layoutIsExpanded:false,layoutShowControls:false,layoutShowRemoteState:false,
  layoutShowSequence:false,layoutShowLog:false,layoutShowLeftPanel:false,
  viewportShowExpand:false,viewportShowSelectionMode:false,viewportShowAnimation:false};
const CARBON=(value)=>({carbonColor:{name:'uniform',params:{value,saturation:0,lightness:0}}});
const ASSET_ROOT='../structures/generated/';
const STORY_REGISTRY=Object.freeze({
  'moonshot-dndi-6510':'./moonshot-dndi-6510.json',
  'bclxl-fragment-linking':'./bclxl-fragment-linking.json',
  'cdk2-hit-only-prospective':'./cdk2-hit-only-prospective.json',
  'cdk2-designer-hit-to-lead':'./cdk2-designer-hit-to-lead.json',
  'sos1-hit-only-success':'./sos1-hit-only-success.json',
});
const PREFIX={x1:'7gn8',x38:'7gnr-aligned',bclxl:'3spf',bclxlTemplate:'3sp7-aligned'};
const LIGAND_COLOR={x1:0x826cae,x38:0xdc8747,bclxl:0x247d95};
const BCLXL_STATES=Object.freeze({
  '4':{path:'3spf-ligand.pdb',format:'pdb',color:0x247d95},
  '6':{path:'bclxl-compound-6-reconstructed.mol',format:'mol',color:0x8d6ab8},
  '7':{path:'bclxl-compound-7-reconstructed.mol',format:'mol',color:0x527cb8},
  '16':{path:'bclxl-compound-16-reconstructed.mol',format:'mol',color:0x2d927e},
  '21':{path:'bclxl-compound-21-reconstructed.mol',format:'mol',color:0xdc8747},
});
const $=(id)=>document.getElementById(id);
let STORY,V,API,FRAMES=[],currentScene=null,currentFrame=0,refs={};
const cache=new Map();
const provenanceThemes=new Map();

const ELEMENT_COLORS=Object.freeze({
  H:0xffffff,N:0x3050f8,O:0xff0d0d,F:0x90e050,CL:0x1ff01f,BR:0xa62929,
  I:0x940094,S:0xffff30,P:0xff8000,
});

function provenanceTheme(model){
  const spec=model.provenance;
  if(!spec?.id||!Array.isArray(spec.addedAtomNames)||!spec.addedAtomNames.length)
    throw Error(`Model ${model.ref} has an invalid provenance color specification`);
  const name=`molarium-provenance-${spec.id}`;
  if(provenanceThemes.has(name))return name;
  const added=new Set(spec.addedAtomNames.map((value)=>String(value).trim()));
  const inheritedColor=Number.parseInt(String(spec.inheritedColor||'#826cae').replace(/^#/,''),16);
  const addedColor=Number.parseInt(String(spec.addedColor||'#28a7a1').replace(/^#/,''),16);
  const {Bond,StructureElement,StructureProperties}=molstar.lib.structure;
  const atomColor=(location)=>{
    const symbol=String(StructureProperties.atom.type_symbol(location)||'').toUpperCase();
    if(symbol!=='C')return ELEMENT_COLORS[symbol]??0xb8b8b8;
    const atomName=String(StructureProperties.atom.label_atom_id(location)
      ||StructureProperties.atom.auth_atom_id(location)||'').trim();
    return added.has(atomName)?addedColor:inheritedColor;
  };
  const factory=(ctx,props)=>{
    const scratch=StructureElement.Location.create(ctx.structure);
    return {factory,granularity:'group',props,color:(location)=>{
      if(StructureElement.Location.is(location))return atomColor(location);
      if(Bond.isLocation(location)){
        scratch.unit=location.aUnit;scratch.element=location.aUnit.elements[location.aIndex];
        return atomColor(scratch);
      }
      return inheritedColor;
    },description:'Inherited and newly added ligand atoms in one bonded representation'};
  };
  const provider={name,label:`Molarium provenance · ${spec.id}`,category:'Miscellaneous',
    factory,getParams:()=>({}),defaultValues:{},isApplicable:(ctx)=>!!ctx.structure};
  V.plugin.representation.structure.themes.colorThemeRegistry.add(provider);
  provenanceThemes.set(name,provider);return name;
}

function actionKeys(args, allowed) {
  const unexpected=Object.keys(args).filter((key)=>!allowed.includes(key));
  if(unexpected.length)throw Error(`Unexpected argument${unexpected.length===1?'':'s'}: ${unexpected.join(', ')}`);
}

async function textAsset(path){if(!cache.has(path))cache.set(path,fetch(path).then(response=>{
  if(!response.ok)throw Error(`${path}: ${response.status}`);return response.text()}));return cache.get(path)}
async function addRaw(path,fmt,ref,rep){
  const text=await textAsset(path),p=V.plugin,before=new Set();p.state.data.cells.forEach((_,id)=>before.add(id));
  const data=await p.builders.data.rawData({data:text,label:ref},{state:{isGhost:true}});
  const trajectory=await p.builders.structure.parseTrajectory(data,fmt);
  const model=await p.builders.structure.createModel(trajectory);
  const structure=await p.builders.structure.createStructure(model);
  const component=await p.builders.structure.tryCreateComponentStatic(structure,'all')
    ||await p.builders.structure.tryCreateComponentStatic(structure,'polymer');
  if(component)await p.builders.structure.representation.addRepresentation(component,rep);
  p.state.data.cells.forEach((cell,id)=>{if(!before.has(id)&&before.has(cell.transform.parent))refs[ref]=id});
}
async function removeRef(ref){if(!refs[ref])return;try{const update=V.plugin.state.data.build();update.delete(refs[ref]);await update.commit()}catch(_){}delete refs[ref]}
async function clearScene(){for(const ref of Object.keys(refs))await removeRef(ref)}
function sceneModels(sceneName,trail=[]){
  if(trail.includes(sceneName))throw Error(`Scene inheritance cycle: ${[...trail,sceneName].join(' → ')}`);
  const scene=STORY.scenes[sceneName];if(!scene)throw Error(`Unknown scene ${sceneName}`);
  return [...(scene.extends?sceneModels(scene.extends,[...trail,sceneName]):[]),...(scene.models||[])];
}
async function buildScene(sceneName){
  if(sceneName===currentScene)return;document.body.dataset.renderReady='pending';await clearScene();
  const scene=STORY.scenes[sceneName];if(!scene)throw Error(`Unknown scene ${sceneName}`);
  for(const model of sceneModels(sceneName)){
    if(!model?.path||!model?.ref)throw Error(`Scene ${sceneName} has an invalid model`);
    const color=typeof model.color==='string'
      ? Number.parseInt(model.color.replace(/^#/,''),16):model.color;
    const representation=model.representation||'ball-and-stick';
    const typeParams={alpha:model.alpha??1,
      ...(Number.isFinite(model.sizeFactor)?{sizeFactor:model.sizeFactor}:{}),
      ...(representation==='ball-and-stick'
        ?{sizeFactor:model.sizeFactor??.22,aromaticBonds:false}:{}),
      ...(model.typeParams||{})};
    const rep={type:representation,typeParams,
      color:model.provenance?provenanceTheme(model):(model.colorScheme||'element-symbol')};
    if(Number.isFinite(color))rep.colorParams=CARBON(color);
    await addRaw(`${ASSET_ROOT}${model.path}`,model.format||'pdb',model.ref,rep);
  }
  if(scene.protein){const prefix=PREFIX[scene.protein];if(!prefix)throw Error(`Unknown protein ${scene.protein}`);await addRaw(`${ASSET_ROOT}${prefix}-protein.pdb`,'pdb','protein',
    {type:'cartoon',typeParams:{alpha:.26},color:'chain-id'})}
  if(scene.pocket){const prefix=PREFIX[scene.pocket];if(!prefix)throw Error(`Unknown pocket ${scene.pocket}`);await addRaw(`${ASSET_ROOT}${prefix}-pocket.pdb`,'pdb','pocket',
    {type:'ball-and-stick',typeParams:{alpha:.72,sizeFactor:.16,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0x5f7289)})}
  if(scene.x1)await addRaw(`${ASSET_ROOT}7gn8-ligand.pdb`,'pdb','x1',
    {type:'ball-and-stick',typeParams:{alpha:scene.x38 ? .62 : 1,sizeFactor:.24,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0x826cae)});
  if(scene.x38)await addRaw(`${ASSET_ROOT}7gnr-aligned-ligand.pdb`,'pdb','x38',
    {type:'ball-and-stick',typeParams:{alpha:1,sizeFactor:.24,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0xdc8747)});
  if(scene.bclxl||scene.bclxlState){const state=BCLXL_STATES[String(scene.bclxlState||'4')];
    if(!state)throw Error(`Unknown BCL-xL trajectory state ${scene.bclxlState}`);
    await addRaw(`${ASSET_ROOT}${state.path}`,state.format,'bclxl',
      {type:'ball-and-stick',typeParams:{alpha:1,sizeFactor:.2,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(state.color)});}
  if(scene.interactions){const prefix=scene.interactions==='x1'?'7gn8':'7gnr-aligned';await addRaw(`${ASSET_ROOT}${prefix}-interactions.mol`,'mol','interactions',
    {type:'line',typeParams:{alpha:.96,sizeFactor:1.8,aromaticBonds:false},color:'uniform',colorParams:{value:0x54b8c8}})}
  currentScene=sceneName;document.body.dataset.scene=sceneName;
}
function setCamera(camera){const base=V.plugin.canvas3d.camera.getSnapshot();V.plugin.canvas3d.camera.setState({...base,...camera},0)}
const afterPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function paintCallouts(cue){
  const layer=$('story-callouts');layer.replaceChildren();
  for(const callout of cue.callouts||[]){
    if(!callout?.label||!Number.isFinite(callout.x)||!Number.isFinite(callout.y))continue;
    const item=document.createElement('div');
    const tone=['protein','danger','success'].includes(callout.tone)?callout.tone:'';
    item.className=`story-callout ${tone}`.trim();
    item.style.left=`${Math.max(0,Math.min(100,callout.x))}%`;
    item.style.top=`${Math.max(0,Math.min(100,callout.y))}%`;
    const dot=document.createElement('i'),label=document.createElement('span');
    label.textContent=callout.label;item.append(dot,label);layer.append(item);
  }
  const card=$('decision-card'),decision=cue.decisionCard;
  card.replaceChildren();card.hidden=!decision;
  if(!decision)return;
  const heading=document.createElement('h2');heading.textContent=decision.title||'Decision';card.append(heading);
  for(const row of decision.rows||[]){
    const item=document.createElement('div');
    item.className=`decision-row ${['reject','select','backup'].includes(row.status)?row.status:''}`.trim();
    const label=document.createElement('b'),value=document.createElement('span');
    label.textContent=row.label||'';value.textContent=row.value||'';item.append(label,value);card.append(item);
  }
  if(decision.note){const note=document.createElement('div');note.className='decision-note';
    note.textContent=decision.note;card.append(note)}
}
function paint(frame){
  const cue=STORY.cues[frame.cueIndex];currentFrame=frame.frame;$('timeline').value=String(frame.frame);
  $('cue-count').textContent=`Shot ${frame.cueIndex+1} of ${STORY.cues.length}`;$('cue-title').textContent=cue.title;
  $('cue-body').textContent=cue.body;$('cue-detail').textContent=cue.detail;
  $('progress').style.width=`${((frame.frame+1)/FRAMES.length)*100}%`;
  const scene=STORY.scenes[frame.scene];$('structure-label').textContent=scene.label||'Experimental structure';
  const coordinateClass=$('coordinate-class');coordinateClass.textContent=scene.coordinateLabel||'Experimental coordinates';
  coordinateClass.className=`badge ${scene.coordinateClass||'experimental'}`;
  const focusMarker=$('focus-marker');focusMarker.hidden=!cue.focusLabel;
  focusMarker.style.left=`${cue.focusPosition?.[0]??50}%`;
  focusMarker.style.top=`${cue.focusPosition?.[1]??50}%`;
  $('focus-label').textContent=cue.focusLabel||'';document.body.dataset.focus=cue.focusLabel||'';
  paintCallouts(cue);
  document.body.dataset.frame=String(frame.frame);document.body.dataset.cue=String(frame.cueIndex);
}
async function selectFrameNow(index){
  const frame=FRAMES[index];if(!frame)throw Error(`Frame ${index} does not exist`);
  const sceneChanged=frame.scene!==currentScene;
  await buildScene(frame.scene);const cue=STORY.cues[frame.cueIndex];
  const start=cameraFromView(STORY.cameras[cue.cameraStart]),end=cameraFromView(STORY.cameras[cue.cameraEnd]);
  const camera=interpolateCamera(start,end,frame.cueProgress);setCamera(camera);
  if(sceneChanged){await afterPaint();setCamera(camera)}
  paint(frame);await afterPaint();document.body.dataset.renderReady='1';
  return frame.frame;
}
function cueStart(index){return FRAMES.find((frame)=>frame.cueIndex===Math.max(0,Math.min(STORY.cues.length-1,index)))?.frame||0}
function inspectStory(){
  const frame=FRAMES[currentFrame],cue=STORY?.cues?.[frame?.cueIndex];
  const cueFrames=FRAMES.filter((entry)=>entry.cueIndex===frame?.cueIndex);
  return { storyId:STORY?.id||null,title:STORY?.title||null,frame:frame?.frame??null,
    totalFrames:FRAMES.length,cueId:cue?.id||null,cueIndex:frame?.cueIndex??null,
    cueStartFrame:cueFrames[0]?.frame??null,cueEndFrame:cueFrames.at(-1)?.frame??null,
    focusLabel:cue?.focusLabel||null,scene:currentScene,refs:Object.keys(refs),
    camera:V?.plugin?.canvas3d?.camera?.getSnapshot?.()||null };
}
async function loadStory(storyId){
  const path=STORY_REGISTRY[storyId];if(!path)throw Error(`Unknown registered structure story ${storyId}`);
  document.body.dataset.renderReady='pending';await clearScene();currentScene=null;
  const story=await fetch(path).then(response=>{if(!response.ok)throw Error(`story: ${response.status}`);return response.json()});
  if(story?.schema!=='molarium.structure-story/v1'||story.id!==storyId)
    throw Error(`Registered structure story ${storyId} has an invalid identity`);
  if(!Array.isArray(story.cues)||!story.cues.length||story.cues.some((cue)=>!cue.id))
    throw Error(`Registered structure story ${storyId} requires persistent cue IDs`);
  if(new Set(story.cues.map((cue)=>cue.id)).size!==story.cues.length)
    throw Error(`Registered structure story ${storyId} has duplicate cue IDs`);
  STORY=story;FRAMES=expandStructureTimeline(STORY);currentFrame=0;
  $('story-title').textContent=STORY.title;$('story-subtitle').textContent=STORY.subtitle;
  $('timeline').max=String(FRAMES.length-1);$('timeline').value='0';
  $('sources').innerHTML=STORY.sources.map(source=>`<a href="${source.url}" target="_blank" rel="noreferrer">${source.label}</a>`).join('');
  $('legend').innerHTML=(STORY.legend||[]).map(entry=>`<span class="key"><i class="dot" style="background:${entry.color}"></i>${entry.label}</span>`).join('');
  await selectFrameNow(0);return inspectStory();
}
function storyRoutes(){return {
  'structureStory.load':async(args)=>{actionKeys(args,['storyId']);
    if(typeof args.storyId!=='string'||!args.storyId)throw Error('storyId must be a registered structure-story ID');
    return loadStory(args.storyId)},
  'structureStory.selectCue':async(args)=>{actionKeys(args,['cueId']);
    if(typeof args.cueId!=='string'||!args.cueId)throw Error('cueId must be a persistent cue ID');
    const cueIndex=STORY?.cues?.findIndex((cue)=>cue.id===args.cueId)??-1;
    if(cueIndex<0)throw Error(`Cue ${args.cueId} does not exist in the loaded story`);
    await selectFrameNow(cueStart(cueIndex));return inspectStory()},
  'structureStory.selectFrame':async(args)=>{actionKeys(args,['frame']);
    if(!Number.isInteger(args.frame)||args.frame<0||args.frame>=FRAMES.length)
      throw Error(`frame must be an integer from 0 to ${Math.max(0,FRAMES.length-1)}`);
    await selectFrameNow(args.frame);return inspectStory()},
  'structureStory.inspect':async(args)=>{actionKeys(args,[]);return inspectStory()},
}}
function execute(action,args={},requestId=null){return API.execute({action,args,...(requestId?{requestId}:{})})}
function selectFrame(index){return execute('structureStory.selectFrame',{frame:Number(index)})}
function stepCue(delta){const cue=FRAMES[currentFrame]?.cueIndex||0;
  const index=Math.max(0,Math.min(STORY.cues.length-1,cue+delta));
  return execute('structureStory.selectCue',{cueId:STORY.cues[index].id})}
async function init(){
  const params=new URLSearchParams(location.search);if(params.get('render')==='1')document.body.classList.add('render');
  V=await molstar.Viewer.create('viewer',OPTS);try{V.plugin.canvas3d.setProps({camera:{helper:{axes:{name:'off',params:{}}}},renderer:{backgroundColor:0xffffff}})}catch(_){}
  const resize=()=>{try{V.plugin.canvas3d.handleResize()}catch(_){}};addEventListener('resize',resize);try{new ResizeObserver(resize).observe($('viewer'))}catch(_){}
  API=createChemistActionsApi({routes:storyRoutes(),enabledActions:CHEMIST_ACTION_SCOPES.structureStory,
    historyLimit:10000});
  Object.defineProperty(window,'MolariumChemistActions',{value:API,enumerable:true,
    configurable:false,writable:false});
  $('timeline').addEventListener('input',()=>selectFrame($('timeline').value));$('previous').addEventListener('click',()=>stepCue(-1));$('next').addEventListener('click',()=>stepCue(1));
  addEventListener('keydown',(event)=>{if(event.key==='ArrowLeft'){event.preventDefault();stepCue(-1)}else if(event.key==='ArrowRight'){event.preventDefault();stepCue(1)}});
  const storyId=params.get('story')||'moonshot-dndi-6510';
  await execute('structureStory.load',{storyId},'viewer-load');
  const initialFrame=Number(params.get('frame'))||0;
  if(initialFrame!==0)await execute('structureStory.selectFrame',{frame:initialFrame},'viewer-initial-frame');
  $('boot').style.display='none';document.body.dataset.ready='1';
  return API;
}
const ready=init().catch(error=>{$('boot').style.display='none';$('error').style.display='grid';$('error').textContent=error?.stack||String(error);document.body.dataset.ready='error';throw error});
Object.defineProperty(window,'MolariumChemistActionsReady',{value:ready,enumerable:true,
  configurable:false,writable:false});
