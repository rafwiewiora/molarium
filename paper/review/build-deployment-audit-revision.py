"""Reconcile a27 with the hash-checked deployed Molarium release; preserve science."""
from pathlib import Path
import argparse, difflib, hashlib, json, shutil, zipfile

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'paper/revisions/2026-09-08-value-figure-cleanup-a27'
OUT=ROOT/'paper/revisions/2026-09-08-deployed-reconciliation-a28'
PDF=ROOT/'output/pdf/molarium-author-approved-a28.pdf'
ZIP=ROOT/'output/prism/molarium-prism-author-approved-a28.zip'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('command',choices=['build','refresh','package','downloads'])
args=parser.parse_args()
sha=lambda b:hashlib.sha256(b).hexdigest()
readjson=lambda p:json.loads(p.read_text())
changes=readjson(ROOT/'paper/review/deployed-audit-appendix-a-replacements-2026-09-08.json')+readjson(ROOT/'paper/review/DEPLOYED-APPENDIX-B-REPLACEMENTS-2026-09-08.json')
changes += [
 dict(id='A-layout-avoid-stranded-final-paragraph',before='\\appendixsection{Molarium architecture, numerical validation, and executable design history}{app:architecture}\n\\begin{small}\n\\setlength{\\emergencystretch}{2em}',after='\\appendixsection{Molarium architecture, numerical validation, and executable design history}{app:architecture}\n\\begin{small}\n\\setlength{\\parskip}{0.35em}\n\\setlength{\\emergencystretch}{2em}',evidence='Rendered a28 layout: slightly reduce Appendix A paragraph gaps to avoid stranding its final paragraph on a separate page; no wording or font-size change.'),
 dict(id='Figure2-local-presentation-build',before='Each panel is a full-tool screenshot with the ligand graph in the enlarged 2D panel.',after='Each panel is a full-tool screenshot from a local figure-preparation build. Its enlarged, scaffold-aligned 2D panels and orange highlights are display-only additions not present in the reviewed public interface; the saved molecular graphs and coordinates are unchanged.',evidence='DEPLOYED-AUDIT-SOS1-2026-09-08.md'),
 dict(id='B03-contract-preconditions',before=r'\contractrow{Preconditions}{A valid ligand or PDB structure is loaded; the relevant pH or experimental condition is known or stated as an assumption.}',after=r'\contractrow{Preconditions}{For the visible ligand workflow, a standalone SMILES-derived molecule with at most 256 atoms is loaded; protein choices require a PDB structure. The relevant pH is known or stated as an assumption.}',evidence='DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md B03'),
 dict(id='B03-contract-mutation',before=r'\contractrow{State mutation}{Applying a ligand state replaces graph and coordinates. Protein protonation changes are committed through preparation. Prior parameterization becomes obsolete.}',after=r'\contractrow{State mutation}{Applying a ligand state replaces the entire current molecule. Protein protonation changes are committed through preparation. Prior parameterization becomes obsolete.}',evidence='DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md B03'),
 dict(id='B09-essential-help',before='Adjacent information buttons explain these policies and the available choices.',after='Information buttons beside crucial choices explain these policies; routine controls retain unobtrusive descriptions.',evidence='Public design-help.mjs; live Design and Simulate UI checked'),
 dict(id='B09-explicit-infeasible-override',before='Molarium does not silently apply the least-bad pose.',after=r'Molarium does not silently apply the least-bad pose. An explicit, recorded API override (\code{allowInfeasible:true}) can apply an infeasible candidate; the acceptance contract here excludes that override.',evidence='DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md; chemist-actions.mjs:201-210'),
 dict(id='B11-example-context',before='The practical agent pattern is:',after='The following agent pattern assumes the Design workspace, an active campaign, and a reviewed, unambiguous atom path:',evidence='DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md B11'),
]
original=(BASE/'main.tex').read_text()
result=original
for c in changes:
    assert result.count(c['before'])==1,c['id']
    result=result.replace(c['before'],c['after'],1)
deployment=readjson(ROOT/'paper/review/captures/2026-09-08-deployment-audit/deployment-audit.json')
assert deployment['manifestMetadataMatchesBuild']
assert all(f['matchesManifest'] and (f['matchesPublicSource'] or f.get('matchesProductionTransform')) for f in deployment['files'])
audit=dict(publicCodeCommit=deployment['publicCodeCommit'],checkedOn='2026-09-08',
    deploymentAuditFile='deployment-audit.json',liveFilesVerified=deployment['checkedFiles'],
    liveManifestSha256=deployment['manifestSha256'],priorCodeAuditCommit='2ab30383d6160349aa3b1e980f7239d6854b329d',
    scope='All Appendix A/B sections and related main/figure claims compared with pinned public source; live served modules/release records hash-checked; representative live menus inspected; API example action names, keys and selected value vocabularies checked. Not execution of every molecular example or a new numerical benchmark.',
    command='MOLARIUM_PUBLIC_CODE_COMMIT='+deployment['publicCodeCommit']+' MOLARIUM_MANUSCRIPT_PATH=<main.tex> node --test paper/review/current-api-contract.test.mjs',
    scientificResultsChanged=False,figuresChanged=False,applicationChanged=False,
    implementationDefectsDocumented=['Prediction cancellation shares the serialized prediction queue and cannot interrupt the pending prediction.'],
    undeployedLocalWork=['Unbounded action-history changes remain local; deployed API and scene audit buffers retain up to 500 entries.','Figure 2 uses local display-only aligned/enlarged/highlighted 2D controls, now explicitly identified in the caption.'],
    uiChecks=['LSD remains loaded after switching View to Design','Essential-only help icons and Reproductions navigation present','OpenMM absent from visible Simulate menu','Conformer effort menu: quick, balanced, thorough','Precomputed SOS1 review opens with 18 presentation moves on blank canvas, awaiting Play'],
    reviewFiles=['DEPLOYED-AUDIT-APPENDIX-A-2026-09-08.md','DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md','DEPLOYED-AUDIT-SOS1-2026-09-08.md'])
protocol=readjson(BASE/'protocol-evidence.json')
for checkpoint in protocol['checkpointMapping']:
    checkpoint['checkpointHashScope']='decoded JSON bytes (decompressed before hashing for .gz sources)'
manifest=dict(schema='molarium.approved-manuscript-deployed-reconciliation/v1',baseRevision=str(BASE.relative_to(ROOT)),baseSourceSha256=sha(original.encode()),outputSha256=sha(result.encode()),changes=changes,allFiguresUnchanged=True,newScientificCalculations=False,publicCodeCommit=deployment['publicCodeCommit'])

def verify():
    assert (OUT/'main.tex').read_text()==result
    assert readjson(OUT/'edit-manifest.json')==manifest
    assert readjson(OUT/'appendix-code-audit.json')==audit
    assert readjson(OUT/'protocol-evidence.json')==protocol
    exclusions={'main.tex','main.pdf','main.log','README.md','UPLOAD-INSTRUCTIONS.md','edit-manifest.json','appendix-code-audit.json','protocol-evidence.json'}
    for f in BASE.rglob('*'):
        if f.is_file() and str(f.relative_to(BASE)) not in exclusions:
            assert f.read_bytes()==(OUT/f.relative_to(BASE)).read_bytes(),str(f)

if args.command in ('build','refresh'):
    OUT.mkdir(exist_ok=args.command=='refresh')
    for f in BASE.iterdir():
        if f.is_dir():shutil.copytree(f,OUT/f.name,dirs_exist_ok=True)
        elif f.name not in ('main.pdf','main.log'):shutil.copyfile(f,OUT/f.name)
    (OUT/'main.tex').write_text(result)
    for name,value in [('edit-manifest.json',manifest),('appendix-code-audit.json',audit),('deployment-audit.json',deployment),('protocol-evidence.json',protocol)]:
        (OUT/name).write_text(json.dumps(value,indent=2)+'\n')
    for name in audit['reviewFiles'] + ['deployed-audit-appendix-a-replacements-2026-09-08.json', 'DEPLOYED-APPENDIX-B-REPLACEMENTS-2026-09-08.json']:
        f=ROOT/'paper/review'/name
        if f.exists():shutil.copyfile(f,OUT/name)
    (OUT/'changes-from-a27.diff').write_text(''.join(difflib.unified_diff(original.splitlines(True),result.splitlines(True),fromfile='a27/main.tex',tofile='a28/main.tex')))
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Deployed-release reconciliation (a28)

This revision corrects technical/operating descriptions against public commit
6d2f620d7d26e3dfd270c018f0a9be7a414f2163 and 80 live served-file checks.
Exact edits and evidence are recorded in edit-manifest.json and the a27 diff.
The independent Appendix A, Appendix B and SOS1 audit notes are included.
All figure images, executable SOS1 scripts, pseudocode operations, benchmark
numbers and frozen scientific results are unchanged. No application fix or
new scientific calculation is implied. The paper now acknowledges unreliable
queued prediction cancellation and the deployed bounded/partial action history.
Figure 2's local display-only enhancements are distinguished from the public UI.
The source runtime configuration differs from production by the documented
build transformation; each inspected live file matches the production manifest.
The code-audit metadata replaces the stale assertion of an unchanged public
commit. BAY checkpoint hash scope is explicitly decoded JSON, not gzip bytes.

Review categories: technical contradictions and terminology are corrected in
the exact-edit manifest; figure and listing references were checked against
their content. Author names, affiliations, acknowledgments and identifying
project/repository links remain intentionally present; this is not an anonymized
submission. No anonymization edits were made.
''')
    (OUT/'UPLOAD-INSTRUCTIONS.md').write_text('''# Prism upload (a28)

From a27: replace the entire main.tex. No figure reuploads are needed.
If Prism still shows the older, heavier/narrower Figure 4 lettering, reupload
figures/fig3_build_loop_compact.pdf too. The current main.tex explicitly uses
this embedded-Latin-Modern PDF, not the older PNG. Figure 3 is unchanged.
Also replace appendix-code-audit.json and protocol-evidence.json if you retain
these supporting records in Prism; neither is a LaTeX input. The complete
folder/ZIP contains the latest files plus audit reports and exact edit history.
All previous revisions remain preserved.
''')
    verify()
    print(json.dumps(dict(directory=str(OUT),exactEdits=len(changes)),indent=2))
elif args.command=='package':
    verify()
    assert all((OUT/name).exists() for name in audit['reviewFiles'])
    log=(OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character','Overfull','undefined references','undefined citations','! LaTeX Error'))
    shutil.copyfile(OUT/'main.pdf',PDF)
    files=sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix!='.log' and f.name!='main.pdf')
    with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files:z.write(f,str(f.relative_to(OUT)))
    with zipfile.ZipFile(ZIP) as z:
        assert z.testzip() is None
        for f in files:assert z.read(str(f.relative_to(OUT)))==f.read_bytes()
    print(json.dumps(dict(pdf=str(PDF),zip=str(ZIP),files=len(files)),indent=2))
else:
    verify()
    folder=Path('/Users/bb/Downloads/molarium-prism-author-approved-a28')
    zipped=folder.with_suffix('.zip')
    pdf=Path('/Users/bb/Downloads/molarium-author-approved-a28.pdf')
    assert all(not f.exists() for f in (folder,zipped,pdf))
    shutil.copytree(OUT,folder);shutil.copyfile(ZIP,zipped);shutil.copyfile(PDF,pdf)
    for f in OUT.rglob('*'):
        if f.is_file():assert f.read_bytes()==(folder/f.relative_to(OUT)).read_bytes()
    assert PDF.read_bytes()==pdf.read_bytes() and ZIP.read_bytes()==zipped.read_bytes()
    print(json.dumps(dict(folder=str(folder),zip=str(zipped),pdf=str(pdf)),indent=2))
