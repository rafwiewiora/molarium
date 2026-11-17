from pathlib import Path
import hashlib,json,os,subprocess,urllib.request
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base='http://metadata.google.internal/computeMetadata/v1/'
identity={k:urllib.request.urlopen(urllib.request.Request(base+k,headers={'Metadata-Flavor':'Google'}),timeout=15).read().decode()for k in ['project/project-id','instance/name','instance/id','instance/zone']}
Path('guest-identity-before-gates.json').write_text(json.dumps({'identity':identity,'slurmJobId':os.environ.get('SLURM_JOB_ID'),'slurmdNodeName':os.environ.get('SLURMD_NODENAME'),'slurmCluster':os.environ.get('SLURM_CLUSTER_NAME')},indent=2)+'\n')
assert identity['project/project-id']=='psivant-prod'and identity['instance/zone'].endswith('/us-central1-c')
assert identity['instance/name']==os.environ['SLURMD_NODENAME']and os.environ['SLURM_CLUSTER_NAME']=='psigreen'
config=subprocess.check_output(['scontrol','show','config'],text=True);assert'ClusterName             = psigreen'in config and'psigreen-controller'in config
parent=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-device-discovery-20261117-attempt002')
assert sha(parent/'source-manifest.json')=='1af42b5bea4500493215274907b492442927cb6f97166f443beafbc39bbe84f0'
r=json.loads((parent/'result.json').read_bytes());assert r['success']and r['modelCalls']==0
passing=next(p for p in r['phases']if p['exitCode']==0);assert passing['result']['webgpu']['integerProbe']==7 and'nvidia'in json.dumps(passing['result']['webgpu']['adapter']).lower()
records=[]
for path,pin in [('/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001','f6dbb0999ef5f1e47cea66c84800d25c4c28c14ec6378597538c882f49ec1452'),('/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001','d7f15752ef64f611a8ce265014a52ba952353fc527bdcc3bfa19f9dc027fa1be')]:
 root=Path(path);assert sha(root/'source-manifest.json')==pin
 source=json.loads((root/'source-manifest.json').read_bytes())
 for name,digest in source.items():assert sha(root/name)==digest,name
 records.append({'root':path,'sourceManifestSha256':pin,'files':len(source)})
Path('control-source-verification.json').write_text(json.dumps({'identity':identity,'parentCapabilityJob':20285,'records':records,'newNativeCalls':0},indent=2)+'\n')

adaptation=json.loads(Path('runner-adaptations.json').read_bytes())
layer=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001')
trunk=Path('/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001/browser-repo')
assert sha(layer/'scripts/cofold-transition-nvidia.browser.mjs')==adaptation['transitionOriginalSha256']
fix=json.loads(Path('trunk-readiness-fix.json').read_bytes());raw=(trunk/'scripts/cofold-trained-trunk.browser.mjs').read_text()
assert hashlib.sha256(raw.encode()).hexdigest()==fix['originalHarnessSha256']
assert raw.count(fix['onlyChange']['from'])==1
assert hashlib.sha256(raw.replace(fix['onlyChange']['from'],fix['onlyChange']['to']).encode()).hexdigest()==adaptation['trunkPublicSourceSha256']
for name,key,parent_key in [('trunk.browser.mjs','trunkReplacements','trunkPublicSourceSha256'),('transition.browser.mjs','transitionReplacements','transitionOriginalSha256')]:
 text=Path(name).read_text()
 for patch in reversed(adaptation[key]):
  assert text.count(patch['to'])==1
  text=text.replace(patch['to'],patch['from'])
 assert hashlib.sha256(text.encode()).hexdigest()==adaptation[parent_key]

image=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif')
image_digest=hashlib.sha256()
with image.open('rb')as stream:
 for chunk in iter(lambda:stream.read(1024*1024),b''):image_digest.update(chunk)
assert image_digest.hexdigest()==json.loads(Path('container-image-receipt.json').read_bytes())['sha256']
