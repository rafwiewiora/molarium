"""Reconcile the SOS1 prose with its executable protocol, preserving prior edits."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, zipfile

here = Path(__file__).resolve().parent
root = here.parents[1]
base = root / 'paper/revisions/2026-09-06-disclosure-parity-a11'
revision_name = sys.argv[2] if len(sys.argv) > 2 else '2026-09-06-sos1-executable-protocol-a12'
revision = root / 'paper/revisions' / revision_name
source = (base / 'main.tex').read_text()
start = source.index('\\subsection{SOS1 designer-intent replay}')
end = source.index('\\end{small}', start)
old_section = source[start:end]
code = (here / 'sos1-design-intent-excerpt.mjs').read_text().rstrip()
new_section = (here / 'sos1-executable-protocol.tex').read_text().replace('@@SOS1_API_EXCERPT@@', code)
before_main = source[source.index('The purpose of this replay is'):source.index('\n\nThree complementary views')]
after_main = r'''The SOS1 replay expresses a molecular-design procedure as an executable program. Its public API actions specify graph edits, intended contacts, allowed atomic motions, candidate evaluations, and selection rules. The designer defines an AWW ligand direction and Tyr884 contact; a separate calculation tests the Phe890 response while holding that ligand pose fixed. The BAY-293 graph rewrite then retains a declared distal spatial feature. This separates the supplied hypothesis from the calculated response and records the alternatives examined, not only the final structure. A contact, permitted motion, or selection rule can be changed explicitly to define a new test. Appendix~\ref{app:architecture} presents the procedure as pseudocode together with a public API code excerpt. The AWW and BAY-293 ligand RMSDs are 0.851 and 1.880~\AA{}, respectively, after receptor alignment and graph-symmetry minimization without ligand fitting. The crystal series informed the hypothesis; this is not a blinded prediction.'''
args = ['--base', base.name, '--revision', revision_name, '--before', old_section, '--after', new_section, '--before', before_main, '--after', after_main]
subprocess.run([sys.executable, str(here / 'apply-approved-text-edit.py'), sys.argv[1], *args], check=True)
if sys.argv[1] == 'build':
    shutil.copyfile(here / 'sos1-design-intent-excerpt.mjs', revision / 'sos1-design-intent-excerpt.mjs')
    evidence = {
        'fullActionScript': 'design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json',
        'fullActionScriptSha256': hashlib.sha256((root / 'design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json').read_bytes()).hexdigest(),
        'excerptSha256': hashlib.sha256(code.encode()).hexdigest(),
        'test': 'node --test paper/review/sos1-design-intent-excerpt.test.mjs',
        'verificationScope': 'Exact resolved action/argument comparison with four published calls and failure-stop test; not a new molecular calculation.',
        'mainTextAndAppendixA5Updated': True,
        'figuresAndOtherSectionsUnchanged': True,
    }
    (revision / 'protocol-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
elif sys.argv[1] == 'package':
    assert (revision / 'sos1-design-intent-excerpt.mjs').read_text().rstrip() == code
    suffix = revision_name.rsplit('-', 1)[-1]
    bundle = root / f'output/prism/molarium-prism-author-approved-{suffix}.zip'
    with zipfile.ZipFile(bundle, 'a', zipfile.ZIP_DEFLATED) as z:
        for name in ('sos1-design-intent-excerpt.mjs', 'protocol-evidence.json'):
            z.write(revision / name, name)
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == len(set(z.namelist())) == 11
