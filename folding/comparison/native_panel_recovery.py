"""Portable evidence for cohorts assembled from stopped immutable attempts.

The source CLI statuses remain intact. Revalidation uses native_cohort's exact
input/lineage/inventory checks and never invokes a model or unpickles a cache.
"""
import hashlib
import json
from pathlib import Path
from native_cohort import collect


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate(cohort, inputs, attempts):
    arguments = [str(a['native']) + '=' + str(a['inputs']) for a in attempts]
    spec, digest, sources, outputs, keys, checkpoint, protocol, settings = collect(
        inputs, arguments, allow_interrupted=True)
    assert keys == {(i, s) for i in range(len(spec['compounds'])) for s in spec['seeds']}
    assert cohort['schema'] == 'molarium.native-assembled-cohort.v1'
    assert cohort['status'] == 'complete' and cohort['method'] == 'openbind0'
    assert cohort['inputSha256'] == digest and cohort['checkpointSha256'] == checkpoint
    assert cohort['protocol'] == protocol and cohort['settings'] == settings
    assert cohort['seeds'] == spec['seeds'] and cohort['runnerSha256'] is None
    assert len(cohort['sources']) == len(sources) == len(attempts)
    for expected, source, attempt in zip(cohort['sources'], sources, attempts):
        source.pop('transferredPublicReceiptSha256', None)
        assert source == {k: v for k, v in expected.items() if k != 'transferredPublicReceiptSha256'}
        assert sha(Path(attempt['runner']).read_bytes()) == source['runnerSha256']
    expected_outputs = [{
        'path': r['source'] + '/' + r['path'], 'sha256': r['sha256'], 'bytes': r['bytes'],
        'sourceAttempt': r['source'], 'environment': r['_source']['environment']}
        for r in outputs]
    assert cohort['outputs'] == expected_outputs
    if any(s['originalStatus'] != 'complete' for s in sources):
        assert cohort['elapsedSeconds'] is None
    return spec


def package(members, case_id, cohort, inputs, attempts):
    """Add the exact scientific source evidence; redact only private argv paths."""
    validate(cohort, inputs, attempts)
    descriptors = []
    for i, attempt in enumerate(attempts):
        prefix = f'{case_id}/recovery/part-{i:03d}'
        native, consumed = Path(attempt['native']), Path(attempt['inputs'])
        raw = (native / 'receipt.json').read_bytes()
        receipt = json.loads(raw)
        identity = receipt.get('originalReceiptSha256', sha(raw))
        public = {k: v for k, v in receipt.items() if k != 'argv'}
        public.update(originalReceiptSha256=identity,
                      redactedFields=['argv (private absolute paths)'])
        members[prefix + '/native/receipt.json'] = (json.dumps(public, indent=2) + '\n').encode()
        members[prefix + '/consumed-native_run.py'] = Path(attempt['runner']).read_bytes()
        for name, digest in receipt['inputFiles'].items():
            path = (consumed / name).resolve()
            assert path.is_relative_to(consumed.resolve())
            data = path.read_bytes()
            assert sha(data) == digest
            members[prefix + '/inputs/' + name] = data
        files = set()
        for output in cohort['sources'][i]['savedOutputs']:
            path = native / output['path']
            files.add(path)
            confidence = path.with_name(path.name.rsplit('_model.', 1)[0] + '_confidences_aggregated.json')
            if confidence.exists():
                files.add(confidence)
        for name in ['stopped-output-inventory.json', 'forward-times.jsonl']:
            if (native / name).exists():
                files.add(native / name)
        for path in files:
            assert path.resolve().is_relative_to(native.resolve()) and not path.is_symlink()
            members[prefix + '/native/' + str(path.relative_to(native))] = path.read_bytes()
        descriptors.append({'native': prefix + '/native', 'inputs': prefix + '/inputs',
                            'runner': prefix + '/consumed-native_run.py'})
    members[f'{case_id}/recovery.json'] = (json.dumps(descriptors, indent=2) + '\n').encode()


def verify(members, case_id, cohort, temporary):
    """Reconstruct source files in a confined temporary directory and validate."""
    names = [name for name in members if name.startswith(case_id + '/recovery/')
             or name.startswith(case_id + '/inputs/')]
    for name in names:
        path = (temporary / name).resolve()
        assert path.is_relative_to(temporary.resolve())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(members[name])
    descriptors = json.loads(members[f'{case_id}/recovery.json'])
    attempts = []
    for descriptor in descriptors:
        resolved = {k: (temporary / v).resolve() for k, v in descriptor.items()}
        assert set(resolved) == {'native', 'inputs', 'runner'}
        assert all(p.is_relative_to((temporary / case_id / 'recovery').resolve()) for p in resolved.values())
        attempts.append(resolved)
    validate(cohort, temporary / case_id / 'inputs', attempts)
    # At least one source must bind the complete parent input set exactly.
    parents = [a for a in attempts if json.loads((a['inputs'] / 'comparison.json').read_bytes()) ==
               json.loads(members[f'{case_id}/inputs/comparison.json'])]
    assert parents
    for attempt in parents:
        receipt = json.loads((attempt['native'] / 'receipt.json').read_bytes())
        for name, digest in receipt['inputFiles'].items():
            assert sha(members[f'{case_id}/inputs/{name}']) == digest
