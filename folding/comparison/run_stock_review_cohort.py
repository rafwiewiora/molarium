"""Exercise every frozen stock case through the real reviewer, without inference."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess


PLAN_SHA = '797454ec8d2766485a96cfb13326511f0333efa7b89bb656968f84b2844ad349'
FLAGS = ['fileImport', 'localPreferencePersisted', 'referenceViewSeparate',
         'exactPoseNotePersisted', 'exportPreservesOriginalPdbAndGraph',
         'shortlistContainsExactSelectedPose', 'predictionNumbersStableWithReference',
         'experimentalReferenceHasNoPredictionMetadata', 'pdbExportsPreserveOriginalCoordinates',
         'referenceDownloadLabelExplicit']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def validate_result(result, manifest, manifest_sha, case, exports):
    if result['status'] != 'pass' or result['caseId'] != case or result['sourceExportManifestSha256'] != manifest_sha:
        raise ValueError('Browser result belongs to a different input or failed')
    if any(result.get(flag) is not True for flag in FLAGS):
        raise ValueError('Browser workflow coverage incomplete')
    if (result['newNeuralForwards'] != 0 or result['webgpuRequests'] != 0
            or result['copiedDecisions'] != 0 or result['testDecisionIsScientificJudgement'] is not False
            or 'swiftshader' not in result['renderer'].lower()):
        raise ValueError('Requires software-only UI QA with unscored test decisions')
    for reference, field, count in [(False, 'predictionPages', 'renderedUniquePredictions'),
                                     (True, 'referencePages', 'renderedReferenceInclusiveRecords')]:
        entry = next(row for row in manifest['libraries'] if row['caseId'] == case and row['referenceIncluded'] == reference)
        path = exports / entry['file']
        if sha(path) != entry['sha256']:
            raise ValueError('Input library changed')
        bundle = json.loads(path.read_bytes())
        expected = [p['id'] for p in sorted(bundle['poses'], key=lambda p: p['sample']) if p['status'] == 'complete']
        actual = [pose for page in result[field] for pose in page]
        if actual != expected or result[count] != len(expected):
            raise ValueError('Browser did not exercise every original pose page')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['repository', 'exports', 'chrome-wrapper', 'preflight', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--deadline', required=True)
    args = parser.parse_args()
    deadline = datetime.datetime.fromisoformat(args.deadline.replace('Z', '+00:00'))
    now = lambda: datetime.datetime.now(datetime.timezone.utc)
    if deadline.utcoffset() is None or not 0 < (deadline - now()).total_seconds() <= 4 * 3600:
        raise ValueError('A finite deadline within four hours is required')
    repository, exports = args.repository.resolve(), args.exports.resolve()
    plan = repository / 'reviews/cofold-rnp-spectrum-2026-11-15/frozen-stock-plan.json'
    if sha(plan) != PLAN_SHA:
        raise ValueError('Wrong original experiment')
    cases = [pair['caseId'] for pair in json.loads(plan.read_bytes())['pairs']]
    manifest_path = exports / 'manifest.json';manifest = json.loads(manifest_path.read_bytes())
    manifest_sha = sha(manifest_path)
    if len(cases) != 48 or manifest['caseIds'] != cases or manifest['samplesPerCase'] not in [6, 10]:
        raise ValueError('Requires every frozen case at the six- or ten-sample budget')
    if len(manifest['libraries']) != 96 or manifest['newNeuralForwards'] != 0 or manifest['copiedDecisions'] != 0:
        raise ValueError('Expected untouched prediction-only and reference-inclusive exports')
    pins = json.loads((args.preflight / 'source-pins.json').read_bytes())
    if pins['scripts/headless-chrome.mjs'] != 'b55a1197a5c2d2a112ea0b46d233b32a1e7aa7e1c5f7c06f32217ea9c9b19d13':
        raise ValueError('Shared helper changed')
    def verify():
        for name, digest in pins.items():
            if sha(repository / name) != digest:
                raise ValueError('Frozen UI source changed: ' + name)
        if sha(manifest_path) != manifest_sha:
            raise ValueError('Frozen export manifest changed')
    def verify_case(case):
        for row in manifest['libraries']:
            if row['caseId'] == case and sha(exports / row['file']) != row['sha256']:
                raise ValueError('Frozen case library changed: ' + case)
    verify()
    first = validate_result(json.loads((args.preflight / 'result.json').read_bytes()), manifest,
                            manifest_sha, cases[0], exports)
    args.output.mkdir();(args.output / 'source').mkdir();(args.output / 'cases').mkdir()
    source = Path(__file__).resolve()
    shutil.copyfile(source, args.output / 'source/runner.py')
    for name in pins:
        target = args.output / 'source' / name;target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repository / name, target)
    wrapper = args.output / 'source/chrome-software-review.sh'
    shutil.copyfile(args.chrome_wrapper, wrapper);wrapper.chmod(0o755)
    wrapper_sha = sha(wrapper);source_sha = sha(source)
    save(args.output / 'frozen-plan.json', {'scope': __doc__, 'caseIds': cases,
         'samplesPerCase': manifest['samplesPerCase'], 'experimentPlanSha256': PLAN_SHA,
         'exportManifestSha256': manifest_sha, 'sources': pins, 'runnerSha256': source_sha,
         'chromeWrapperSha256': wrapper_sha, 'deadline': args.deadline,
         'perCaseTimeoutSeconds': 600, 'newNeuralForwards': 0,
         'preflightReused': {'caseId': cases[0], 'resultSha256': sha(args.preflight / 'result.json')},
         'scientificJudgements': 0, 'publicationActions': 0, 'startedAt': now().isoformat()})
    state = {'status': 'running', 'plannedCases': 48, 'records': [], 'newNeuralForwards': 0,
             'publicationActions': 0, 'deadline': args.deadline}
    try:
        for index, case in enumerate(cases):
            verify();verify_case(case)
            if sha(source) != source_sha or sha(wrapper) != wrapper_sha:
                raise ValueError('Frozen runner or wrapper changed')
            remaining = (deadline - now()).total_seconds()
            if remaining <= 0:
                raise TimeoutError('Finite UI-QA deadline reached')
            folder = args.output / 'cases' / case;folder.mkdir()
            record = {'caseId': case, 'startedAt': now().isoformat(), 'status': 'running'}
            state['records'].append(record);save(args.output / 'progress.json', state)
            if index == 0:
                result = first;shutil.copyfile(args.preflight / 'result.json', folder / 'result.json')
                record['reusedCompletedPreflight'] = True
                for name in ['review.png', 'review-predictions.png']:
                    if (args.preflight / name).exists():shutil.copyfile(args.preflight / name, folder / name)
            else:
                environment = {**os.environ, 'MOLARIUM_STOCK_REVIEW_EXPORTS': str(exports),
                    'MOLARIUM_STOCK_REVIEW_CASE_ID': case, 'MOLARIUM_STOCK_REVIEW_REQUIRE_SOFTWARE': '1',
                    'MOLARIUM_STOCK_REVIEW_REPORT': str(folder / 'result.json'), 'CHROME_PATH': str(wrapper)}
                if index in [1, 12, 24, 36, 47]:
                    environment['MOLARIUM_STOCK_REVIEW_SCREENSHOT'] = str(folder / 'review.png')
                else:
                    environment.pop('MOLARIUM_STOCK_REVIEW_SCREENSHOT', None)
                with (folder / 'browser.log').open('xb') as log:
                    child = subprocess.Popen(['bun', 'scripts/stock-cofold-review.browser.mjs'],
                        cwd=repository, env=environment, stdin=subprocess.DEVNULL,
                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                    record['childPid'] = child.pid;save(args.output / 'progress.json', state)
                    try:
                        code = child.wait(timeout=min(600, remaining))
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:child.wait(timeout=10)
                        except subprocess.TimeoutExpired:os.killpg(child.pid, signal.SIGKILL);child.wait()
                        code = -999
                record['exitCode'] = code
                result = json.loads((folder / 'result.json').read_bytes()) if (folder / 'result.json').exists() else None
            verify();verify_case(case)
            try:
                validate_result(result, manifest, manifest_sha, case, exports)
                if record.get('exitCode', 0) != 0:raise ValueError('Browser child did not exit successfully')
                record.update({'status': 'pass', 'resultSha256': sha(folder / 'result.json')})
            except (ValueError, TypeError, KeyError) as exc:
                record.update({'status': 'failed', 'error': str(exc)})
            record['finishedAt'] = now().isoformat();save(args.output / 'progress.json', state)
        state.update({'status': 'complete', 'passed': sum(r['status'] == 'pass' for r in state['records']),
                      'failed': sum(r['status'] == 'failed' for r in state['records']), 'finishedAt': now().isoformat()})
        save(args.output / 'progress.json', state)
        save(args.output / 'receipt.json', {**state, 'exportManifestSha256': manifest_sha,
             'samplesPerCase': manifest['samplesPerCase'], 'sourcePlanSha256': sha(args.output / 'frozen-plan.json'),
             'scope': 'Actual file import, every pose page, exact note/preference persistence, original PDB/graph exports, shortlist and reference separation. Software WebGL; no inference or scientific preferences.'})
    except Exception as exc:
        state.update({'status': 'needs-attention', 'error': str(exc), 'checkedAt': now().isoformat()})
        save(args.output / 'progress.json', state)
        raise


if __name__ == '__main__':
    main()
