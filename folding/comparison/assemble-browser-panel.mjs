// Assemble original saved attempts; never invokes inference or changes coordinates.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateLibrary,stringifyLibrary} from '../../vendor/foldarium/library-format.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function assembleBrowserPanel(panelFile,planFile,output){
  const panelBytes=await readFile(panelFile),panel=JSON.parse(panelBytes),planBytes=await readFile(planFile),plan=JSON.parse(planBytes);
  const cases=new Map(panel.cases.map(c=>[c.id,{c,poses:new Map(),sources:[]}])),labels=new Set(),sources=[];
  for(const source of plan.sources){
    if(!/^[-a-zA-Z0-9_]{1,100}$/.test(source.label)||labels.has(source.label))throw Error('Use unique simple source labels');
    labels.add(source.label);
    const file=resolve(dirname(planFile),source.file),bytes=await readFile(file),bundle=validateLibrary(JSON.parse(bytes));
    if(bundle.decisions?.length)throw Error('Source has human preferences');
    if(bundle.run.compounds.length!==1)throw Error('Each source must contain one experimental case');
    const compound=bundle.run.compounds[0],entry=cases.get(compound.id),request=bundle.run.request;
    if(!entry||entry.c.sequence!==request.sequence||entry.c.smiles!==compound.smiles)throw Error('Source chemical/protein identity mismatch');
    if(request.model!==plan.model||request.steps!==plan.steps||request.recycles!==plan.recycles)throw Error('Source protocol mismatch');
    if(entry.c.a3m?(request.msaMode!=='provided'||request.a3m!==entry.c.a3m):request.msaMode!=='single')throw Error('Source alignment mismatch');
    const record={label:source.label,file:'sources/'+source.label+'.json',sha256:hash(bytes),run:bundle.run};
    sources.push({record,bytes});entry.sources.push(record);
    for(const pose of bundle.poses){
      if(!['complete','failed'].includes(pose.status))continue;
      if(!panel.seeds.includes(pose.seed)||pose.compoundId!==entry.c.id)throw Error('Unexpected seed or compound');
      if(entry.poses.has(pose.seed))throw Error('Duplicate saved case/seed; do not repeat completed science');
      if(pose.status==='complete'&&hash(pose.result.pdb)!==pose.result.provenance?.outputPdbSha256)throw Error('Prediction coordinate hash mismatch');
      entry.poses.set(pose.seed,{...pose,id:source.label+'::'+pose.id,sample:panel.seeds.indexOf(pose.seed),
        poseKey:entry.c.id+'::'+panel.seeds.indexOf(pose.seed),
        sourcePose:{libraryLabel:source.label,librarySha256:record.sha256,id:pose.id,
          originalRunId:bundle.run.id,sample:pose.sample,poseKey:pose.poseKey}});
    }
  }
  for(const {c,poses}of cases.values())if(poses.size!==panel.seeds.length)throw Error('Missing terminal case/seed: '+c.id);
  await mkdir(output);await mkdir(join(output,'sources'));
  for(const {record,bytes}of sources)await writeFile(join(output,record.file),bytes);
  const outputs=[];
  for(const [i,{c,poses,sources:caseSources}]of [...cases.values()].entries()){
    const first=caseSources[0].run,ordered=panel.seeds.map(seed=>poses.get(seed)),complete=ordered.filter(p=>p.status==='complete').length;
    const id=hash(JSON.stringify([c.id,caseSources.map(s=>s.sha256)]));
    const run={...first,id:'assembled-'+id.slice(0,20),name:c.name+' · preserved browser cohort',
      status:complete===ordered.length?'complete':'complete-with-failures',
      request:{...first.request,seed:panel.seeds[0]},samples:panel.seeds.length,total:ordered.length,completed:complete,failed:ordered.length-complete,
      sessions:[],provenance:{purpose:'Assemble saved terminal poses from immutable attempts. No inference, coordinate edits or source-status rewriting.',
        panelSha256:hash(panelBytes),planSha256:hash(planBytes),sources:caseSources,
        timing:'Individual pose timings preserved; total wall time unavailable across interrupted sessions.'}};
    const file=`library-${i+1}.json`,bytes=stringifyLibrary({schema:'foldarium.cofolding-library.v1',run,poses:ordered,decisions:[]})+'\n';
    await writeFile(join(output,file),bytes);outputs.push({caseId:c.id,file,sha256:hash(bytes),complete,failed:ordered.length-complete});
  }
  const receipt={schema:'molarium.browser-cohort-assembly.v1',panelSha256:hash(panelBytes),planSha256:hash(planBytes),
    protocol:{model:plan.model,steps:plan.steps,recycles:plan.recycles},
    sourceArtifacts:sources.map(({record})=>({...record,run:undefined,originalStatus:record.run.status})),outputs,
    assemblerSha256:hash(await readFile(new URL(import.meta.url)))};
  await writeFile(join(output,'cohort-receipt.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [panel,plan,out]=process.argv.slice(2);if(!out)throw Error('Usage: panel.json source-plan.json NEW-output');
  const r=await assembleBrowserPanel(resolve(panel),resolve(plan),resolve(out));console.log(JSON.stringify({cases:r.outputs.length,sources:r.sourceArtifacts.length}));
}
