"""Preserve a24; annotate the SOS1 protocol without changing its operations."""
from pathlib import Path
import argparse, difflib, hashlib, json, re, shutil, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-07-evidence-arrow-a24'
OUT = ROOT/'paper/revisions/2026-09-08-readable-protocol-a25'
PDF = ROOT/'output/pdf/molarium-author-approved-a25.pdf'
ZIP = ROOT/'output/prism/molarium-prism-author-approved-a25.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build','refresh','package','downloads'])
args = parser.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
original = (BASE/'main.tex').read_text()
old_pseudo = (BASE/'sos1-whole-movie-pseudocode.txt').read_text()
markers = ['designRoute.load', 'for step in', 'protein.parameterize()\ndesignRoute.applyStep(open-phe890-pocket)', 'pose.addContact', 'protein.parameterize(); pose.setDesignerLigandPoseFixed(true)', 'protein.parameterize(); pose.setDesignerLigandPoseFixed(false)']
offsets = [old_pseudo.index(m) for m in markers]+[len(old_pseudo)]
blocks = [old_pseudo[a:b] for a,b in zip(offsets,offsets[1:])]
stages = [
    ('molblue','A','Prepare the starting hit','Checkpoint 1: AXE supplies the starting graph and coordinates.',''),
    ('sosedit','B / C','Change the scaffold, then propagate and relax','Checkpoint 2: AWT (pyrazolylphenyl and 2-methyl). Checkpoint 3: AWZ (thiophene and merged bicyclic heterocycle). Search transfers the pose; subsequent local relaxation adjusts ligand and pocket.',''),
    ('sosedit','D, first','Install the AWW graph','Checkpoint 4: introduce the benzyl-alcohol arm. This graph-only state precedes the placement shown in panel D.',''),
    ('molteal','D, then','Specify and place the ligand arm','Checkpoint 5 / panel D: same graph, new ligand geometry. Only the declared branch moves; Phe890 has not yet responded.','Tyr884 backbone contact achieved; clashes with the allowed Phe890 ring remain. This is a ligand hypothesis, not yet a clash-free complex.'),
    ('sosresponse','E','Test receptor responses to that fixed ligand','Checkpoint 6: preserve the ligand graph and every ligand coordinate; change only the Phe890 conformation.','Two of 13 states are clash-free; the recorded choice has the lower finite energy. The ligand remains unchanged.'),
    ('sosedit','F','Change the attachment while retaining a spatial feature','Checkpoint 7: BAY-293. Move the thiophene attachment and replace the alcohol with an N-methylamine. Release the exact ligand lock, but retain the distal feature within its tolerance.','Three of eight candidates are feasible; the selected, relaxed state passes the registered checks. Spatial retention is approximate, not an exact coordinate lock.')]
section = (ROOT/'paper/review/sos1-readable-protocol-a25-prefix.tex').read_text()
for (color,letter,title,description,readout),block in zip(stages,blocks):
    section += '\\begin{minipage}{\\linewidth}\n'
    section += f'\\sosstage{{{color}}}{{{letter}}}{{{title}}}{{{description}}}\n'
    section += '\\begin{lstlisting}[style=sosreadable]\n'+block+'\\end{lstlisting}\n'
    if readout: section += '{\\small\\textcolor{'+color+'}{\\textbf{Readout:}} '+readout+'}\n'
    section += '\\end{minipage}\n\n'
section += r'''\endgroup

The full \href{https://molarium.org/design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json}{executable action script} contains 159 public actions with full selectors, arguments, and result expectations. Its runner stops on a failed action or expectation. It is distinct from the partial public-action segments attached to individual campaign commits. Parent-linked checkpoint snapshots preserve the saved molecular states, while the release also supplies numerical audits, including candidate coordinates, energies, and rejected alternatives. Thus the reading guide, executable procedure, and saved evidence serve different purposes; none alone is a complete account of the design process.

'''
start = original.index(r'\subsubsection{Pseudocode for the complete movie}')
end = original.index(r'\subsubsection{Human account: decisions and outcomes}',start)
changes = [dict(before='The SOS1 replay expresses a molecular-design procedure as an executable program.',after='The SOS1 replay illustrates more than scriptability: a readable design narrative linked to executable operations and inspectable molecular states.'),
    dict(before=r'Appendix~\ref{app:architecture} pairs pseudocode for the complete movie with a human-readable account of the design decisions and outcomes; the full executable API JSON remains available.',after=r"Appendix~\ref{app:architecture} pairs a figure-linked protocol for the complete movie with a human-readable account of the design decisions and outcomes; the full executable API JSON remains available. This suggests a way to accompany a paper's computational design narrative with shorthand that humans and agents can inspect against explicit operations, checks, and saved results. Readability does not establish scientific correctness, and the shorthand does not replace the full execution record."),
    dict(before=original[start:end],after=section)]
result = original
for c in changes:
    if c['before'].startswith('Appendix~'):
        c['after'] = '\n\n' + c['after']
    assert result.count(c['before']) == 1
    result = result.replace(c['before'],c['after'],1)
pseudo = '\n'.join('# '+s[1]+' | '+s[2]+'\n'+b for s,b in zip(stages,blocks))
def operations(s):
    return re.sub(r'\s+','', '\n'.join(line.split('#',1)[0] for line in s.splitlines()))
assert ''.join(blocks) == old_pseudo
assert operations(pseudo) == operations(old_pseudo)
evidence = json.loads((BASE/'protocol-evidence.json').read_text())
evidence['pseudocodeSha256'] = sha(pseudo.encode())
evidence['presentationRevision'] = dict(base='a24',operationSequenceUnchanged=True,
    panelToCheckpoint=dict(A=1,B=2,C=3,D=5,E=6,F=7),unpicturedCheckpoint=4,stateTrace=[4,5,6],
    provenanceBoundary='Parent-linked snapshots; partial attached public-action histories; separate numerical audits. No claim of complete automatic provenance.')
manifest = dict(schema='molarium.approved-manuscript-readable-protocol/v1',baseRevision=str(BASE.relative_to(ROOT)),baseSourceSha256=sha(original.encode()),outputSha256=sha(result.encode()),changes=changes,allFiguresUnchanged=True,operationalPseudocodeUnchanged=True,newScientificCalculations=False)

def verify():
    assert (OUT/'main.tex').read_text() == result
    assert json.loads((OUT/'edit-manifest.json').read_text()) == manifest
    assert (OUT/'sos1-whole-movie-pseudocode.txt').read_text() == pseudo
    assert json.loads((OUT/'protocol-evidence.json').read_text()) == evidence
    changed = {'main.tex','main.pdf','main.log','README.md','UPLOAD-INSTRUCTIONS.md','edit-manifest.json','sos1-whole-movie-pseudocode.txt','protocol-evidence.json'}
    for f in BASE.rglob('*'):
        if f.is_file() and str(f.relative_to(BASE)) not in changed:
            assert f.read_bytes() == (OUT/f.relative_to(BASE)).read_bytes(), str(f)

if args.command in ('build','refresh'):
    OUT.mkdir(exist_ok=args.command=='refresh')
    for f in BASE.iterdir():
        if f.is_dir(): shutil.copytree(f,OUT/f.name,dirs_exist_ok=True)
        elif f.name not in ('main.pdf','main.log'): shutil.copyfile(f,OUT/f.name)
    (OUT/'main.tex').write_text(result)
    (OUT/'sos1-whole-movie-pseudocode.txt').write_text(pseudo)
    (OUT/'protocol-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (OUT/'changes-from-a24.diff').write_text(''.join(difflib.unified_diff(original.splitlines(True),result.splitlines(True),fromfile='a24/main.tex',tofile='a25/main.tex')))
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Readable protocol and molecular-state trace (a25)

The SOS1 listing uses colored, lettered headings linked to Figure 2,
change/fixed-state descriptions, and selected readouts. A native-LaTeX trace
shows the same AWW graph through ligand placement and receptor response.
Its provenance annotation distinguishes parent-linked snapshots, explicitly
partial public-action segments, and separate numerical audits. The main text
frames the contribution as readable design intent linked to operations and
evidence, not scripting alone or guaranteed scientific correctness.
All operational pseudocode, figure bytes and executable scripts are unchanged.
Exact text replacements are retained in edit-manifest.json and the diff.
No previous revision is overwritten and no science is rerun.
''')
    (OUT/'UPLOAD-INSTRUCTIONS.md').write_text('''# Prism upload (a25)

From a24: replace the whole main.tex only. All figures are unchanged.
The colored annotations and state trace are native LaTeX in main.tex.

From a21, a22, or a23: also replace figures/fig2_sos1_designer_intent.png
and figures/fig4_evidence_ladder_fixed.png (Figure 5's historical filename).
The full ZIP/folder includes all required files. For provenance, also update
sos1-whole-movie-pseudocode.txt and protocol-evidence.json if you keep these
supporting files in Prism; they are not LaTeX inputs.
''')
    verify()
    print(OUT)
elif args.command == 'package':
    verify()
    log = (OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character','Overfull','undefined references','undefined citations','! LaTeX Error'))
    shutil.copyfile(OUT/'main.pdf',PDF)
    files = sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix != '.log' and f.name != 'main.pdf')
    with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(f,str(f.relative_to(OUT)))
    with zipfile.ZipFile(ZIP) as z:
        assert z.testzip() is None
        for f in files: assert z.read(str(f.relative_to(OUT))) == f.read_bytes()
    print(json.dumps(dict(pdf=str(PDF),zip=str(ZIP),files=len(files)),indent=2))
else:
    verify()
    destinations = [Path('/Users/bb/Downloads/molarium-prism-author-approved-a25'),Path('/Users/bb/Downloads/molarium-prism-author-approved-a25.zip'),Path('/Users/bb/Downloads/molarium-author-approved-a25.pdf')]
    assert all(not f.exists() for f in destinations), 'Refusing to overwrite existing delivery'
    assert PDF.read_bytes() == (OUT/'main.pdf').read_bytes()
    shutil.copytree(OUT,destinations[0])
    shutil.copyfile(ZIP,destinations[1])
    shutil.copyfile(PDF,destinations[2])
    for f in OUT.rglob('*'):
        if f.is_file(): assert f.read_bytes() == (destinations[0]/f.relative_to(OUT)).read_bytes()
    assert ZIP.read_bytes() == destinations[1].read_bytes()
    assert PDF.read_bytes() == destinations[2].read_bytes()
    print(json.dumps([str(p) for p in destinations],indent=2))
