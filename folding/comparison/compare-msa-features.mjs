// Compare actual LocalFold parser/dialect features with the official CPU export.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {af3MsaFromA3m,AF3_MSA_CODES} from '../../vendor/localfold/shared/af3/featurise/msa-features.js';
import {OPENBIND0,featuriserDialect} from '../../vendor/localfold/shared/af3/dialect.js';
import {af3BatchFromA3m} from '../../vendor/localfold/shared/af3/featurise/batch.js';
const [panelFile,nativeFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: provided-MSA-panel.json official-msa-features.json output.json');
const panelBytes=await readFile(panelFile),nativeBytes=await readFile(nativeFile);
const panel=JSON.parse(panelBytes),native=JSON.parse(nativeBytes),letters=Object.fromEntries(
  Object.entries(AF3_MSA_CODES).filter(([a])=>'ARNDCQEGHILKMFPSTWYVX-'.includes(a)).map(([a,i])=>[i,a]));
const hash=b=>createHash('sha256').update(b).digest('hex'),records=[];
for(const c of panel.cases){
  const n=native.records.find(r=>r.caseId===c.id);
  if(!n||n.providedMsaSha256!==hash(c.a3m))throw Error('Missing or substituted native MSA: '+c.id);
  const parsed=af3MsaFromA3m(c.a3m,{...featuriserDialect(OPENBIND0),chainOfColumn:Array(c.sequence.length).fill(0)});
  const rows=[c.sequence,...parsed.msa.map(row=>Array.from(row,i=>letters[i]).join(''))];
  const deletions=[Array(c.sequence.length).fill(0),...parsed.deletionMatrix.map(row=>Array.from(row))];
  const rowDifferences=[],deletionDifferences=[];
  for(let i=0;i<Math.max(rows.length,n.rows.length);i++){
    if(rows[i]!==n.modelResidueRows[i])rowDifferences.push(i);
    if(JSON.stringify(deletions[i])!==JSON.stringify(n.deletionMatrix[i]))deletionDifferences.push(i);
  }
  const {batch}=af3BatchFromA3m(c.sequence,c.a3m,{seed:0,...featuriserDialect(OPENBIND0)});
  let profileMaxAbsError=0,deletionMeanMaxAbsError=0;
  if(!n.profile||!n.deletionMean)throw Error('Official export lacks profile/deletion mean');
  const width=batch.profile.length/batch.tokens;
  if(width!==31||n.profile.length!==c.sequence.length||n.profile.some(p=>p.length!==32))throw Error('Unexpected profile shape');
  for(let i=0;i<c.sequence.length;i++){
    // OpenFold3's full alphabet puts GAP after protein/RNA/DNA; the converted
    // LocalFold weights put GAP at 21 before RNA/DNA. Protein channels agree.
    for(let j=0;j<width;j++){
      const nativeValue=j<21?n.profile[i][j]:j===21?n.profile[i][31]:j<26?n.profile[i][j-1]
        :j<30?n.profile[i][j]:n.profile[i][25]+n.profile[i][30];
      profileMaxAbsError=Math.max(profileMaxAbsError,Math.abs(batch.profile[i*width+j]-nativeValue));
    }
    deletionMeanMaxAbsError=Math.max(deletionMeanMaxAbsError,Math.abs(batch.deletionMean[i]-n.deletionMean[i]));
  }
  records.push({caseId:c.id,alignmentSha256:hash(c.a3m),browserRows:rows.length,nativeRows:n.rows.length,
    residueRowDifferences:rowDifferences,deletionRowDifferences:deletionDifferences,
    profileMaxAbsError,deletionMeanMaxAbsError});
}
const passed=records.every(r=>!r.residueRowDifferences.length&&!r.deletionRowDifferences.length
  &&r.profileMaxAbsError<=1e-6&&r.deletionMeanMaxAbsError<=1e-6);
await writeFile(output,JSON.stringify({schema:'molarium.msa-feature-comparison.v1',scope:'OpenBind protein alignment residue/deletion rows, profiles and deletion means; not full model feature or numerical parity.',
  panelSha256:hash(panelBytes),officialExportSha256:hash(nativeBytes),allChecksPass:passed,records},null,2)+'\n');
console.log(JSON.stringify({cases:records.length,allChecksPass:passed}));
if(!passed)process.exitCode=1;
