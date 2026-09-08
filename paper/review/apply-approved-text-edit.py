"""Build and package exact author-approved edits, preserving their base."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, zipfile

p = argparse.ArgumentParser()
p.add_argument('mode', choices=['build', 'package'])
p.add_argument('--base', required=True)
p.add_argument('--revision', required=True)
p.add_argument('--before', required=True, action='append')
p.add_argument('--after', required=True, action='append')
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
base = root / 'paper/revisions' / a.base
revision = root / 'paper/revisions' / a.revision
source = (base / 'main.tex').read_text()
assert len(a.before) == len(a.after)
changes = [{'before': before, 'after': after} for before, after in zip(a.before, a.after)]
result = source
for change in changes:
    assert result.count(change['before']) == 1
    result = result.replace(change['before'], change['after'], 1)
sha = lambda data: hashlib.sha256(data).hexdigest()
manifest = {'schema': 'molarium.approved-manuscript-edits/v1', 'baseRevision': str(base.relative_to(root)), 'baseSourceSha256': sha(source.encode()), 'outputSha256': sha(result.encode()), 'changes': changes, 'allOtherTextAndFiguresUnchanged': True}
if a.mode == 'build':
    revision.mkdir(exist_ok=False)
    (revision / 'main.tex').write_text(result)
    shutil.copytree(base / 'figures', revision / 'figures')
    (revision / 'edit-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (revision / 'README.md').write_text('# Molarium — author-approved revision\n\nImport this directory into Prism and compile main.tex with XeLaTeX. All six figures and the inline bibliography are included.\n\nThe edit manifest records the exact changes in this revision, its preserved base revision and source hashes. All earlier approved changes remain in place, including removal of Appendix C. Earlier sources and editorial history remain archived separately.\n\nRelease caveat carried forward: removal of the default 500-action audit-history limit is tested locally but was not yet deployed at public code commit 2ab30383d6160349aa3b1e980f7239d6854b329d.\n')
else:
    assert (revision / 'main.tex').read_text() == result
    assert json.loads((revision / 'edit-manifest.json').read_text()) == manifest
    for f in (base / 'figures').iterdir():
        assert f.read_bytes() == (revision / 'figures' / f.name).read_bytes()
    log = (revision / 'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    text = subprocess.check_output(['pdftotext', str(revision / 'main.pdf'), '-']).decode()
    assert 'Figure file not included' not in text
    suffix = a.revision.rsplit('-', 1)[-1]
    pdf = root / f'output/pdf/molarium-author-approved-{suffix}.pdf'
    bundle = root / f'output/prism/molarium-prism-author-approved-{suffix}.zip'
    shutil.copyfile(revision / 'main.pdf', pdf)
    files = [revision / n for n in ('main.tex', 'README.md', 'edit-manifest.json')] + sorted((revision / 'figures').iterdir())
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(f, str(f.relative_to(revision)))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert z.read('main.tex') == result.encode()
    print(json.dumps({'pdf': str(pdf), 'zip': str(bundle), 'pages': len(text.split('\f')) - 1}, indent=2))
