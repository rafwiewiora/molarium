// Only sequence and chemical identity enter inference; reference poses stay separate.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {writeNativeInputs} from './prepare-native.mjs';
const panelPath=resolve(process.argv[2]),out=resolve(process.argv[3]);
const panelBytes=await readFile(panelPath),panel=JSON.parse(panelBytes);
// Versions/settings are explicit rather than inherited from a recovery subset.
const native={openfold3:{version:'0.5.1',revision:'795e45b03924a8f8ffc72ae50298bd113530b9d3',checkpoint:'of3-ob-2025-06-30-174k.pt'},boltz2:{version:'2.2.1'}};
const protocols={'standard':{steps:200,recycles:3,precision:'bf16-mixed'},
  'torch-standard':{steps:200,recycles:3,precision:'32-true',kernelBackend:'upstream PyTorch dense'}};
await mkdir(out);
for(const c of panel.cases){
  const manifest={schema:'molarium.native-cofold-comparison.v1',
    source:{file:'panel.json',sha256:createHash('sha256').update(panelBytes).digest('hex'),caseId:c.id},
    purpose:'Sequence/SMILES-only reconstruction of an experimental complex. Crystal coordinates are scoring-only.',
    native,sequence:c.sequence,seeds:panel.seeds,compounds:[{id:c.id,smiles:c.smiles}],protocols,
    caveats:panel.caveats};
  await writeNativeInputs(manifest,join(out,c.id));
}
await writeFile(join(out,'input-index.json'),JSON.stringify({panelSha256:createHash('sha256').update(panelBytes).digest('hex'),cases:panel.cases.map(c=>c.id)},null,2)+'\n');
console.log(JSON.stringify({cases:panel.cases.length,seeds:panel.seeds,output:out}));
