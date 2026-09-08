// Read-only public deployment audit; captures hashes, not new scientific results.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const commit='6d2f620d7d26e3dfd270c018f0a9be7a414f2163';
const base='https://molarium.org/';
const out=resolve('paper/review/captures/2026-09-08-deployment-audit');
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=p=>execFileSync('git',['show',`${commit}:${p}`],{maxBuffer:32*1024*1024});
async function get(path) {
  const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
mkdirSync(out,{recursive:true});
const manifestBytes=await get('local-lab-manifest.json');
const manifest=JSON.parse(manifestBytes);
writeFileSync(resolve(out,'deployed-manifest.json'),manifestBytes);
const selected=manifest.files.filter(f=>
  /^(app\.js|index\.html|chemist-actions\.mjs|CHEMIST-ACTIONS-API\.md|design-help\.mjs|workspace-help\.mjs|runtime-config\.js|molecular-state-hash\.mjs|protein-residue-templates\.js|rdkit-worker\.js|openmm-worker\.js|webgpu-worker\.js|stormm-worker\.js|mlip-worker\.js|reproductions\.html|sos1\.html|sos1-movie\.mjs)$/.test(f.path)
  || /^(openff|openfold|stormm|webgpu|openmm|mlip)\/[^/]+\.(js|mjs|wgsl|md)$/i.test(f.path)
  || /^design-history\/[^/]+\.mjs$/.test(f.path)
  || /^docking\/[^/]+\.mjs$/.test(f.path)
  || /^design-history\/publications\/sos1\/designer-intent-2026-09-04\/(release\.json|executable.action-script\.json|checkpoint-review.action-script\.json|checkpoint-popups-v2\/movie\.json)$/.test(f.path));
const results=[];
const version=JSON.parse(git('package.json')).version;
const assetBase=`https://assets.molarium.org/v${version}/`;
const buildSource=git('scripts/build-web.mjs').toString();
if(!buildSource.includes("mode:'connected', localOnly:false, policy:'connected-v1'")) throw Error('Review production runtime transformation');
const expectedRuntime=Buffer.from(`globalThis.MOLARIUM_RUNTIME_CONFIG = Object.freeze(${JSON.stringify({
  mode:'connected',localOnly:false,policy:'connected-v1',
  allowedNetworkOrigins:['https://assets.molarium.org','https://files.rcsb.org','https://api.colabfold.com'],
  buildManifest:'./local-lab-manifest.json',assetBase,
})});\n`);
const queue=[...selected];
await Promise.all(Array.from({length:6},async()=>{
  while(queue.length) {
    const f=queue.shift();
    try {
      const data=await get(f.path);
      const source=git(f.path);
      results.push({path:f.path,bytes:data.length,manifestSha256:f.sha256,
        liveSha256:sha(data),publicSourceSha256:sha(source),
        matchesManifest:sha(data)===f.sha256,matchesPublicSource:sha(data)===sha(source),
        ...(f.path==='runtime-config.js'?{expectedBuildTransformation:'scripts/build-web.mjs runtime-config generation',matchesProductionTransform:sha(data)===sha(expectedRuntime)}:{})});
    } catch(error) { results.push({path:f.path,error:String(error)}); }
  }
}));
results.sort((a,b)=>a.path.localeCompare(b.path));
const record={schema:'molarium.manuscript-deployment-audit/v1',checkedAtUTC:new Date().toISOString(),
  publicCodeCommit:commit,baseUrl:base,manifestSha256:sha(manifestBytes),
  manifestMatchesPublicSource:sha(manifestBytes)===sha(git('local-lab-manifest.json')),
  manifestIsGeneratedByProductionBuild:true,
  manifestMetadataMatchesBuild:manifest.schema==='molarium.web-release.v1'&&manifest.version===version&&manifest.assetBase===assetBase,
  checkedFiles:results.length,files:results,
  scope:'Live source/manifest byte verification plus separate manuscript/API/source reviews. No new GPU, benchmark, or SOS1 scientific calculations. Large binaries and checkpoint campaigns are not downloaded by this check.'};
writeFileSync(resolve(out,'deployment-audit.json'),JSON.stringify(record,null,2)+'\n');
const mismatches=results.filter(r=>r.error||!r.matchesManifest||(!r.matchesPublicSource&&!r.matchesProductionTransform));
console.log(JSON.stringify({commit,checkedFiles:results.length,manifestMatchesPublicSource:record.manifestMatchesPublicSource,mismatches,record:resolve(out,'deployment-audit.json')},null,2));
if(mismatches.length||!record.manifestMetadataMatchesBuild)process.exitCode=1;
