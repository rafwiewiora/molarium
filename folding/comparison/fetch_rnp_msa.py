"""Keep published Boltz CSV alignments for the frozen candidate pool.

Read the official archive once in a genuine CPU allocation and verify its full
compressed checksum. No new MSA service request or neural inference is made.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request
from fetch_rnp_evidence import HashedResponse


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pool', type=Path, required=True)
    p.add_argument('--record', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('An allocated CPU job is required')
    raw = a.pool.read_bytes()
    pool = json.loads(raw)
    wanted = {(c['systemId'].lower(), c['proteinChain'] + '.csv'): c['systemId']
              for c in pool['candidates']}
    record = json.loads(a.record.read_bytes())
    if record['id'] != 18366081:
        raise ValueError('Pinned Zenodo record required')
    spec = next(f for f in record['files'] if f['key'] == 'msa_files.tar.gz')
    a.output.mkdir(exist_ok=False)
    receipt = {'schema': 'molarium.rnp-msa-extraction.v1', 'status': 'running',
               'poolSha256': hashlib.sha256(raw).hexdigest(), 'source': spec,
               'slurmJobId': os.environ['SLURM_JOB_ID'], 'neuralForwards': 0,
               'startedAt': datetime.now(timezone.utc).isoformat(), 'selectedFiles': 0}
    destination = a.output / 'receipt.json'
    destination.write_text(json.dumps(receipt, indent=2) + '\n')
    found = set()
    def progress(n):
        value = {'compressedBytesRead': n, 'compressedBytesTotal': spec['size'],
                 'selectedFiles': len(found)}
        (a.output / 'progress.json').write_text(json.dumps(value) + '\n')
        print(json.dumps(value), flush=True)
    try:
        request = urllib.request.Request(spec['links']['self'], headers={'User-Agent': 'Molarium-RnP-MSA-evidence/1'})
        with urllib.request.urlopen(request, timeout=180) as response, (a.output / 'members.jsonl').open('x') as ledger:
            stream = HashedResponse(response, progress)
            with tarfile.open(fileobj=stream, mode='r|gz') as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    parts = PurePosixPath(member.name).parts
                    if member.name.startswith('/') or '..' in parts:
                        raise ValueError('Unsafe source member')
                    if 'msa_files' not in parts:
                        continue
                    i = parts.index('msa_files')
                    if len(parts) != i + 3 or tuple(parts[-2:]) not in wanted:
                        continue
                    key = tuple(parts[-2:])
                    if key in found or member.size > 100 * 1024 * 1024:
                        raise ValueError('Repeated or oversized alignment')
                    data = archive.extractfile(member).read()
                    if len(data) != member.size:
                        raise ValueError('Truncated alignment')
                    target = a.output / 'files' / wanted[key] / key[1]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as f:
                        f.write(data)
                    found.add(key)
                    ledger.write(json.dumps({'archiveMember': member.name,
                                 'file': str(target.relative_to(a.output)),
                                 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}) + '\n')
                    ledger.flush()
            while stream.read(4 * 1024 * 1024):
                pass
            if stream.bytes != spec['size'] or 'md5:' + stream.md5.hexdigest() != spec['checksum']:
                raise ValueError('Official archive checksum mismatch')
            receipt.update(compressedSourceBytes=stream.bytes, compressedSourceSha256=stream.sha256.hexdigest(),
                           officialArchiveChecksumVerified=True)
        if found != set(wanted):
            raise ValueError('Missing alignments: ' + str(sorted(set(wanted) - found)))
        receipt['status'] = 'complete'
    except BaseException as e:
        receipt['status'] = 'failed'
        receipt['error'] = repr(e)
        raise
    finally:
        receipt['selectedFiles'] = len(found)
        receipt['finishedAt'] = datetime.now(timezone.utc).isoformat()
        receipt['inventorySha256'] = hashlib.sha256((a.output / 'members.jsonl').read_bytes()).hexdigest()
        destination.write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
