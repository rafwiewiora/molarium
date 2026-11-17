"""Inventory and read-only bind NVIDIA's installed 64-bit user-space libraries."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path.cwd()
cache = subprocess.check_output(['ldconfig', '-p'], text=True)
(root / 'host-ldconfig.txt').write_text(cache)
libraries = {}
parents = set()
for line in cache.splitlines():
    if '=>' not in line or 'x86-64' not in line:
        continue
    name, path = line.split()[0], Path(line.split('=>', 1)[1].strip())
    if name.startswith(('libGLX_nvidia.so', 'libEGL_nvidia.so', 'libnvidia-', 'libcuda.so')):
        if path.is_file():
            libraries[name] = path.resolve()
            parents.add(path.parent)
            parents.add(path.resolve().parent)
# Some runtime-loaded graphics/compiler modules are absent from ldconfig's cache.
for parent in parents:
    for pattern in ['libGLX_nvidia.so*', 'libEGL_nvidia.so*', 'libnvidia-*.so*']:
        for path in parent.glob(pattern):
            if path.is_file():
                libraries.setdefault(path.name, path.resolve())
folder = root / 'graphics-libs'
folder.mkdir()
records = []
hashes = {}
for name, source in sorted(libraries.items()):
    assert re.fullmatch(r'lib[A-Za-z0-9_.-]+', name)
    with source.open('rb') as stream:
        if stream.read(5) != b'\x7fELF\x02':
            continue
    if source not in hashes:
        h = hashlib.sha256()
        with source.open('rb') as stream:
            for block in iter(lambda: stream.read(1024**2), b''):
                h.update(block)
        hashes[source] = h.hexdigest()
    target = folder / name
    target.touch(exist_ok=False)
    records.append({'soname': name, 'source': str(source), 'target': str(target),
                    'sourceBytes': source.stat().st_size, 'sha256': hashes[source]})
available = [name for name in ['libGLX_nvidia.so.0', 'libEGL_nvidia.so.0']
             if any(row['soname'] == name for row in records)]
(root / 'driver-library-bindings.json').write_text(json.dumps({
    'scope': 'Read-only per-job binding of existing host NVIDIA driver files; no installation or global configuration change.',
    'availableIcdLibraries': available, 'libraries': records}, indent=2) + '\n')
assert available, 'Host graphics ICD libraries absent; no substitute driver or software adapter permitted'
(root / 'driver-bind-arguments.txt').write_text(''.join(
    row['source'] + ':' + row['target'] + ':ro\n' for row in records))
print(json.dumps({'driverLibraryAliases': len(records), 'availableIcdLibraries': available}))
