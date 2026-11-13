// Assemble existing science only. Never calls inference or copies preferences.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewBundle} from './review-bundle.mjs';
import {stringifyLibrary} from '../../vendor/foldarium/library-format.js';
const [panelFile,phasesFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: panel.json phases.json output-directory');
const panelBytes=await readFile(panelFile),panel=JSON.parse(panelBytes),root=dirname(resolve(panelFile));
const phases=JSON.parse(await readFile(phasesFile)),out=resolve(output),hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(join(out,'review'),{recursive:true});
const index={schema:'molarium.public-cofold-review.v1',panelSha256:hash(panelBytes),phases,predictions:0,cases:[]};
for(const [i,c]of panel.cases.entries()){
  const sources=[];
  for(const phase of phases){
    const file=`${phase.directory}/library-${i+1}.json`,bytes=await readFile(join(root,file)),bundle=JSON.parse(bytes);
    if(bundle.run.request.sequence!==c.sequence||bundle.run.compounds.length!==1
      ||bundle.run.compounds[0].id!==c.id||bundle.run.compounds[0].smiles!==c.smiles)throw Error('Case identity mismatch: '+file);
    const poses=bundle.poses.map(p=>({...p,result:{...p.result,model:phase.label,
      reviewDisplay:{originalModel:p.result.model,sourceLibrarySha256:hash(bytes),purpose:'Display label only; original PDB and inference provenance retained.'}}}));
    sources.push({label:phase.id,file,sha256:hash(bytes),bundle:{...bundle,poses}});
  }
  const predictions=reviewBundle(sources,{name:c.name+' · all predictions'});
  predictions.run.provenance.purpose='Choose among every saved prediction without displaying the experimental reference; method/protocol labels remain visible.';
  const refBytes=await readFile(join(root,c.referenceFile));
  if(hash(refBytes)!==c.referenceSha256)throw Error('Reference hash mismatch');
  const reference=JSON.parse(refBytes),refPose={id:c.id+'::experimental',compoundId:c.id,sample:0,seed:0,status:'complete',role:'experimental-reference',
    result:{...reference.result,kind:'experimental',model:`Experimental reference · ${c.pdbId}`,provider:`X-ray diffraction · ${c.resolutionA} Å`,
      plddt:null,meanPlddt:null,ptm:null,iptm:null,elapsedMs:null,provenance:{pdbId:c.pdbId,ccdId:c.ccdId,
        sourceReferenceSha256:c.referenceSha256,outputPdbSha256:hash(reference.result.pdb),purpose:'Scoring/display reference only; never supplied to inference.'}}};
  const count=predictions.poses.length+1;
  const withReference={...predictions,run:{...predictions.run,id:predictions.run.id+'-ref-'+c.referenceSha256.slice(0,12),
    name:c.name+' · experimental reference and all predictions',request:{sequence:c.sequence,model:'experimental-reference-review'},
    samples:count,total:count,completed:count,provenance:{...predictions.run.provenance,
      purpose:'Inspect every prediction against one labelled experimental reference; no copied preferences.',referenceSha256:c.referenceSha256}},
    poses:[refPose,...predictions.poses.map(p=>({...p,sample:p.sample+1}))]};
  const descriptors=[];
  for(const [suffix,bundle,reference]of [['predictions',predictions,false],['reference',withReference,true]]){
    const file=`review/${c.id}-${suffix}.library.json`,bytes=stringifyLibrary(bundle)+'\n';
    await writeFile(join(out,file),bytes);descriptors.push({file,sha256:hash(bytes),reference});
  }
  index.predictions+=predictions.poses.length;
  index.cases.push({id:c.id,name:c.name,pdbId:c.pdbId,releaseDate:c.releaseDate,residues:c.sequence.length,
    heavyAtoms:reference.ligandHeavyAtoms,qed:c.properties.QED,predictions:descriptors[0],withReference:descriptors[1]});
}
await writeFile(join(out,'review-index.json'),JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({cases:index.cases.length,predictions:index.predictions}));
