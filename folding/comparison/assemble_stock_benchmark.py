"""Independently rescore and package a frozen stock-page benchmark snapshot."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import zipfile
from datetime import datetime, timezone
from score_stock_localfold import score


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assemble(plan_file, repository, pilot, batch, output):
    analysis_names = ['score_stock_localfold.py', 'assemble_stock_benchmark.py',
                      'check_stock_benchmark.py', 'pose_metrics.py', 'experimental_reference.py',
                      'requirements-analysis.txt']
    analysis_sources = {name: sha(Path(__file__).with_name(name)) for name in analysis_names}
    plan = json.loads(plan_file.read_text())
    results = batch / 'results' if (batch / 'results/progress.json').is_file() else batch
    progress_raw = (results / 'progress.json').read_bytes()
    progress = json.loads(progress_raw)
    if progress['planSha256'] != sha(plan_file):
        raise ValueError('Batch consumed a different plan')
    prior = {r['index']: r for r in progress['records']}
    records, sources = [], []
    for job in plan['jobs']:
        index = job['index']
        is_pilot = index == 0 and pilot is not None
        directory = pilot / 'result' if is_pilot else results / prior.get(index, {}).get('directory', '__unstarted__')
        status = 'complete' if is_pilot else prior.get(index, {}).get('status', 'not-started')
        if status == 'complete':
            result = score(plan_file, repository, index, directory)
            original_file = pilot / 'score.json' if is_pilot else directory / 'score.json'
            original = json.loads(original_file.read_text())
            if abs(original['ligandRmsdA'] - result['ligandRmsdA']) > 1e-8 or original['limitedValidityPass'] != result['limitedValidityPass']:
                raise ValueError('Independent reanalysis differs from the preserved score')
            result['initialScoreSha256'] = sha(original_file)
            sources.append((index, directory, original_file))
            records.append(result)
        else:
            records.append({'index': index, 'caseId': job['caseId'], 'model': job['model'],
                            'seed': job['seed'], 'status': status,
                            'error': prior.get(index, {}).get('error')})
            if status == 'failed' and directory.is_dir():
                sources.append((index, directory, None))
    summary = []
    for pair in plan['pairs']:
        rows = [r for r in records if (r['caseId'], r['model']) == (pair['caseId'], pair['model'])]
        done = [r for r in rows if r['status'] == 'complete']
        confidence = [r for r in done if isinstance(r['confidence'].get('iptm'), (int, float))]
        ranked = max(confidence, key=lambda r: (r['confidence']['iptm'], -r['seed'])) if confidence else None
        seed0 = next((r for r in done if r['seed'] == 0), None)
        first_three = [r for r in done if r['seed'] in [0, 1, 2]]
        summary.append({'caseId': pair['caseId'], 'model': pair['model'], 'nativeBestA': pair['nativeBestA'],
            'nativeHasStereoClashPassingHit': pair['nativeHasStereoClashPassingHit'],
            'complete': len(done), 'failed': sum(r['status'] == 'failed' for r in rows), 'planned': len(rows),
            'posesWithin2A': sum(r['within2A'] for r in done),
            'limitedValidityPassingHits': sum(r['within2A'] and r['limitedValidityPass'] for r in done),
            'seed0LigandRmsdA': seed0['ligandRmsdA'] if seed0 else None,
            'medianLigandRmsdA': statistics.median(r['ligandRmsdA'] for r in done) if done else None,
            'oracleBestOfObservedNA': min(r['ligandRmsdA'] for r in done) if done else None,
            'highestIptmSeed': ranked['seed'] if ranked else None,
            'highestIptmLigandRmsdA': ranked['ligandRmsdA'] if ranked else None,
            'firstThreeComplete': len(first_three),
            'firstThreeHits': sum(r['within2A'] for r in first_three),
            'oracleBestOfFirstThreeA': min(r['ligandRmsdA'] for r in first_three) if len(first_three) == 3 else None})
    complete = sum(r['status'] == 'complete' for r in records)
    terminal = all(r['status'] in ['complete', 'failed'] for r in records)
    report = {'schema': 'molarium.stock-localfold-benchmark-report.v1',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'status': 'complete' if terminal else 'partial-snapshot',
        'completed': complete, 'planned': len(records), 'planSha256': sha(plan_file),
        'steps': plan['steps'], 'recycles': plan['recycles'], 'seeds': plan['seeds'],
        'summary': summary, 'poses': records,
        'definitions': {'selection': plan['selection'], 'alignment': 'All observed corresponding protein C-alpha atoms; no trimming, pocket or ligand refit.',
            'oracle': 'Best observed RMSD uses the crystal answer; it is not prospective pose selection.',
            'confidenceSelection': 'Largest reported ipTM, lowest model seed to break ties; independent of the crystal answer.',
            'failures': 'Every planned prediction remains in the denominator; execution failures are separated from geometric misses.',
            'scope': 'Original quantized LocalFold page at explicit sampling settings; not a matched-tensor implementation-parity test.'}}
    if any(sha(Path(__file__).with_name(name)) != digest for name, digest in analysis_sources.items()):
        raise ValueError('Analysis source changed during independent reanalysis')
    for record in records:
        if record['status'] == 'complete' and any(analysis_sources[name] != digest for name, digest in record['analysisScripts'].items()):
            raise ValueError('Score source hashes differ from the executing analysis snapshot')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'scores.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    files = {}
    def add(archive, path, name):
        data = path.read_bytes()
        archive.writestr(name, data)
        files[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    with zipfile.ZipFile(output / 'evidence.zip', 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(plan_file.parent.rglob('*')):
            if path.is_file():
                add(archive, path, 'frozen-plan/' + str(path.relative_to(plan_file.parent)))
        referenced = sorted({pair[key] for pair in plan['pairs'] for key in ['nativeScoreFile', 'referenceFile']})
        for name in referenced:
            add(archive, repository / name, 'reference-evidence/' + name)
        for index, directory, initial_score in sources:
            for name in ['input.json', 'receipt.json', 'prediction.pdb', 'job.zip', 'upstream.log',
                         'archive-check.log', 'failure.txt', 'profile-retirement.json']:
                if (directory / name).is_file():
                    add(archive, directory / name, f'predictions/{index:03d}/{name}')
            if initial_score:
                add(archive, initial_score, f'predictions/{index:03d}/initial-score.json')
            wrapper_log = results / f'{index:03d}-launcher.log'
            if wrapper_log.is_file():
                add(archive, wrapper_log, f'predictions/{index:03d}/launcher.log')
        consumed = json.loads((batch / 'source-manifest.json').read_text())
        for name, expected in sorted(consumed.items()):
            if Path(name).name != name or sha(batch / 'source' / name) != expected:
                raise ValueError('Consumed batch source differs from its frozen inventory')
            add(archive, batch / 'source' / name, 'consumed-batch-source/' + name)
        if pilot is not None:
            add(archive, pilot / 'run_stock_localfold.py', 'consumed-pilot-source/run_stock_localfold.py')
        for name in analysis_names:
            add(archive, Path(__file__).with_name(name), 'independent-analysis-source/' + name)
        add(archive, batch / 'source-manifest.json', 'consumed-batch-source/source-manifest.json')
        archive.writestr('progress-at-snapshot.json', progress_raw)
        files['progress-at-snapshot.json'] = {'sha256': hashlib.sha256(progress_raw).hexdigest(), 'bytes': len(progress_raw)}
        add(archive, output / 'scores.json', 'independent-scores.json')
        archive.writestr('archive-manifest.json', json.dumps(files, indent=2) + '\n')
    archive_file = output / 'evidence.zip'
    evidence = {'schema': 'molarium.stock-localfold-evidence.v1',
        'scoresSha256': sha(output / 'scores.json'), 'archiveSha256': sha(archive_file),
        'archiveBytes': archive_file.stat().st_size, 'members': len(files),
        'scope': report['status'], 'completed': complete, 'planned': len(records)}
    if archive_file.stat().st_size > 20 * 1024 * 1024:
        parts = []
        reconstructed = hashlib.sha256()
        with archive_file.open('rb') as source:
            while data := source.read(20 * 1024 * 1024):
                part = output / f'evidence.part-{len(parts) + 1:02d}.bin'
                part.write_bytes(data)
                saved = part.read_bytes()
                if saved != data:
                    raise ValueError('Evidence part write did not preserve archive bytes')
                reconstructed.update(saved)
                parts.append({'file': part.name, 'bytes': len(saved), 'sha256': hashlib.sha256(saved).hexdigest()})
        if reconstructed.hexdigest() != evidence['archiveSha256']:
            raise ValueError('Split evidence does not reconstruct the original archive')
        evidence['archiveParts'] = parts
        archive_file.unlink()
    (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    fmt = lambda value: '—' if value is None else f'{value:.2f}'
    lines = ['# Stock LocalFold on native-positive crystal cases', '',
        f'**{complete} of {len(records)} planned predictions completed.** Status: `{report["status"]}`.', '',
        'Each system/model pair has a frozen budget of **10 model seeds, 200 diffusion steps and 3 additional recycles (4 trunk passes)**. '
        'Only cases with a previously saved same-model native pose strictly below 2 Å were selected. '
        'This is a selected diagnostic cohort, not an unbiased prospective accuracy benchmark.', '',
        '| Case | Model | Native best Å | Stock <2 Å / completed | Valid stock hits | Stock best Å | Stock median Å |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for row in summary:
        lines.append(f'| {row["caseId"]} | {row["model"]} | {fmt(row["nativeBestA"])} | '
            f'{row["posesWithin2A"]}/{row["complete"]} | {row["limitedValidityPassingHits"]} | '
            f'{fmt(row["oracleBestOfObservedNA"])} | {fmt(row["medianLigandRmsdA"])} |')
    lines += ['', 'Native KIT (both models) and NSP3/Boltz geometric hits fail the separate limited validity checks. '
        'They remain explicit geometric diagnostics. “Valid” here means the existing stereochemical identity and severe protein–ligand clash checks; '
        'it does not assert complete physical validation.', '',
        '## Pose selection and sampling', '',
        '| Case | Model | Seed 0 Å | Best of first 3 Å | Highest-ipTM seed | Highest-ipTM pose Å |',
        '| --- | --- | ---: | ---: | ---: | ---: |']
    for row in summary:
        lines.append(f'| {row["caseId"]} | {row["model"]} | {fmt(row["seed0LigandRmsdA"])} | '
            f'{fmt(row["oracleBestOfFirstThreeA"])} | {row["highestIptmSeed"] if row["highestIptmSeed"] is not None else "—"} | '
            f'{fmt(row["highestIptmLigandRmsdA"])} |')
    lines += ['', 'Best RMSD is a crystal-informed oracle statistic. Native bests use the original three saved seeds; '
        'stock bests use the completed part of the predeclared ten-seed set. The first-three statistic is shown only after '
        'all three have completed. Confidence selection uses the largest reported ipTM without consulting the crystal; '
        'ties select the lowest seed. All samples, errors and geometry diagnostics remain in [scores.json](scores.json).', '',
        '## Execution and verification', '',
        'The pristine LocalFold page at `'+plan['sourceRevision']+'` executes its own Fold button, SMILES preparation, '
        'quantized weights, sampler and confidence head. The Molarium folding wrapper is bypassed. Actual folding devices '
        'and browser versions are recorded per prediction. This batch uses physical Apple WebGPU on the local M1 Pro; '
        'numerical settings/tuning are not overridden. Step and recycle counts are read back from the original UI. '
        'Inputs contain sequence, declared SMILES and provided alignment only, with no crystal coordinates.', '',
        'All observed corresponding Cα atoms determine the protein fit. Ligand heavy-atom RMSD allows graph symmetry '
        'but no independent ligand fit, pocket fit or trimming. Archived inputs/outputs and native selection evidence '
        'are hash-checked and scores are independently recomputed when assembling this snapshot. '
        'Equal integer seeds do not imply matched native/browser random tensors. Sampling, input preparation, '
        'quantization and hardware differences prevent treating these pose tests as strict implementation parity.', '',
        ('Evidence archive: ' + ' · '.join(f'[part {i + 1}]({p["file"]})' for i, p in enumerate(evidence['archiveParts']))
         + '. The checker reassembles the parts automatically.' if evidence.get('archiveParts') else '[Evidence archive](evidence.zip)')
        + ' · [Archive hashes](evidence.json)', '',
        '```sh', 'python folding/comparison/check_stock_benchmark.py /path/to/this/review', '```', '']
    (output / 'README.md').write_text('\n'.join(lines))
    print(json.dumps({'status': report['status'], 'completed': complete, 'planned': len(records),
                      'output': str(output)}))
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['plan', 'repository', 'batch', 'output']:
        p.add_argument('--' + name, required=True, type=Path)
    p.add_argument('--pilot', type=Path, default=None,
                   help='optional separately completed index-0 pilot; its inference is never repeated')
    a = p.parse_args()
    assemble(a.plan, a.repository, a.pilot, a.batch, a.output)
