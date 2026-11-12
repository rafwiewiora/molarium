// Combine computed poses for human review; inference and original coordinates stay untouched.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateLibrary,stringifyLibrary} from '../../vendor/foldarium/library-format.js';

export function reviewBundle(sources,{name='Cofolding method comparison'}={}) {
  if(!sources.length)throw new Error('At least one completed library is required.');
  const first=validateLibrary(sources[0].bundle), sequence=first.run.request.sequence;
  const compounds=new Map(first.run.compounds.map(c=>[c.id,c.smiles]));
  const labels=new Set(),poses=[];let referenceSeeds;
  for(const [sourceIndex,{label,bundle,sha256}]of sources.entries()){
    validateLibrary(bundle);
    if(!/^[a-zA-Z0-9_-]+$/.test(label)||labels.has(label))throw new Error('Use unique simple source labels.');
    labels.add(label);
    if(bundle.run.request.sequence!==sequence || bundle.run.compounds.length!==compounds.size ||
      bundle.run.compounds.some(c=>compounds.get(c.id)!==c.smiles))throw new Error('Source protein/compound identities differ.');
    if(!bundle.poses.length||bundle.poses.some(p=>p.status!=='complete'))throw new Error('Use completed libraries and retain failures separately.');
    const seen=new Set(),seeds=new Map();
    for(const p of bundle.poses){
      const key=JSON.stringify([p.compoundId,p.seed]);
      if(seen.has(key)||!Number.isInteger(p.sample)||p.sample<0)throw new Error('Duplicate compound/seed or invalid sample.');
      seen.add(key);const current=seeds.get(p.compoundId)??[];current.push(p.seed);seeds.set(p.compoundId,current);
      poses.push({...p,id:`${label}::${p.id}`,sample:p.sample*sources.length+sourceIndex,
        sourcePose:{libraryLabel:label,librarySha256:sha256,id:p.id,sample:p.sample}});
    }
    const expected=JSON.stringify([...seeds.values()][0]?.sort((a,b)=>a-b));
    if(seeds.size!==compounds.size||[...seeds.values()].some(s=>JSON.stringify(s.sort((a,b)=>a-b))!==expected))
      throw new Error('Every compound must have the complete source seed set.');
    if(referenceSeeds&&referenceSeeds!==expected)throw new Error('Source seed sets differ.');
    referenceSeeds=expected;
  }
  const sourceId=createHash('sha256').update(JSON.stringify(sources.map(s=>[s.label,s.sha256]))).digest('hex');
  return validateLibrary({schema:first.schema,run:{id:`comparison-${sourceId.slice(0,20)}`,name,
    createdAt:[...sources.map(s=>s.bundle.run.createdAt)].sort().at(-1),status:'complete',
    request:{sequence,model:'comparison-review-only'},compounds:first.run.compounds,samples:JSON.parse(referenceSeeds).length*sources.length,
    total:poses.length,completed:poses.length,failed:0,
    provenance:{purpose:'Unscored human comparison of independently predicted complexes; no experimental answer.',
      sourceLibraries:sources.map(s=>({label:s.label,sha256:s.sha256,file:s.file??null,run:s.bundle.run})),
      decisions:'No source decisions copied; preferences must be made explicitly for these exact poses.'}},
    poses,decisions:[]});
}

async function main(){
  const args=process.argv.slice(2),sources=[];let output,name;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--library'){
      const argument=args[++i],at=argument.indexOf('=');if(at<1)throw new Error('Expected --library label=file');
      const label=argument.slice(0,at),file=argument.slice(at+1),bytes=await readFile(file);
      sources.push({label,file:basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),bundle:JSON.parse(bytes)});
    }else if(args[i]==='--output')output=args[++i];
    else if(args[i]==='--name')name=args[++i];
    else throw new Error(`Unknown argument ${args[i]}`);
  }
  if(!output)throw new Error('Expected --output file');
  const bundle=reviewBundle(sources,{name});await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output,stringifyLibrary(bundle)+'\n');
  console.log(JSON.stringify({output,poses:bundle.poses.length,compounds:bundle.run.compounds.length,decisions:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
