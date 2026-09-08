"""Preserve a22; correct Figure 2 chemical highlights and two caption sentences."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-07-aligned-chemistry-a22'
OUT = ROOT/'paper/revisions/2026-09-07-chemical-difference-a23'
CAPTURE = ROOT/'paper/review/captures/2026-09-07-chemical-difference-a23'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build', 'refresh', 'package'])
args = parser.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
original = (BASE/'main.tex').read_bytes()
before = 'Orange 2D highlights mark atoms outside the registered conserved atom-lineage subgraph relative to the preceding chemical graph; they do not depict a synthetic reaction mechanism.'
after = r"Orange 2D highlights mark added atoms and local chemical changes relative to the preceding structure; equivalent Kekul\'e representations and reassigned atom identifiers do not count as changes."
changes = [dict(before=before, after=after), dict(
    before='(F) BAY-293: move the thiophene attachment, replace the alcohol with an N-methylamine, and restore the aromatic core.',
    after='(F) BAY-293: move the thiophene attachment and replace the alcohol with an N-methylamine.')]
result = original
for change in changes:
    assert result.count(change['before'].encode()) == 1
    result = result.replace(change['before'].encode(), change['after'].encode(), 1)
names = ['fig2_sos1_designer_intent.png', 'fig2_sos1_designer_intent.provenance.json']
manifest = dict(schema='molarium.approved-manuscript-chemical-difference-figure/v1',
    baseRevision=str(BASE.relative_to(ROOT)), baseSourceSha256=sha(original),
    outputSha256=sha(result), changes=changes,
    allOtherTextUnchanged=True, allOtherFiguresUnchanged=True,
    figureChanges={n:sha((CAPTURE/n).read_bytes()) for n in names})
if args.command in ('build', 'refresh'):
    refresh = args.command == 'refresh'
    if refresh:
        assert json.loads((OUT/'edit-manifest.json').read_text())['baseSourceSha256'] == sha(original)
    OUT.mkdir(exist_ok=refresh)
    for f in BASE.iterdir():
        if f.is_dir():
            shutil.copytree(f, OUT/f.name, dirs_exist_ok=refresh)
        elif f.suffix not in ('.pdf', '.log') and f.name not in ('main.tex', 'edit-manifest.json', 'README.md'):
            shutil.copyfile(f, OUT/f.name)
    for name in names:
        shutil.copyfile(CAPTURE/name, OUT/'figures'/name)
    (OUT/'main.tex').write_bytes(result)
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Chemical-difference Figure 2 correction (a23)

The six panels remain native whole-tool screenshots with their shared 2D
scaffold alignment. Orange highlights now describe added atoms and local
chemical differences, not differences in persistent atom identifiers alone.
Equivalent aromatic Kekule representations do not count as chemical edits.
The depicted structures remain those of the frozen PDB-derived run. They are
not silently substituted with the source paper's aromatic AWW structure.

Two sentences in the Figure 2 caption change: the highlight description is
corrected, and the unsupported claim of a designer-driven restoration of the
aromatic core is removed from step F. All other manuscript text and figures remain
byte-identical to a22. The prior revisions and their captures remain archived.
The edit manifest records both exact replacements and both source hashes.
No frozen graph, scientific checkpoint, stereochemistry, or saved 3D coordinate
is changed. See paper/review/CHEMICAL-DIFFERENCE-REVIEW-2026-09-07.md in the
repository for the mapping evidence, limitations, and reproduction checks.

The source-graph discrepancy and the author's explicit decision to retain the
existing model without recomputation are documented in the public repository:
https://github.com/rafwiewiora/molarium/blob/main/reviews/SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md. This provenance
discussion is not a new manuscript appendix or a claim that the deposited
chemical dictionary and the published medicinal-chemistry drawing agree.
''')
    print(OUT)
else:
    assert (OUT/'main.tex').read_bytes() == result
    assert json.loads((OUT/'edit-manifest.json').read_text()) == manifest
    for f in (BASE/'figures').iterdir():
        if f.name not in names:
            assert f.read_bytes() == (OUT/'figures'/f.name).read_bytes()
    for f in BASE.iterdir():
        if f.is_file() and f.suffix in ('.tex', '.json', '.txt') and f.name not in ('main.tex','edit-manifest.json'):
            assert f.read_bytes() == (OUT/f.name).read_bytes()
    log = (OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    pdf = ROOT/'output/pdf/molarium-author-approved-a23.pdf'
    bundle = ROOT/'output/prism/molarium-prism-author-approved-a23.zip'
    pdf.parent.mkdir(parents=True, exist_ok=True)
    bundle.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT/'main.pdf', pdf)
    files = sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix != '.log' and f.name != 'main.pdf')
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
        for f in files:
            archive.write(f, str(f.relative_to(OUT)))
    with zipfile.ZipFile(bundle) as archive:
        assert archive.testzip() is None and archive.read('main.tex') == result
    print(json.dumps(dict(pdf=str(pdf), zip=str(bundle), files=len(files)), indent=2))
