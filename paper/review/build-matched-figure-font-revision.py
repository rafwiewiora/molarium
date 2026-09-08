"""Preserve a25; replace only the build-loop figure with matched-font assets."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, unicodedata, zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'paper/revisions/2026-09-08-readable-protocol-a25'
OUT = ROOT/'paper/revisions/2026-09-08-matched-figure-font-a26'
CAPTURE = ROOT/'paper/review/captures/2026-09-08-matched-figure-font-a26'
NAMES = ['fig3_build_loop_compact.pdf', 'fig3_build_loop_compact.png', 'fig3_build_loop_compact.provenance.json']
PDF = ROOT/'output/pdf/molarium-author-approved-a26.pdf'
ZIP = ROOT/'output/prism/molarium-prism-author-approved-a26.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['build','package','downloads'])
args = parser.parse_args()
sha = lambda b: hashlib.sha256(b).hexdigest()
original = (BASE/'main.tex').read_bytes()

def words(path):
    text = subprocess.check_output(['pdftotext','-layout',str(path),'-'],text=True)
    return unicodedata.normalize('NFKC',text).split()

def verify():
    manifest = json.loads((OUT/'edit-manifest.json').read_text())
    assert (OUT/'main.tex').read_bytes() == original
    assert manifest['baseSourceSha256'] == manifest['outputSha256'] == sha(original)
    assert manifest['changes'] == [] and manifest['allTextUnchanged']
    for name in NAMES:
        change = manifest['figureChanges'][name]
        assert change['beforeSha256'] == sha((BASE/'figures'/name).read_bytes())
        assert change['afterSha256'] == sha((OUT/'figures'/name).read_bytes())
        assert (OUT/'figures'/name).read_bytes() == (CAPTURE/name).read_bytes()
    assert words(BASE/'figures'/NAMES[0]) == words(OUT/'figures'/NAMES[0]), 'Figure wording changed'
    exceptions = {'README.md','UPLOAD-INSTRUCTIONS.md','edit-manifest.json','main.pdf','main.log'} | {'figures/'+name for name in NAMES}
    for f in BASE.rglob('*'):
        if f.is_file() and str(f.relative_to(BASE)) not in exceptions:
            assert f.read_bytes() == (OUT/f.relative_to(BASE)).read_bytes(), str(f.relative_to(BASE))
    return manifest

if args.command == 'build':
    for name in NAMES:
        assert (CAPTURE/name).is_file(), name
    assert words(BASE/'figures'/NAMES[0]) == words(CAPTURE/NAMES[0]), 'Figure wording changed'
    assert (CAPTURE/NAMES[1]).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    json.loads((CAPTURE/NAMES[2]).read_text())
    OUT.mkdir(exist_ok=False)
    for f in BASE.iterdir():
        if f.is_dir():
            shutil.copytree(f,OUT/f.name)
        elif f.name not in ('main.pdf','main.log','edit-manifest.json','README.md','UPLOAD-INSTRUCTIONS.md'):
            shutil.copyfile(f,OUT/f.name)
    for name in NAMES:
        shutil.copyfile(CAPTURE/name,OUT/'figures'/name)
    manifest = dict(schema='molarium.approved-manuscript-matched-figure-font/v1',
        baseRevision=str(BASE.relative_to(ROOT)),baseSourceSha256=sha(original),outputSha256=sha(original),
        changes=[],allTextUnchanged=True,allOtherFiguresUnchanged=True,figureWordingUnchanged=True,
        figureChanges={name:dict(source=str((CAPTURE/name).relative_to(ROOT)),
            beforeSha256=sha((BASE/'figures'/name).read_bytes()),afterSha256=sha((CAPTURE/name).read_bytes())) for name in NAMES})
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'''\n## Figure 4 font matching (a26)

The build-loop Figure 4 uses native vector geometry and Latin Modern text to
match the manuscript typography. The PDF, PNG backup, and figure provenance
are replaced together. Extracted figure wording is unchanged. main.tex is
byte-identical to a25, and all other source files and figures are preserved.
The edit manifest records both old and new hashes. No scientific operation,
input, result, or previous revision is changed.
''')
    (OUT/'UPLOAD-INSTRUCTIONS.md').write_text('''# Prism upload (a26)

From a25, replace only:

    figures/fig3_build_loop_compact.pdf

This historical filename is the manuscript's Figure 4. The matching PNG is
an optional backup; keeping it and the provenance JSON in sync is recommended.
main.tex and all other figures are unchanged from a25.

The complete ZIP contains all source files. The whole folder in Downloads
also contains the compiled main.pdf and compilation log for convenience.
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
    destinations = [Path('/Users/bb/Downloads/molarium-prism-author-approved-a26'),
        Path('/Users/bb/Downloads/molarium-prism-author-approved-a26.zip'),
        Path('/Users/bb/Downloads/molarium-author-approved-a26.pdf')]
    assert all(not p.exists() for p in destinations), 'Refusing to overwrite existing Downloads delivery'
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
