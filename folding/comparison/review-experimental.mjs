// Crystal reference occurs once; predictions and their coordinates stay unchanged.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {stringifyLibrary} from '../../vendor/foldarium/library-format.js';
const args=process.argv.slice(2),libraries=[];let panelPath,out;
for(let i=0;i<args.length;i++){
  if(args[i]==='--panel')panelPath=resolve(args[++i]);
  else if(args[i]==='--output')out=resolve(args[++i]);
  else if(args[i]==='--library'){
    const value=args[++i],at=value.indexOf('=');if(at<1)throw Error('Expected label=file');
    const label=value.slice(0,at),file=value.slice(at+1),bytes=await readFile(file);
    libraries.push({label,file:basename(file),bundle:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
  }else throw Error('Unexpected argument '+args[i]);
}
if(!panelPath||!out||!libraries.length)throw Error('Provide --panel, --library and --output');
const panel=JSON.parse(await readFile(panelPath));await mkdir(out,{recursive:true});
for(const c of panel.cases){
  const sources=libraries.filter(l=>l.bundle.run.request.sequence===c.sequence);
  if(!sources.length)continue;
  if(new Set(sources.map(s=>s.label)).size!==sources.length)throw Error('Duplicate case/method');
  for(const s of sources)if(s.bundle.run.compounds.length!==1||s.bundle.run.compounds[0].smiles!==c.smiles)throw Error('Chemical identity mismatch');
  const refBytes=await readFile(join(dirname(panelPath),c.referenceFile));
  if(createHash('sha256').update(refBytes).digest('hex')!==c.referenceSha256)throw Error('Reference hash mismatch');
  const reference=JSON.parse(refBytes),poses=[{id:c.id+'::experimental',compoundId:c.id,sample:0,seed:0,status:'complete',role:'experimental-reference',
    result:{...reference.result,kind:'experimental',model:`Experimental reference · ${c.pdbId}`,provider:`X-ray diffraction · ${c.resolutionA} Å`,
      plddt:null,meanPlddt:null,ptm:null,iptm:null,elapsedMs:null,provenance:{pdbId:c.pdbId,ccdId:c.ccdId,
        sourceReferenceSha256:c.referenceSha256,outputPdbSha256:createHash('sha256').update(reference.result.pdb).digest('hex'),
        purpose:'Scoring/display reference only; never supplied to inference.'}}}];
  // Interleave models by seed so adjacent cards compare the same sampling index.
  for(const seed of panel.seeds)for(const s of sources){
    const p=s.bundle.poses.find(p=>p.seed===seed);if(!p)throw Error('Missing source seed');
    poses.push({...p,id:s.label+'::'+p.id,compoundId:c.id,sample:poses.length,sourcePose:{libraryLabel:s.label,librarySha256:s.sha256,id:p.id,sample:p.sample}});
  }
  const key=createHash('sha256').update(JSON.stringify([c.referenceSha256,sources.map(s=>[s.label,s.sha256])])).digest('hex');
  const run={id:'crystal-'+c.id+'-'+key.slice(0,12),name:c.name+' · experimental reference and predictions',
    createdAt:sources.map(s=>s.bundle.run.createdAt).sort().at(-1),status:'complete',request:{sequence:c.sequence,model:'experimental-reference-review'},
    compounds:[{id:c.id,smiles:c.smiles}],samples:poses.length,total:poses.length,completed:poses.filter(p=>p.status==='complete').length,failed:poses.filter(p=>p.status!=='complete').length,
    provenance:{purpose:'Human inspection against one clearly labelled experimental reference; no copied preferences.',
      sources:sources.map(({label,file,sha256})=>({label,file,sha256})),referenceSha256:c.referenceSha256,
      alignment:'Observed corresponding protein C-alpha atoms; whole complexes move together.'}};
  await writeFile(join(out,c.id+'.library.json'),stringifyLibrary({schema:'foldarium.cofolding-library.v1',run,poses,decisions:[]})+'\n');
  console.log(JSON.stringify({caseId:c.id,predictions:poses.length-1,references:1}));
}
