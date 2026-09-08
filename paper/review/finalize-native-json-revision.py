"""Remove redundant pseudocode and the stale Appendix B date from a15."""
from pathlib import Path
import json, shutil, subprocess, sys, zipfile

here=Path(__file__).resolve().parent
root=here.parents[1]
base=root/'paper/revisions'/(sys.argv[3] if len(sys.argv)>3 else '2026-09-07-native-json-listing-a15')
name=sys.argv[2] if len(sys.argv)>2 else '2026-09-07-native-json-current-appendix-a16'
revision=root/'paper/revisions'/name
source=(base/'main.tex').read_text()
start=source.index('The following pseudocode summarizes')
end=source.index('The AWW geometry instruction',start)
changes=[(source[start:end],''),
('presents the procedure as pseudocode together with an excerpt in the native executable JSON action format.',
 'presents the procedure through an excerpt in the native executable JSON action format.'),
('This appendix describes the inspected browser implementation prepared on 2 September 2026 for the public Molarium release. It distinguishes current browser behavior from executable but experimental behavior.',
 'This appendix documents the browser workflows and public API, distinguishing established operations from experimental capabilities.')]
args=['--base',base.name,'--revision',name]
for before,after in changes:args+=['--before',before,'--after',after]
subprocess.run([sys.executable,str(here/'apply-approved-text-edit.py'),sys.argv[1],*args],check=True)
extras=['sos1-design-intent-excerpt.action-script.json','sos1-full-executable.action-script.json','protocol-evidence.json']
if sys.argv[1]=='build':
    for f in extras:shutil.copyfile(base/f,revision/f)
    audit={'publicCodeCommit':'2ab30383d6160349aa3b1e980f7239d6854b329d',
      'checkedOn':'2026-09-07',
      'latestOriginMainUnchangedSincePriorCodeAudit':True,
      'manuscriptCheck':'MOLARIUM_MANUSCRIPT_PATH=<this main.tex> node --test paper/review/current-api-contract.test.mjs',
      'scope':'Action names and argument keys; prior implementation audit remains applicable because public code is unchanged. Not execution of every scientific example.',
      'pendingLocalChange':'Default unbounded in-memory action history is tested locally but not yet in the public commit.'}
    (revision/'appendix-code-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
else:
    text=(revision/'main.tex').read_text()
    assert 'lst:sos1protocol' not in text and 'pseudocode' not in text
    assert 'prepared on 2 September' not in text
    excerpt=json.loads((revision/extras[0]).read_text())
    full=json.loads((revision/extras[1]).read_text())
    for action,index in zip(excerpt['actions'],[36,37,38,41]):
        for key,value in action.items():assert full['actions'][index][key]==value
    assert full['actions'][39]['action']==full['actions'][40]['action']=='session.inspect'
    suffix=name.rsplit('-',1)[-1]
    bundle=root/f'output/prism/molarium-prism-author-approved-{suffix}.zip'
    with zipfile.ZipFile(bundle,'a',zipfile.ZIP_DEFLATED) as z:
        for f in extras+['appendix-code-audit.json']:z.write(revision/f,f)
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(set(z.namelist()))==13
