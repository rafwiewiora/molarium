"""Preserve a21 verbatim; replace only Figure 2 with aligned native screenshots."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-07-interface-chemistry-a21'
OUT = ROOT/'paper/revisions/2026-09-07-aligned-chemistry-a22'
CAPTURE = ROOT/'paper/review/captures/2026-09-07-aligned-chemistry-a22'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build', 'refresh', 'package'])
args = parser.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
original = (BASE/'main.tex').read_bytes()
names = ['fig2_sos1_designer_intent.png', 'fig2_sos1_designer_intent.provenance.json']
manifest = dict(schema='molarium.approved-manuscript-aligned-figure/v1',
    baseRevision=str(BASE.relative_to(ROOT)), baseSourceSha256=sha(original),
    outputSha256=sha(original), changes=[], allTextUnchanged=True,
    allOtherFiguresUnchanged=True,
    figureChanges={n:sha((CAPTURE/n).read_bytes()) for n in names})
if args.command in ('build', 'refresh'):
    refresh = args.command == 'refresh'
    if refresh:
        assert json.loads((OUT/'edit-manifest.json').read_text())['baseSourceSha256'] == sha(original)
    OUT.mkdir(exist_ok=refresh)
    for f in BASE.iterdir():
        if f.is_dir():
            shutil.copytree(f, OUT/f.name, dirs_exist_ok=refresh)
        elif f.suffix not in ('.pdf', '.log') and f.name not in ('edit-manifest.json', 'README.md'):
            shutil.copyfile(f, OUT/f.name)
    for name in names:
        shutil.copyfile(CAPTURE/name, OUT/'figures'/name)
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Shared-scaffold Figure 2 alignment (a22)

The six panels remain genuine, unaltered full-tool screenshots. Native RDKit
2D coordinates now align the eight shared scaffold atoms across all ligands.
Step B retains its correct AWT graph; the depiction path now preserves explicit
hydrogens through sanitization before removing them for drawing, preventing the
pyrazole N-H information from being lost. The molecular graph, stereochemistry,
saved 3D coordinates, and scientific checkpoint files are unchanged.

main.tex is byte-identical to a21, including its Figure 2 caption, appendix
disclosures, and pseudocode. Every other figure is unchanged. The original
a21 revision and screenshots remain available. See the public repository's
paper/review/ALIGNED-DEPICTION-REVIEW-2026-09-07.md for the findings, checks,
and exact capture/rebuild commands.
''')
    assert (OUT/'main.tex').read_bytes() == original
    print(OUT)
else:
    assert (OUT/'main.tex').read_bytes() == original
    assert json.loads((OUT/'edit-manifest.json').read_text()) == manifest
    for f in (BASE/'figures').iterdir():
        if f.name not in names:
            assert f.read_bytes() == (OUT/'figures'/f.name).read_bytes()
    for f in BASE.iterdir():
        if f.is_file() and f.suffix in ('.tex', '.json', '.txt') and f.name != 'edit-manifest.json':
            assert f.read_bytes() == (OUT/f.name).read_bytes()
    log = (OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    pdf = ROOT/'output/pdf/molarium-author-approved-a22.pdf'
    bundle = ROOT/'output/prism/molarium-prism-author-approved-a22.zip'
    pdf.parent.mkdir(parents=True, exist_ok=True)
    bundle.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT/'main.pdf', pdf)
    files = sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix != '.log' and f.name != 'main.pdf')
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
        for f in files:
            archive.write(f, str(f.relative_to(OUT)))
    with zipfile.ZipFile(bundle) as archive:
        assert archive.testzip() is None and archive.read('main.tex') == original
    print(json.dumps(dict(pdf=str(pdf), zip=str(bundle), files=len(files)), indent=2))
