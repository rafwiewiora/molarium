"""Preserve a20; restore interface Figure 2 and correct one inherited typo."""
from pathlib import Path
import hashlib, json, shutil, sys, zipfile

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'paper/revisions/2026-09-07-figure-clarity-a20'
OUT=ROOT/'paper/revisions/2026-09-07-interface-chemistry-a21'
CAPTURE=ROOT/'paper/review/captures/2026-09-07-interface-chemistry-a21'
sha=lambda b: hashlib.sha256(b).hexdigest()
original=(BASE/'main.tex').read_text()
prefix='  \\caption{Chemical edits and geometric operations in the SOS1 design sequence.'
before=prefix+original.split(prefix,1)[1].split('\n  \\label{fig:sos1story}',1)[0]
after=r'''  \caption{Chemical edits and receptor response in the Molarium interface. Each panel is a full-tool screenshot with the ligand graph in the enlarged 2D panel. (A) AXE starting hit. (B) AWT: replace naphthyl with pyrazolylphenyl and add a 2-methyl group. (C) AWZ: introduce thiophene and merge the bicyclic heterocycle. (D) AWW: install benzyl alcohol and the 5,8-dihydro core, then orient the arm toward the Tyr884 backbone-carbonyl contact. (E) Hold the same AWW ligand fixed while selecting a Phe890 rotamer that clears the arm. (F) BAY-293: move the thiophene attachment, replace the alcohol with an N-methylamine, and restore the aromatic core. Orange 2D highlights mark atoms outside the registered conserved atom-lineage subgraph relative to the preceding chemical graph; they do not depict a synthetic reaction mechanism. The AWW highlights persist through ligand placement and are cleared for the receptor-only panel. All panels use exact saved checkpoints in the same pocket view. The crystal series informed the design hypothesis, but later crystal coordinates were not used to generate these states.}'''
assert original.count(before)==1
changes=[dict(before=before,after=after),dict(before='Thia concept is analogous',after='This concept is analogous')]
result=original
for change in changes:
    assert result.count(change['before'])==1
    result=result.replace(change['before'],change['after'],1)
names=['fig2_sos1_designer_intent.png','fig2_sos1_designer_intent.provenance.json']
manifest=dict(schema='molarium.approved-manuscript-interface-figure/v1',
    baseRevision=str(BASE.relative_to(ROOT)),baseSourceSha256=sha(original.encode()),
    outputSha256=sha(result.encode()),changes=changes,
    allOtherTextUnchanged=True, allOtherFiguresUnchanged=True,
    figureChanges={n:sha((CAPTURE/n).read_bytes()) for n in names})
if sys.argv[1] in ('build','refresh'):
    refresh=sys.argv[1]=='refresh'
    if refresh: assert json.loads((OUT/'edit-manifest.json').read_text())['baseSourceSha256']==sha(original.encode())
    OUT.mkdir(exist_ok=refresh)
    for f in BASE.iterdir():
        if f.is_dir(): shutil.copytree(f,OUT/f.name,dirs_exist_ok=refresh)
        elif f.suffix not in ('.pdf','.log') and f.name not in ('main.tex','edit-manifest.json'):
            shutil.copyfile(f,OUT/f.name)
    for n in names: shutil.copyfile(CAPTURE/n,OUT/'figures'/n)
    (OUT/'main.tex').write_text(result)
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'\n## Whole-interface Figure 2 restoration (a21)\n\nFigure 2 again consists of six genuine whole-tool screenshots. The app now offers an enlarged, sidebar-docked 2D panel and persistent-ID highlights in that panel. All five chemical graphs are shown, plus the AWW receptor-only response. The actual display-only replay and capture plan are registered separately as sos1-chemical-edits; no frozen scientific source was changed. All text except the Figure 2 caption, and every other figure, remains byte-identical to a20. This preserves its appendix AI-authorship disclosure, pseudocode notation convention, and clean vector Figure 4. Source screenshots and their checks are retained in the repository capture archive.\n')
    readme=(OUT/'README.md').read_text().replace('All text except the Figure 2 caption,', 'All text except the Figure 2 caption and one inherited typo (Thia to This),')
    (OUT/'README.md').write_text(readme)
    print(OUT)
else:
    assert (OUT/'main.tex').read_text()==result
    assert json.loads((OUT/'edit-manifest.json').read_text())==manifest
    for f in (BASE/'figures').iterdir():
        if f.name not in names: assert f.read_bytes()==(OUT/'figures'/f.name).read_bytes()
    log=(OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character','Overfull','undefined references','undefined citations','! LaTeX Error'))
    pdf=ROOT/'output/pdf/molarium-author-approved-a21.pdf'
    bundle=ROOT/'output/prism/molarium-prism-author-approved-a21.zip'
    shutil.copyfile(OUT/'main.pdf',pdf)
    files=[f for f in OUT.rglob('*') if f.is_file() and f.suffix not in ('.log',)
           and f.name!='main.pdf']
    with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(f,str(f.relative_to(OUT)))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None and z.read('main.tex')==result.encode()
    print(json.dumps(dict(pdf=str(pdf),zip=str(bundle),files=len(files)),indent=2))
