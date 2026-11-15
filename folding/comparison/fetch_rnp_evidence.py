"""Stream official RnP archives in an allocated CPU job; keep selected evidence.

The compressed source is checksum-verified in full. Only selected Boltz-2 native
hits or their experimental references are written. This performs no inference.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import time
import urllib.request


class HashedResponse:
    def __init__(self, response, progress):
        self.response = response
        self.md5 = hashlib.md5()
        self.sha256 = hashlib.sha256()
        self.bytes = 0
        self.progress = progress
        self.last = 0

    def read(self, size=-1):
        block = self.response.read(size)
        self.md5.update(block)
        self.sha256.update(block)
        self.bytes += len(block)
        if time.monotonic() - self.last > 30:
            self.last = time.monotonic()
            self.progress(self.bytes)
        return block


def wanted_member(name, kind, candidates):
    parts = PurePosixPath(name).parts
    if any(p in {'.', '..'} for p in parts) or name.startswith('/'):
        raise ValueError('Unsafe archive member')
    if kind == 'native':
        if 'prediction_files' not in parts:
            return None
        i = parts.index('prediction_files')
        if len(parts) != i + 4 or parts[i + 1] != 'boltz2' or parts[i + 2] not in candidates:
            return None
        match = re.fullmatch(r'seed-([0-9]+)_sample-([0-9]+)\.cif', parts[-1])
        if not match:
            return None
        case = candidates[parts[i + 2]]
        hits = {(str(p['seed']), str(p['sample'])) for p in case['publishedHits']}
        if match.groups() not in hits:
            return None
        return Path(parts[i + 2]) / parts[-1]
    if 'ground_truth' not in parts:
        return None
    i = parts.index('ground_truth')
    if len(parts) < i + 3 or parts[i + 1] not in candidates:
        return None
    relative = parts[i + 2:]
    case = candidates[parts[i + 1]]
    if relative not in [('system.cif',), ('receptor.cif',), ('sequences.fasta',),
                        ('ligand_files', case['ligandInstanceChain'] + '.sdf')]:
        return None
    return Path(parts[i + 1], *relative)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pool', type=Path, required=True)
    p.add_argument('--record', type=Path, required=True)
    p.add_argument('--kind', choices=['native', 'reference'], required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Use a genuine allocated CPU job for full-archive staging')
    args.output.mkdir()
    pool_bytes = args.pool.read_bytes()
    pool = json.loads(pool_bytes)
    candidates = {c['systemId']: c for c in pool['candidates']}
    if len(candidates) != len(pool['candidates']):
        raise ValueError('Multiple ligand inputs for one candidate system')
    record = json.loads(args.record.read_bytes())
    if record['id'] != 18366081:
        raise ValueError('Frozen Zenodo version required')
    filename = 'prediction_files.tar.gz' if args.kind == 'native' else 'ground_truth.tar.gz'
    spec = next(f for f in record['files'] if f['key'] == filename)
    receipt = {'schema': 'molarium.rnp-source-extraction.v1', 'kind': args.kind,
               'status': 'running', 'slurmJobId': os.environ['SLURM_JOB_ID'],
               'startedAt': datetime.now(timezone.utc).isoformat(),
               'poolSha256': hashlib.sha256(pool_bytes).hexdigest(),
               'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'source': spec, 'neuralForwards': 0, 'selectedFiles': 0, 'selectedBytes': 0}
    destination = args.output / 'receipt.json'
    destination.write_text(json.dumps(receipt, indent=2) + '\n')
    inventory = args.output / 'members.jsonl'
    found = set()
    def progress(n):
        value = {'compressedBytesRead': n, 'compressedBytesTotal': spec['size'],
                 'selectedFiles': receipt['selectedFiles'], 'kind': args.kind}
        (args.output / 'progress.json').write_text(json.dumps(value) + '\n')
        print(json.dumps(value), flush=True)
    try:
        request = urllib.request.Request(spec['links']['self'], headers={'User-Agent': 'Molarium-RnP-evidence/1'})
        with urllib.request.urlopen(request, timeout=180) as response, inventory.open('x') as ledger:
            stream = HashedResponse(response, progress)
            with tarfile.open(fileobj=stream, mode='r|gz') as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    relative = wanted_member(member.name, args.kind, candidates)
                    if relative is None:
                        continue
                    if member.size > 8 * 1024 * 1024 or relative in found:
                        raise ValueError('Oversize or repeated selected member')
                    found.add(relative)
                    data = archive.extractfile(member).read()
                    if len(data) != member.size:
                        raise ValueError('Truncated archive member')
                    target = args.output / 'files' / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as f:
                        f.write(data)
                    item = {'archiveMember': member.name, 'file': str(relative),
                            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                    ledger.write(json.dumps(item) + '\n')
                    ledger.flush()
                    receipt['selectedFiles'] += 1
                    receipt['selectedBytes'] += len(data)
            # Include tar padding/gzip footer/remaining source bytes in the checksum.
            while stream.read(4 * 1024 * 1024):
                pass
            if stream.bytes != spec['size'] or 'md5:' + stream.md5.hexdigest() != spec['checksum']:
                raise ValueError('Official archive byte count/checksum mismatch')
            receipt['compressedSourceSha256'] = stream.sha256.hexdigest()
            receipt['compressedSourceBytes'] = stream.bytes
            receipt['officialArchiveChecksumVerified'] = True
        expected = sum(len(c['publishedHits']) for c in candidates.values()) if args.kind == 'native' else 4 * len(candidates)
        if receipt['selectedFiles'] != expected:
            raise ValueError(f'Missing source evidence: expected {expected}, found {receipt["selectedFiles"]}')
        receipt['status'] = 'complete'
    except BaseException as e:
        receipt['status'] = 'failed'
        receipt['error'] = repr(e)
        raise
    finally:
        receipt['finishedAt'] = datetime.now(timezone.utc).isoformat()
        receipt['inventorySha256'] = hashlib.sha256(inventory.read_bytes()).hexdigest() if inventory.exists() else None
        destination.write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
