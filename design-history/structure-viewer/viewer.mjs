import { cameraFromView, expandStructureTimeline, interpolateCamera } from './timeline.mjs';

const OPTS={layoutIsExpanded:false,layoutShowControls:false,layoutShowRemoteState:false,
  layoutShowSequence:false,layoutShowLog:false,layoutShowLeftPanel:false,
  viewportShowExpand:false,viewportShowSelectionMode:false,viewportShowAnimation:false};
const CARBON=(value)=>({carbonColor:{name:'uniform',params:{value,saturation:0,lightness:0}}});
const ASSET_ROOT='../structures/generated/';
const PREFIX={x1:'7gn8',x38:'7gnr-aligned',bclxl:'3spf'};
const LIGAND_COLOR={x1:0x826cae,x38:0xdc8747,bclxl:0x247d95};
const $=(id)=>document.getElementById(id);
let STORY,V,FRAMES=[],currentScene=null,currentFrame=0,refs={},serial=Promise.resolve();
const cache=new Map();

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
async function buildScene(sceneName){
  if(sceneName===currentScene)return;document.body.dataset.renderReady='pending';await clearScene();
  const scene=STORY.scenes[sceneName];if(!scene)throw Error(`Unknown scene ${sceneName}`);
  if(scene.protein){const prefix=PREFIX[scene.protein];if(!prefix)throw Error(`Unknown protein ${scene.protein}`);await addRaw(`${ASSET_ROOT}${prefix}-protein.pdb`,'pdb','protein',
    {type:'cartoon',typeParams:{alpha:.26},color:'chain-id'})}
  if(scene.pocket){const prefix=PREFIX[scene.pocket];if(!prefix)throw Error(`Unknown pocket ${scene.pocket}`);await addRaw(`${ASSET_ROOT}${prefix}-pocket.pdb`,'pdb','pocket',
    {type:'ball-and-stick',typeParams:{alpha:.72,sizeFactor:.16,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0x5f7289)})}
  if(scene.x1)await addRaw(`${ASSET_ROOT}7gn8-ligand.pdb`,'pdb','x1',
    {type:'ball-and-stick',typeParams:{alpha:scene.x38 ? .62 : 1,sizeFactor:.24,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0x826cae)});
  if(scene.x38)await addRaw(`${ASSET_ROOT}7gnr-aligned-ligand.pdb`,'pdb','x38',
    {type:'ball-and-stick',typeParams:{alpha:1,sizeFactor:.24,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(0xdc8747)});
  if(scene.bclxl)await addRaw(`${ASSET_ROOT}3spf-ligand.pdb`,'pdb','bclxl',
    {type:'ball-and-stick',typeParams:{alpha:1,sizeFactor:.24,aromaticBonds:false},color:'element-symbol',colorParams:CARBON(LIGAND_COLOR.bclxl)});
  if(scene.interactions){const prefix=scene.interactions==='x1'?'7gn8':'7gnr-aligned';await addRaw(`${ASSET_ROOT}${prefix}-interactions.mol`,'mol','interactions',
    {type:'line',typeParams:{alpha:.96,sizeFactor:1.8,aromaticBonds:false},color:'uniform',colorParams:{value:0x54b8c8}})}
  currentScene=sceneName;document.body.dataset.scene=sceneName;
}
function setCamera(camera){const base=V.plugin.canvas3d.camera.getSnapshot();V.plugin.canvas3d.camera.setState({...base,...camera},0)}
const afterPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function paint(frame){
  const cue=STORY.cues[frame.cueIndex];currentFrame=frame.frame;$('timeline').value=String(frame.frame);
  $('cue-count').textContent=`Scene ${frame.cueIndex+1} of ${STORY.cues.length}`;$('cue-title').textContent=cue.title;
  $('cue-body').textContent=cue.body;$('cue-detail').textContent=cue.detail;
  $('progress').style.width=`${((frame.frame+1)/FRAMES.length)*100}%`;
  const scene=STORY.scenes[cue.scene];$('structure-label').textContent=scene.label||'Experimental structure';
  document.body.dataset.frame=String(frame.frame);document.body.dataset.cue=String(frame.cueIndex);
}
async function selectFrameNow(index){
  const frame=FRAMES[Math.max(0,Math.min(FRAMES.length-1,Number(index)||0))];
  await buildScene(frame.scene);const cue=STORY.cues[frame.cueIndex];
  const start=cameraFromView(STORY.cameras[cue.cameraStart]),end=cameraFromView(STORY.cameras[cue.cameraEnd]);
  setCamera(interpolateCamera(start,end,frame.cueProgress));paint(frame);await afterPaint();document.body.dataset.renderReady='1';
  return frame.frame;
}
function selectFrame(index){serial=serial.then(()=>selectFrameNow(index));return serial}
function cueStart(index){return FRAMES.find((frame)=>frame.cueIndex===Math.max(0,Math.min(STORY.cues.length-1,index)))?.frame||0}
function stepCue(delta){const cue=FRAMES[currentFrame]?.cueIndex||0;return selectFrame(cueStart(cue+delta))}
async function init(){
  const params=new URLSearchParams(location.search);if(params.get('render')==='1')document.body.classList.add('render');
  const storyId=(params.get('story')||'moonshot-dndi-6510').replace(/[^a-z0-9-]/g,'');
  STORY=await fetch(`./${storyId}.json`).then(response=>{if(!response.ok)throw Error(`story: ${response.status}`);return response.json()});
  FRAMES=expandStructureTimeline(STORY);$('story-title').textContent=STORY.title;$('story-subtitle').textContent=STORY.subtitle;
  $('timeline').max=String(FRAMES.length-1);$('sources').innerHTML=STORY.sources.map(source=>`<a href="${source.url}" target="_blank" rel="noreferrer">${source.label}</a>`).join('');
  $('legend').innerHTML=(STORY.legend||[]).map(entry=>`<span class="key"><i class="dot" style="background:${entry.color}"></i>${entry.label}</span>`).join('');
  V=await molstar.Viewer.create('viewer',OPTS);try{V.plugin.canvas3d.setProps({camera:{helper:{axes:{name:'off',params:{}}}},renderer:{backgroundColor:0xffffff}})}catch(_){}
  const resize=()=>{try{V.plugin.canvas3d.handleResize()}catch(_){}};addEventListener('resize',resize);try{new ResizeObserver(resize).observe($('viewer'))}catch(_){}
  $('timeline').addEventListener('input',()=>selectFrame($('timeline').value));$('previous').addEventListener('click',()=>stepCue(-1));$('next').addEventListener('click',()=>stepCue(1));
  addEventListener('keydown',(event)=>{if(event.key==='ArrowLeft'){event.preventDefault();stepCue(-1)}else if(event.key==='ArrowRight'){event.preventDefault();stepCue(1)}});
  window.__molariumStructureStory={selectFrame,frames:FRAMES,story:STORY,getState:()=>({
    scene:currentScene,frame:currentFrame,refs:Object.keys(refs),camera:V.plugin.canvas3d.camera.getSnapshot(),
  })};await selectFrame(Number(params.get('frame'))||0);
  $('boot').style.display='none';document.body.dataset.ready='1';
}
init().catch(error=>{$('boot').style.display='none';$('error').style.display='grid';$('error').textContent=error?.stack||String(error);document.body.dataset.ready='error'});
