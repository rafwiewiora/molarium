"""Apply the two explicitly approved introduction edits to immutable a06."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, zipfile

root = Path(__file__).resolve().parents[2]
base = root / 'paper/revisions/2026-09-06-no-editorial-appendix-a06'
revision = root / 'paper/revisions/2026-09-06-approved-intro-a07'
source = (base / 'main.tex').read_text()
sha = lambda b: hashlib.sha256(b).hexdigest()
assert sha(source.encode()) == '191fe427b4dd10fdb31bf732657227b07a3a17688b8109c5a6de1842885c0d4d'
changes = [
    {'before': r'Appendix~\ref{app:manual} provides a module-by-module reference distinguishing current, experimental, repository-only, proposed, and retired functionality.',
     'after': r'Appendix~\ref{app:manual} describes scientific workflows for human users and agents, pairing interface instructions with agent skill contracts and public API examples, and clarifying the requirements, outputs, and limitations of each workflow.'},
    {'before': r" The optional connected-mode sequence-alignment search remains an explicit remote step (Appendix~\ref{app:manual}).", 'after': ''},
]
result = source
for change in changes:
    assert result.count(change['before']) == 1
    result = result.replace(change['before'], change['after'], 1)

if sys.argv[1] == 'build':
    revision.mkdir(exist_ok=False)
    (revision / 'main.tex').write_text(result)
    shutil.copytree(base / 'figures', revision / 'figures')
    manifest = {'schema': 'molarium.approved-manuscript-edits/v1', 'baseSourceSha256': sha(source.encode()), 'outputSha256': sha(result.encode()), 'changes': changes, 'baseRevision': str(base.relative_to(root)), 'allOtherTextAndFiguresUnchanged': True}
    (revision / 'edit-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (revision / 'README.md').write_text('# Molarium — approved introduction edits, a07\n\nImport this directory into Prism and compile main.tex with XeLaTeX. All six figures and the inline bibliography are included.\n\nThis revision changes only two passages from a06: it describes Appendix B in terms of human workflows, agent skill contracts and public API examples; and removes the standalone connected-mode sequence-alignment sentence from the introduction. The surrounding local-calculation qualifiers and the detailed appendix descriptions remain unchanged. Appendix C remains excluded. The ChemCrow/ChemGraph passage is unchanged, as requested.\n\nThe edit manifest records the exact replacements and source hashes. Prior revisions and editorial history remain archived in the repository worktree.\n\nRelease caveat carried forward: removal of the default 500-action audit-history limit is tested locally but was not yet deployed at public code commit 2ab30383d6160349aa3b1e980f7239d6854b329d.\n')
elif sys.argv[1] == 'package':
    assert (revision / 'main.tex').read_text() == result
    for path in (base / 'figures').iterdir():
        assert path.read_bytes() == (revision / 'figures' / path.name).read_bytes()
    log = (revision / 'main.log').read_text()
    assert not any(s in log for s in ('Missing character', 'Overfull', 'undefined references', 'undefined citations', '! LaTeX Error'))
    text = subprocess.check_output(['pdftotext', str(revision / 'main.pdf'), '-']).decode()
    assert 'Figure file not included' not in text
    assert 'Editorial history: recovered paragraph versions' not in text
    pdf = root / 'output/pdf/molarium-author-approved-a07.pdf'
    bundle = root / 'output/prism/molarium-prism-author-approved-a07.zip'
    shutil.copyfile(revision / 'main.pdf', pdf)
    files = [revision / n for n in ('main.tex', 'README.md', 'edit-manifest.json')] + sorted((revision / 'figures').iterdir())
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(f, str(f.relative_to(revision)))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert z.read('main.tex') == result.encode()
    print(json.dumps({'pdf': str(pdf), 'zip': str(bundle), 'pages': len(text.split('\f')) - 1}, indent=2))
else:
    raise ValueError('Choose build or package')
