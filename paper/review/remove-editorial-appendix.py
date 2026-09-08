"""Create the requested no-Appendix-C deliverable without changing prior revisions."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
base = root / 'paper/revisions/2026-09-06-current-sos1-api-a05'
revision = root / 'paper/revisions/2026-09-06-no-editorial-appendix-a06'
sha = lambda data: hashlib.sha256(data).hexdigest()
source = (base / 'main.tex').read_text()
assert sha(source.encode()) == '7778e8628d62feba95346372ab0f659cb1f75d76ffede5b9b09df0feb4c696f3'
marker = r'\appendixsection{Editorial history: recovered paragraph versions}{app:paragraph-history}'
bib = r'\begin{thebibliography}{99}'
assert source.count(marker) == source.count(bib) == 1
prefix, history = source.split(marker)
removed, bibliography = history.split(bib)
result = prefix + '\\clearpage\n\n' + bib + bibliography
assert 'app:paragraph-history' not in result
assert 'Appendix C' not in result

if sys.argv[1] == 'build':
    revision.mkdir(exist_ok=False)
    (revision / 'main.tex').write_text(result)
    shutil.copytree(base / 'figures', revision / 'figures')
    manifest = {
        'schema': 'molarium.remove-editorial-appendix/v1',
        'request': 'Remove Appendix C from the paper; retain archived history.',
        'baseSourceSha256': sha(source.encode()),
        'outputSha256': sha(result.encode()),
        'removedAppendixSha256': sha((marker + removed).encode()),
        'mainTextAndAppendicesABUnchanged': True,
        'bibliographyUnchanged': True,
        'archivedSource': str(base.relative_to(root) / 'main.tex'),
    }
    (revision / 'removal-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    readme = (base / 'README.md').read_text()
    readme = readme.replace('Tectonic successfully compiled the supplied source to 71 pages.', 'The editorial-history Appendix C has been removed at the author\'s request; the main text, Appendices A/B, figures and bibliography are unchanged from a05.')
    readme = readme.replace('`reconciliation-manifest.json` records every before/after replacement and figure hash. Appendix C and the bibliography remain verbatim historical records, not current API documentation.', '`removal-manifest.json` records this removal and identifies the preserved a05 source. The earlier editorial history and reconciliation records remain in the repository review/revisions archive, outside this paper bundle.')
    (revision / 'README.md').write_text(readme)
    print(revision)
elif sys.argv[1] == 'package':
    assert (revision / 'main.tex').read_text() == result
    log = (revision / 'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    text = subprocess.check_output(['pdftotext', str(revision / 'main.pdf'), '-']).decode()
    assert 'Editorial history: recovered paragraph versions' not in text
    assert 'Figure file not included' not in text
    pages = len(text.split('\f')) - 1
    pdf = root / 'output/pdf/molarium-final-no-appendix-c-2026-09-06.pdf'
    bundle = root / 'output/prism/molarium-prism-no-appendix-c-2026-09-06.zip'
    shutil.copyfile(revision / 'main.pdf', pdf)
    files = [revision / n for n in ('main.tex', 'README.md', 'removal-manifest.json')] + sorted((revision / 'figures').iterdir())
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, str(f.relative_to(revision)))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert z.read('main.tex') == result.encode()
    print(json.dumps({'pdf': str(pdf), 'zip': str(bundle), 'pages': pages}, indent=2))
else:
    raise ValueError('Choose build or package')
