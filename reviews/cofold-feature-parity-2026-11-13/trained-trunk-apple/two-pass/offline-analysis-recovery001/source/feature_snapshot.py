"""Read portable numerical feature snapshots without pickle or model imports."""
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import numpy as np


@dataclass(frozen=True)
class MetadataObject:
    kind: str


def load_snapshot(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'features.json').read_bytes())
    if manifest['schema'] != 'molarium.native-feature-capture.v1':
        raise ValueError('Unknown feature snapshot schema')
    blob = manifest['blob']
    path = (directory / blob['file']).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise ValueError('Feature blob escapes its snapshot')
    raw = path.read_bytes()
    if len(raw) != blob['bytes'] or hashlib.sha256(raw).hexdigest() != blob['sha256']:
        raise ValueError('Feature blob changed or transfer incomplete')
    arrays, ranges = {}, []
    for key, item in manifest['arrays'].items():
        dtype = np.dtype(item['dtype'])
        shape = item['shape']
        if dtype.kind not in 'biufc' or any(not isinstance(n, int) or n < 0 for n in shape):
            raise ValueError('Only explicitly shaped numerical feature arrays are allowed')
        start, count = item['byteOffset'], item['bytes']
        if start < 0 or start % 8 or count != math.prod(shape) * dtype.itemsize or start + count > len(raw):
            raise ValueError('Feature array bounds/shape mismatch')
        data = raw[start:start + count]
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Feature array hash mismatch')
        if count:
            ranges.append((start, start + count))
        arrays[key] = np.frombuffer(data, dtype=dtype).reshape(shape)
    ranges.sort()
    if any(a[1] > b[0] for a, b in zip(ranges, ranges[1:])):
        raise ValueError('Overlapping array storage')

    def decode(node):
        if 'array' in node:
            return arrays[node['array']]
        if 'value' in node:
            return node['value']
        if 'dict' in node:
            result = {}
            for k, v in node['dict']:
                key = decode(k)
                if isinstance(key, np.ndarray) and key.shape == ():
                    key = key.item()
                if key in result:
                    raise ValueError('Duplicate feature key')
                result[key] = decode(v)
            return result
        if 'list' in node:
            return [decode(v) for v in node['list']]
        if 'tuple' in node:
            return tuple(decode(v) for v in node['tuple'])
        if 'bigint' in node:
            return int(node['bigint'])
        if 'arrayMetadata' in node:
            return {'metadataArray': decode(node['arrayMetadata']), 'dtype': node['dtype'], 'shape': node['shape']}
        if 'metadataObjectType' in node:
            return MetadataObject(node['metadataObjectType'])
        if 'undefined' in node:
            return MetadataObject('JavaScript.undefined')
        if 'nonFiniteScalar' in node:
            return MetadataObject('JavaScript.' + node['nonFiniteScalar'])
        raise ValueError('Unknown feature tree node')

    return decode(manifest['tree']), manifest
