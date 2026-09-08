"""Preserve a23 text and assets; replace only the evidence-ladder figure image."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-07-chemical-difference-a23'
OUT = ROOT/'paper/revisions/2026-09-07-evidence-arrow-a24'
FIGURE = 'figures/fig4_evidence_ladder_fixed.png'
PDF = ROOT/'output/pdf/molarium-author-approved-a24.pdf'
ZIP = ROOT/'output/prism/molarium-prism-author-approved-a24.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build', 'package', 'downloads'])
parser.add_argument('--image', type=Path, help='Corrected evidence-ladder PNG; required for build.')
args = parser.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
original = (BASE/'main.tex').read_bytes()

def verify():
    manifest = json.loads((OUT/'edit-manifest.json').read_text())
    assert (OUT/'main.tex').read_bytes() == original
    assert manifest['baseSourceSha256'] == manifest['outputSha256'] == sha(original)
    assert manifest['changes'] == [] and manifest['allTextUnchanged']
    assert manifest['figureChange']['beforeSha256'] == sha((BASE/FIGURE).read_bytes())
    assert manifest['figureChange']['afterSha256'] == sha((OUT/FIGURE).read_bytes())
    assert manifest['figureChange']['beforeSha256'] != manifest['figureChange']['afterSha256']
    for f in BASE.rglob('*'):
        if not f.is_file():
            continue
        relative = str(f.relative_to(BASE))
        if relative not in (FIGURE, 'README.md', 'edit-manifest.json', 'main.pdf', 'main.log'):
            assert f.read_bytes() == (OUT/relative).read_bytes(), relative
    return manifest

if args.command == 'build':
    if args.image is None:
        parser.error('--image is required for build')
    image = args.image.resolve(strict=True)
    image_bytes = image.read_bytes()
    assert image_bytes.startswith(b'\x89PNG\r\n\x1a\n'), 'Input must be a PNG'
    assert sha(image_bytes) != sha((BASE/FIGURE).read_bytes()), 'Figure is unchanged'
    OUT.mkdir(exist_ok=False)
    for f in BASE.iterdir():
        if f.is_dir():
            shutil.copytree(f, OUT/f.name)
        elif f.name not in ('main.pdf', 'main.log', 'edit-manifest.json', 'README.md'):
            shutil.copyfile(f, OUT/f.name)
    shutil.copyfile(image, OUT/FIGURE)
    manifest = dict(schema='molarium.approved-manuscript-evidence-arrow/v1',
        baseRevision=str(BASE.relative_to(ROOT)), baseSourceSha256=sha(original),
        outputSha256=sha(original), changes=[], allTextUnchanged=True,
        allOtherFiguresUnchanged=True,
        figureChange=dict(path=FIGURE, source=str(image),
            method='AI raster edit via image_gen; arrow-label overlap correction; parent visually inspected',
            preservationScope='Wording and box layout visually retained; image resampled, so pixels elsewhere are not claimed identical',
            beforeSha256=sha((BASE/FIGURE).read_bytes()), afterSha256=sha(image_bytes)))
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Evidence-ladder arrow correction (a24)

Only the evidence-ladder figure image (figures/fig4_evidence_ladder_fixed.png)
has been replaced to correct its arrow. The supplied raster was edited with
image_gen to place the grey label on the arrow axis and clear the shaft from
the text. The wording and box layout were visually checked; the raster was
resampled, so pixel-identical preservation elsewhere is not claimed.
main.tex is byte-identical to a23,
and every other figure and supporting source file is unchanged. The edit
manifest records the exact source image and old/new image hashes. All earlier
revisions remain archived. No scientific input or result has changed.
''')
    (OUT/'UPLOAD-INSTRUCTIONS.md').write_text('''# Prism upload (a24)

The ZIP contains the complete source folder. To update an existing Prism
project based on a21, replace these three manuscript inputs:

1. main.tex
2. figures/fig2_sos1_designer_intent.png
3. figures/fig4_evidence_ladder_fixed.png

Keep the figure filenames and the figures/ directory unchanged. The second
image above is Figure 2; the third is the evidence-ladder Figure 5 despite its
historical filename. Other figure files are unchanged from a21. Supporting
provenance JSON files, README, and edit-manifest.json are included for history
and do not need to be referenced by LaTeX. The complete folder in Downloads
also contains the compiled main.pdf and compilation log for convenience.
''')
    verify()
    print(OUT)
elif args.command == 'package':
    verify()
    log = (OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    PDF.parent.mkdir(parents=True, exist_ok=True)
    ZIP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT/'main.pdf', PDF)
    files = sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix != '.log' and f.name != 'main.pdf')
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as archive:
        for f in files:
            archive.write(f, str(f.relative_to(OUT)))
    with zipfile.ZipFile(ZIP) as archive:
        assert archive.testzip() is None
        assert archive.read('main.tex') == original
        for f in files:
            assert archive.read(str(f.relative_to(OUT))) == f.read_bytes()
    print(json.dumps(dict(pdf=str(PDF), zip=str(ZIP), files=len(files)), indent=2))
else:
    verify()
    destinations = [Path('/Users/bb/Downloads/molarium-prism-author-approved-a24'),
        Path('/Users/bb/Downloads/molarium-prism-author-approved-a24.zip'),
        Path('/Users/bb/Downloads/molarium-author-approved-a24.pdf')]
    assert all(not p.exists() for p in destinations), 'Refusing to overwrite any existing Downloads delivery'
    assert PDF.read_bytes() == (OUT/'main.pdf').read_bytes()
    with zipfile.ZipFile(ZIP) as archive:
        assert archive.testzip() is None and archive.read('main.tex') == original
    shutil.copytree(OUT, destinations[0])
    shutil.copyfile(ZIP, destinations[1])
    shutil.copyfile(PDF, destinations[2])
    for f in OUT.rglob('*'):
        if f.is_file():
            assert f.read_bytes() == (destinations[0]/f.relative_to(OUT)).read_bytes()
    assert ZIP.read_bytes() == destinations[1].read_bytes()
    assert PDF.read_bytes() == destinations[2].read_bytes()
    print(json.dumps(dict(folder=str(destinations[0]), zip=str(destinations[1]), pdf=str(destinations[2])), indent=2))
