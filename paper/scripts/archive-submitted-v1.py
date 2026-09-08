#!/usr/bin/env python3
"""Archive the submitted PDF and explicitly scoped manuscript intermediates.

Original manuscript/artifact bytes are retained, including historical path strings.
No source is claimed to reproduce a PDF unless that relationship is established.
"""
import argparse
import hashlib
import json
import subprocess
import re
import difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = ROOT / 'paper/submissions/chemrxiv-v1-2026-09-08'
ARCHIVE = ROOT / 'paper/review/history-2026-09-08'
EXPECTED_PDF = 'caa49f6fa273387ce52d0f51e15bbfc6ad23518e25350e49b004cb1259740cad'
sha = lambda b: hashlib.sha256(b).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-repo', type=Path, required=True)
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--submitted-tex', type=Path, required=True)
    args = parser.parse_args()
    source = args.source_repo.resolve()
    assert source != ROOT
    records = []
    def preserve(path, destination, origin, status='historical intermediate; not submitted v1'):
        data = path.read_bytes()
        if destination.exists():
            assert destination.read_bytes() == data, f'Refusing overwrite: {destination}'
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        records.append(dict(path=str(destination.relative_to(ROOT)), sha256=sha(data), bytes=len(data), origin=origin, status=status))

    # Copy only new paper files. The original tracked recovery commit is merged
    # separately to preserve its ancestry, exact bytes, and private-DOCX exclusions.
    paths = subprocess.check_output(['git', '-C', str(source), 'ls-files', '--others', '--exclude-standard', '--',
        'paper/review', 'paper/revisions', 'paper/scripts'], text=True).splitlines()
    allowed = {'.md', '.py', '.mjs', '.json', '.tex', '.txt', '.diff', '.png', '.pdf', '.svg', '.mol', '.bib', '.html'}
    for name in sorted(paths):
        path = source / name
        if path.suffix.lower() not in allowed or any(x in path.parts for x in ('__pycache__', 'private')):
            continue
        preserve(path, ROOT/name, 'local manuscript worktree: '+name)
    for folder in ('interface-chemistry-2026-09-07', 'interface-aligned-chemistry-2026-09-07', 'interface-chemical-difference-2026-09-07'):
        relative = Path('design-history/publications/sos1')/folder
        for path in sorted((source/relative).rglob('*')):
            if path.is_file() and path.suffix in {'.json', '.md'}:
                preserve(path, ROOT/path.relative_to(source), 'local figure-presentation record: '+str(path.relative_to(source)))

    # Keep the exact application draft needed to explain local figure captures,
    # as a non-executable patch, not as changes to deployed application modules.
    draft_paths = ['app.js', 'chemist-actions.mjs', 'index.html', 'rdkit-worker.js', 'styles.css',
        'CHEMIST-ACTIONS-API.md', 'scripts/native-audit-collector.mjs', 'scripts/build-web.mjs']
    patch = subprocess.check_output(['git', '-C', str(source), 'diff', '--binary', 'HEAD', '--', *draft_paths])
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    patch_path = ARCHIVE/'local-figure-preparation-and-audit-draft.patch'
    patch_path.write_bytes(patch)
    records.append(dict(path=str(patch_path.relative_to(ROOT)),sha256=sha(patch),bytes=len(patch),origin='git diff from baf18d4 in manuscript worktree',status='unmerged application draft; archival only; not deployed'))
    for name in ('chemist-actions-history.test.mjs', 'depiction-highlights.test.mjs'):
        preserve(source/name, ARCHIVE/'application-draft-tests'/name, 'local application draft test: '+name, 'archival only; not a production regression claim')

    for name in ('main (10).pdf', 'main (11).pdf', 'main (12).pdf'):
        preserve(args.downloads/name, ARCHIVE/'downloads'/name.replace(' ', '-').replace('(', '').replace(')', ''), 'Downloads/'+name)
    preserve(args.downloads/'fig1_molarium_interface_local_lab.png', ARCHIVE/'not-selected/fig1_molarium_interface_local_lab.png',
        'Downloads/fig1_molarium_interface_local_lab.png', 'cosmetic generated badge variant; explicitly not selected for submitted v1')
    submitted = args.downloads/'Molarium.pdf'
    assert sha(submitted.read_bytes()) == EXPECTED_PDF, 'Submitted PDF changed; review the input before archiving'
    preserve(submitted, SUBMISSION/'Molarium.pdf', 'author-supplied Downloads/Molarium.pdf', 'author-designated ChemRxiv-submitted v1; exact PDF')
    submitted_tex = args.submitted_tex.read_bytes()
    assert sha(submitted_tex) == '6964b04e39738a985e521bd8dc05bd0fff4bfad1abe715be47593b2382f80804', 'Final Prism export changed; review first'
    preserve(args.submitted_tex, SUBMISSION/'main.tex', 'author-supplied final Prism export: Downloads/'+args.submitted_tex.name, 'author-designated final Prism LaTeX; exact source bytes')
    precursor = ROOT/'paper/revisions/2026-09-08-deployed-reconciliation-a28'
    figure_names = re.findall(r'\\safeincludegraphics\[[^\]]*\]\{([^}]+)\}', submitted_tex.decode())
    assert len(figure_names) == 6
    for name in figure_names:
        assert name.startswith('figures/') and '..' not in name
        preserve(precursor/name, SUBMISSION/name, 'recovered a28 source asset: '+name, 'submitted-source figure dependency; pixel agreement checked separately against submitted PDF')
    source_diff = ''.join(difflib.unified_diff((precursor/'main.tex').read_text().splitlines(True), submitted_tex.decode().splitlines(True), fromfile='a28/main.tex', tofile='chemrxiv-v1/main.tex'))
    (SUBMISSION/'changes-from-a28.diff').write_text(source_diff)
    metadata = dict(schema='molarium.paper-submission/v1', version='v1', submittedTo='ChemRxiv',
        submittedDate='2026-09-08', designationSource='Author supplied this PDF as the version submitted to ChemRxiv.',
        publicationStatus='submitted; public ChemRxiv landing page or DOI not yet supplied',
        title='Molarium: Agent-Generated Adaptive Software for Molecular Design',
        authors=['Rafal Wiewiora', 'Woody Sherman'],
        pdf=dict(path='paper/submissions/chemrxiv-v1-2026-09-08/Molarium.pdf',sha256=EXPECTED_PDF,bytes=submitted.stat().st_size,pages=40),
        exactSubmittedLatexAvailable=True,
        source=dict(path='paper/submissions/chemrxiv-v1-2026-09-08/main.tex', sha256=sha(submitted_tex), bytes=len(submitted_tex), designation='Final Prism LaTeX export supplied by the author after the submitted PDF.'),
        sourceAssets=[dict(path=str((SUBMISSION/name).relative_to(ROOT)),sha256=sha((SUBMISSION/name).read_bytes()),bytes=(SUBMISSION/name).stat().st_size) for name in figure_names],
        sourceBoundary='The final author-supplied Prism export is preserved unchanged. All six recovered PNG dependencies are checked pixel-for-pixel against the submitted PDF. The PDF is the original Prism output, not a local recompilation; byte-identical compiler reproduction is not claimed. a28 and main-12.pdf remain historical precursors.',
        figureVerification='paper/submissions/chemrxiv-v1-2026-09-08/figure-verification.json',
        frozenScienceRelease='design-history/publications/sos1/designer-intent-2026-09-04/release.json',
        frozenScienceChanged=False, archive='paper/review/history-2026-09-08/manifest.json')
    (SUBMISSION/'submission.json').write_text(json.dumps(metadata,indent=2)+'\n')
    manifest=dict(schema='molarium.manuscript-archive/v1', archivedDate='2026-09-08',
        predecessor='paper/review/history-2026-09-06/manifest.json', predecessorCommit='baf18d4',
        policy='Exact original artifact bytes retained. Historical local paths and manuscript author contacts may occur. No raw collaborator DOCX/comments, decision exports, credentials, unrelated Downloads, or session transcripts are included. Logs/caches and duplicate ZIPs are omitted. Inclusion is not scientific or editorial endorsement.',
        submittedPdfSha256=EXPECTED_PDF, files=records)
    (ARCHIVE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(files=len(records),bytes=sum(x['bytes'] for x in records),pdfSha256=EXPECTED_PDF),indent=2))

if __name__ == '__main__':
    main()
