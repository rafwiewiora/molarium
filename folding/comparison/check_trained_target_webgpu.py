"""Replay the saved YTHDF2 Apple target-feature measurement without inference."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import zipfile

import numpy as np
from check_trained_target import metric
from check_trained_target_cpu import check as check_cpu, require, bound_path, digest


def check(root, cpu_root=None):
    root = Path(root)
    cpu_root = Path(cpu_root) if cpu_root else root.parent / 'trained-target-ythdf2-cpu'
    # This independently validates the original native capture, all 44 weight
    # mappings, exact feature/channel correspondence and the earlier CPU result.
    cpu_result = check_cpu(cpu_root)
    load = lambda name: json.loads((root / name).read_bytes())
    report, plan, analysis = load('result.json'), load('plan.json'), load('analysis.json')
    evidence, pins = load('source-evidence.json'), load('source-manifest.json')
    changes = load('source-adaptation.json')
    fr = json.loads((cpu_root / 'fixture/receipt.json').read_bytes())
    gates = {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True}
    require(plan['case'] == '32qy-a1keo' and plan['expectedShape'] == fr['expectedShape'] == [185, 447],
            'Controlled system or shape changed')
    require(report['gates'] == plan['gates'] == fr['gatesDeclaredBeforeRun'] == gates,
            'Original numerical gates changed')
    require(plan['targetStageForwardCalls'] == 1 and plan['newNativeCalls'] == 0
            and plan['newCpuStageCalls'] == 0 and plan['fullModelCalls'] == 0
            and plan['rerunsOrAutomaticRetries'] is False, 'Measurement scope changed')
    require(evidence['fixtureReceiptSha256'] == report['fixtureReceiptSha256']
            == digest(cpu_root / 'fixture/receipt.json'), 'Reused fixture changed')
    require(evidence['cpuReceiptSha256'] == plan['reusedCpuReceiptSha256']
            == digest(cpu_root / 'measurement/receipt.json'), 'Reused CPU measurement changed')
    require(evidence['nativeEvidenceSha256'] == json.loads(
        (cpu_root / 'native-evidence.json').read_bytes())['archive']['sha256'], 'Native ancestry changed')
    for name, item in plan['fixtureFiles'].items():
        path = bound_path(cpu_root / 'fixture', name)
        require(path.stat().st_size == item['bytes'] and digest(path) == item['sha256'],
                'Consumed GPU fixture differs from verified native fixture: ' + name)
    start, end = load('measurement-started.json'), load('execution-outcome.json')
    require(start['planSha256'] == digest(root / 'plan.json') and start['callsAllowed'] == 1
            and not start['automaticRetry'] and end['exitCode'] == 0 and end['resultExists'],
            'Consumed plan or execution status changed')
    require(datetime.datetime.fromisoformat(plan['recordedAt'])
            <= datetime.datetime.fromisoformat(start['startedAt'])
            <= datetime.datetime.fromisoformat(end['finishedAt']), 'Plan was not frozen before measurement')
    adapters = report['observedAdapters']
    require(len(adapters) >= 1 and all(a['vendor'] == 'apple' and a['architecture'].startswith('metal')
            and a['isFallbackAdapter'] is False for a in adapters), 'Physical Apple observation required')
    require(report['adapter']['vendor'] == 'apple', 'Final adapter observation changed')

    archive = bound_path(root, evidence['archive']['file'])
    require(archive.stat().st_size == evidence['archive']['bytes']
            and digest(archive) == evidence['archive']['sha256'], 'Consumed browser archive changed')
    expected_members = {'frozen/' + p for p in pins} | {
        'original-runner.mjs', 'attribution/LICENSE', 'attribution/UPSTREAM.json',
        'attribution/MOLARIUM-LICENSE', 'attribution/MOLARIUM-NOTICE'}
    require(len(pins) == plan['productionSourceFiles'] == 166, 'Consumed source coverage changed')
    with zipfile.ZipFile(archive) as z:
        require(len(z.infolist()) == len(expected_members) and set(z.namelist()) == expected_members
                and sum(i.file_size for i in z.infolist()) <= 20 * 1024**2,
                'Consumed archive inventory or size changed')
        for name, sha in pins.items():
            require(hashlib.sha256(z.read('frozen/' + name)).hexdigest() == sha,
                    'Consumed production source changed: ' + name)
        runner_name = 'scripts/cofold-trained-target.browser.mjs'
        runner = z.read('frozen/' + runner_name)
        require(hashlib.sha256(runner).hexdigest() == changes['adaptedRunnerSha256']
                == report['runnerSha256'], 'Consumed runner changed')
        original = z.read('original-runner.mjs')
        require(hashlib.sha256(original).hexdigest() == changes['parentRunnerSha256'],
                'Original browser producer changed')
        reversed_source = runner.decode()
        for replacement in reversed(changes['replacements']):
            require(reversed_source.count(replacement['to']) == 1, 'Ambiguous source adaptation')
            reversed_source = reversed_source.replace(replacement['to'], replacement['from'])
        require(reversed_source.encode() == original and changes['reverseExact'],
                'Non-numerical source adaptations do not reverse exactly')
        require("for(const path of ['production-webgpu']){" in runner.decode()
                and 'Physical Apple GPU required before measurement' in runner.decode(),
                'GPU-only selection or pre-measurement hardware guard changed')
    cpu_pins = json.loads((cpu_root / 'measurement/frozen-plan.json').read_bytes())['sourcePins']
    require(len(cpu_pins) == evidence['sharedCpuProductionFiles'] == 99
            and all(pins.get(p) == sha for p, sha in cpu_pins.items()),
            'Shared production code differs from the verified CPU control')
    require(pins['scripts/headless-chrome.mjs'] == plan['headlessHelperSha256']
            == 'b55a1197a5c2d2a112ea0b46d233b32a1e7aa7e1c5f7c06f32217ea9c9b19d13',
            'Protected browser helper changed')

    require(len(report['outputs']) == len(report['records']) == 1, 'Exactly one GPU output required')
    item, record = report['outputs'][0], report['records'][0]
    require(item['path'] == record['path'] == 'production-webgpu', 'Measured path changed')
    # Keep the original receipt byte-for-byte, including its historical absolute
    # output path. Portable replay reads only the explicitly named local file.
    require(Path(item['file']).name == 'result.production-webgpu.bin', 'Output identity changed')
    output = root / 'result.production-webgpu.bin'
    require(output.stat().st_size == item['bytes'] == 185 * 447 * 4
            and digest(output) == item['sha256'], 'Raw GPU output changed')
    expected = np.fromfile(cpu_root / 'fixture/expected-target.bin', dtype='<f4').reshape(185, 447)
    actual = np.fromfile(output, dtype='<f4').reshape(185, 447)
    old_cpu = np.fromfile(cpu_root / 'measurement/actual-target.bin', dtype='<f4').reshape(185, 447)
    values = {'fullTarget': metric(actual, expected),
              'learnedAtomChannels': metric(actual[:, 63:], expected[:, 63:]),
              'gpuVersusPreviouslyMeasuredCpuLearnedChannels': metric(actual[:, 63:], old_cpu[:, 63:])}
    for name, computed in values.items():
        saved = analysis[name]
        require(computed['finite'] and saved['finite'] and computed['values'] == saved['values']
                and abs(computed['relativeRms'] - saved['relativeRms']) < 1e-18
                and computed['maxAbs'] == saved['maxAbs'], 'Numerical result does not reproduce: ' + name)
    full = values['fullTarget']
    passes = full['finite'] and full['relativeRms'] <= gates['relativeRms'] and full['maxAbs'] <= gates['maxAbsoluteDifference']
    require(abs(full['relativeRms'] - record['relativeRms']) < 1e-18
            and full['maxAbs'] == record['maxAbsoluteDifference']
            and passes == record['passes'] == analysis['passes'], 'Reported gate does not reproduce')
    require(np.array_equal(actual[:, :63], expected[:, :63]) and analysis['copiedPrefixExact'],
            'Copied input channels differ')
    require(values['learnedAtomChannels']['referenceRms'] > 1e-3, 'Degenerate learned reference')
    return {'scope': plan['scope'], 'passes': passes, 'newModelCalls': 0,
            'consumedBrowserFiles': len(pins), 'nativeReplayPasses': cpu_result['passes'], **values}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    print(json.dumps(check(parser.parse_args().root)))
