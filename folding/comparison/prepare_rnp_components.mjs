// Original stock SMILES preparation only. No weights, prediction, or crystal data.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.replace(/^--/,''),all[i+1]]],[]));
for(const k of ['selection','upstream-root','output'])if(!args[k])throw Error('Required --'+k);
const root=resolve(args['upstream-root']),output=resolve(args.output);
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD');
if(revision!=='5ea3d42c911949700401b54003cb28c557fcf2a6'||git('status','--porcelain','--untracked-files=all'))throw Error('Pristine pinned LocalFold checkout required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=await readFile(args.selection),selection=JSON.parse(raw);
if(selection.schema!=='molarium.rnp-spectrum-selection.v1'||new Set(selection.selected.map(c=>c.caseId)).size!==selection.selected.length)throw Error('Frozen unique selection required');
await mkdir(output);await mkdir(join(output,'components'));
const {smilesComponent}=await import(pathToFileURL(join(root,'shared/chem/component.js')));
const manifest={scope:'Original stock smilesComponent defaults and raw declared SMILES. Graph used only for independent output scoring; never supplied to folding.',
  upstreamRevision:revision,selectionSha256:sha(raw),scriptSha256:sha(await readFile(new URL(import.meta.url))),
  components:{},failures:[]};
for(const c of selection.selected){
  if(!/^[a-z0-9_-]+$/.test(c.caseId))throw Error('Unsafe case identity');
  const file='components/'+c.caseId+'.json';
  try{const component=await smilesComponent(c.smiles,{code:'LIG'}),bytes=Buffer.from(JSON.stringify(component,null,2)+'\n');
    await writeFile(join(output,file),bytes,{flag:'wx'});
    manifest.components[file]={sha256:sha(bytes),smiles:c.smiles,atoms:component.atoms.length};
    console.log(JSON.stringify({caseId:c.caseId,status:'prepared',atoms:component.atoms.length}));
  }catch(e){manifest.failures.push({caseId:c.caseId,smiles:c.smiles,error:String(e.message)});console.log(JSON.stringify({caseId:c.caseId,status:'failed',error:e.message}));}
}
await writeFile(join(output,'component-provenance.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:Object.keys(manifest.components).length,failed:manifest.failures.length,neuralForwards:0}));
