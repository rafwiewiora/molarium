"""Preserve a26; replace only the value-layer figure with its reviewed cleanup."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-08-matched-figure-font-a26'
OUT = ROOT/'paper/revisions/2026-09-08-value-figure-cleanup-a27'
FIGURE = 'figures/fig5_value_layers_fixed.png'
PDF = ROOT/'output/pdf/molarium-author-approved-a27.pdf'
ZIP = ROOT/'output/prism/molarium-prism-author-approved-a27.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build','package','downloads'])
parser.add_argument('--image',type=Path,help='Reviewed cleanup PNG; required for build.')
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
    exceptions = {FIGURE,'README.md','UPLOAD-INSTRUCTIONS.md','edit-manifest.json','main.pdf','main.log'}
    for f in BASE.rglob('*'):
        if f.is_file() and str(f.relative_to(BASE)) not in exceptions:
            assert f.read_bytes() == (OUT/f.relative_to(BASE)).read_bytes(),str(f.relative_to(BASE))
    return manifest

if args.command == 'build':
    if args.image is None:
        parser.error('--image is required for build')
    image = args.image.resolve(strict=True)
    image_bytes = image.read_bytes()
    assert image_bytes.startswith(b'\x89PNG\r\n\x1a\n'),'Input must be a PNG'
    assert sha(image_bytes) != sha((BASE/FIGURE).read_bytes()),'Figure is unchanged'
    OUT.mkdir(exist_ok=False)
    for f in BASE.iterdir():
        if f.is_dir():
            shutil.copytree(f,OUT/f.name)
        elif f.name not in ('main.pdf','main.log','edit-manifest.json','README.md','UPLOAD-INSTRUCTIONS.md'):
            shutil.copyfile(f,OUT/f.name)
    shutil.copyfile(image,OUT/FIGURE)
    manifest = dict(schema='molarium.approved-manuscript-value-figure-cleanup/v1',
        baseRevision=str(BASE.relative_to(ROOT)),baseSourceSha256=sha(original),outputSha256=sha(original),
        changes=[],allTextUnchanged=True,allOtherFiguresUnchanged=True,
        figureChange=dict(path=FIGURE,source=str(image),
            method='AI raster edit via image_gen; repair middle-box white edge gap and remove line-wrap hyphen from rationale',
            preservationScope='All wording visually checked retained; rationale line wrapping corrected. Raster resampled with added outer whitespace; no claim of pixel-identical preservation elsewhere.',
            beforeSha256=sha((BASE/FIGURE).read_bytes()),afterSha256=sha(image_bytes)))
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Figure 6 cleanup (a27)

Only figures/fig5_value_layers_fixed.png (Figure 6's historical filename) is
replaced. The image edit repairs a white edge gap in the middle box and keeps
the word rationale unhyphenated in the upper box. The wording is retained;
only its wrapping and the border are intentionally corrected. This AI raster
edit also resampled the image and added outer whitespace; pixel-identical
preservation elsewhere is not claimed.

main.tex is byte-identical to a26. Every other source and figure is unchanged.
The edit manifest records the input image and old/new hashes. All previous
revisions are preserved, and no scientific input or result is changed.
''')
    (OUT/'UPLOAD-INSTRUCTIONS.md').write_text('''# Prism upload (a27)

From a26, replace only:

    figures/fig5_value_layers_fixed.png

This historical filename is Figure 6. main.tex and all other figures remain
unchanged from a26. Keep the filename and figures/ directory unchanged.
The complete ZIP includes all source files. The whole Downloads folder also
contains the compiled main.pdf and compilation log for convenience.
''')
    verify()
    print(OUT)
elif args.command == 'package':
    verify()
    log = (OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character','Overfull','undefined references','undefined citations','! LaTeX Error'))
    PDF.parent.mkdir(parents=True,exist_ok=True)
    ZIP.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(OUT/'main.pdf',PDF)
    files = sorted(f for f in OUT.rglob('*') if f.is_file() and f.suffix != '.log' and f.name != 'main.pdf')
    with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as archive:
        for f in files:
            archive.write(f,str(f.relative_to(OUT)))
    with zipfile.ZipFile(ZIP) as archive:
        assert archive.testzip() is None
        for f in files:
            assert archive.read(str(f.relative_to(OUT))) == f.read_bytes()
    print(json.dumps(dict(pdf=str(PDF),zip=str(ZIP),files=len(files)),indent=2))
else:
    verify()
    destinations = [Path('/Users/bb/Downloads/molarium-prism-author-approved-a27'),
        Path('/Users/bb/Downloads/molarium-prism-author-approved-a27.zip'),
        Path('/Users/bb/Downloads/molarium-author-approved-a27.pdf')]
    assert all(not p.exists() for p in destinations),'Refusing to overwrite existing Downloads delivery'
    assert PDF.read_bytes() == (OUT/'main.pdf').read_bytes()
    with zipfile.ZipFile(ZIP) as archive:
        assert archive.testzip() is None and archive.read('main.tex') == original
    shutil.copytree(OUT,destinations[0])
    shutil.copyfile(ZIP,destinations[1])
    shutil.copyfile(PDF,destinations[2])
    for f in OUT.rglob('*'):
        if f.is_file():
            assert f.read_bytes() == (destinations[0]/f.relative_to(OUT)).read_bytes()
    assert ZIP.read_bytes() == destinations[1].read_bytes()
    assert PDF.read_bytes() == destinations[2].read_bytes()
    print(json.dumps(dict(folder=str(destinations[0]),zip=str(destinations[1]),pdf=str(destinations[2])),indent=2))
