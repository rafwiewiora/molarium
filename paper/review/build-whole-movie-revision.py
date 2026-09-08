"""Preserve a18 and build the author-requested whole-movie/human-account revision."""
from pathlib import Path
import hashlib, json, re, shutil, subprocess, sys, zipfile

root = Path(__file__).resolve().parents[2]
base_name = '2026-09-07-native-json-current-appendix-a18'
revision_name = '2026-09-07-whole-movie-human-account-a19'
base = root / 'paper/revisions' / base_name
revision = root / 'paper/revisions' / revision_name
source_path = root / 'design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json'
review_path = source_path.with_name('checkpoint-review.action-script.json')
sha = lambda b: hashlib.sha256(b).hexdigest()
assert sha(source_path.read_bytes()) == '7eed2dff0bf3fa127f87b2322aaea4b615d458ad6d8ef3af3c5b5886dc8fe9c3'
source = (base / 'main.tex').read_text()
start = source.index(r'\subsubsection{Public API representation}')
end = source.index(r'\begin{table}[htbp]', start)
replacement = (root / 'paper/review/sos1-whole-movie-pseudocode.tex').read_text()
before_main = 'presents the procedure through an excerpt in the native executable JSON action format.'
after_main = 'pairs pseudocode for the complete movie with a human-readable account of the design decisions and outcomes; the full executable API JSON remains available.'
command = [sys.executable, str(root / 'paper/review/apply-approved-text-edit.py'), sys.argv[1],
           '--base', base_name, '--revision', revision_name,
           '--before', source[start:end], '--after', replacement + '\n',
           '--before', before_main, '--after', after_main]
subprocess.run(command, check=True)
extras = ['sos1-full-executable.action-script.json', 'sos1-checkpoint-review.action-script.json',
          'sos1-whole-movie-pseudocode.txt', 'protocol-evidence.json', 'appendix-code-audit.json']
if sys.argv[1] == 'build':
    shutil.copyfile(source_path, revision / extras[0])
    shutil.copyfile(review_path, revision / extras[1])
    pseudo = replacement.split(r'\begin{lstlisting}', 1)[1].split('\n', 1)[1].split(r'\end{lstlisting}', 1)[0]
    (revision / extras[2]).write_text(pseudo)
    stages = json.loads(review_path.read_text())['actions']
    # Inclusive zero-based source ranges partition the full 159-action sequence.
    ranges = [(0, 4), (5, 14), (15, 28), (29, 35), (36, 45), (46, 140), (141, 158)]
    evidence = {
        'schema': 'molarium.manuscript-whole-movie-condensation/v1',
        'sourceSha256': sha(source_path.read_bytes()), 'sourceActionCount': 159,
        'checkpointReviewSha256': sha(review_path.read_bytes()),
        'pseudocodeSha256': sha(pseudo.encode()), 'directlyExecutable': False,
        'newScientificCalculations': False,
        'checkpointMapping': [dict(checkpoint=i+1, id=s['review']['designStage'],
                                   sourceActionRangeInclusive=list(r),
                                   checkpointSource=s['args']['sourcePath'],
                                   checkpointSha256=s['args']['sourceSha256'])
                              for i, (s, r) in enumerate(zip(stages, ranges))],
        'condensation': ['Full atom selectors become chemical names.',
                         'Repeated read-only inspections, workspace switches, route resumption and redundant reference/parameterization calls are condensed.',
                         'The AWT/AWZ sequence and 13 Phe890 trials become loops; restoration and re-enumeration remain explicit.',
                         'Checkpoint annotations describe saved movie states, not extra executable API calls.',
                         'Source-run energy selection and fixed-choice replay verification are distinguished.',
                         'Registered BAY feature rules and publication-controller acceptance checks are annotated alongside API calls.'],
        'humanAccountEvidence': {
            'aWW': 'evidence/024-prediction-manifest.json.gz',
            'phe890Candidates': 'evidence/010-phe890-candidate-01.json.gz through evidence/022-phe890-candidate-13.json.gz',
            'bayCandidateGates': 'evidence/026-candidate-gate.json.gz',
            'precursorAcceptance': 'Source action expectations at indices 6-9 and 16-19.',
            'scope': 'Observed candidate outcomes, not invented historical debugging episodes or original chemists\' documented intentions.'}}
    (revision / extras[3]).write_text(json.dumps(evidence, indent=2) + '\n')
    shutil.copyfile(base / extras[4], revision / extras[4])
    with (revision / 'README.md').open('a') as f:
        f.write('\nThis revision replaces the four-action JSON excerpt with one whole-movie pseudocode listing and replaces the dense results subsection with a checkpoint-by-checkpoint human account. The full 159-action executable JSON and seven-checkpoint review JSON are bundled. The pseudocode is not executable; its evidence map identifies the condensed source ranges and distinguishes replay from publication verification. Figure assets and all text outside the two edit-manifest replacements are unchanged. No molecular calculations were rerun.\n')
else:
    bundle = root / 'output/prism/molarium-prism-author-approved-a19.zip'
    with zipfile.ZipFile(bundle, 'a', zipfile.ZIP_DEFLATED) as z:
        for name in extras:
            z.write(revision / name, name)
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == len(set(z.namelist())) == 14
        assert z.read(extras[0]) == source_path.read_bytes()
        assert z.read(extras[1]) == review_path.read_bytes()
    print('Verified 14-file Prism bundle, including full executable and checkpoint JSON.')
