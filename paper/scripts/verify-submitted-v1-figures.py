#!/usr/bin/env python3
"""Compare every submitted PDF figure to its source pixels (Poppler + Pillow).

Run: uv run --with pillow python paper/scripts/verify-submitted-v1-figures.py
This reads the PDF without rewriting it. PNG compression/metadata may differ.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SUB = ROOT/'paper/submissions/chemrxiv-v1-2026-09-08'
sha = lambda data: hashlib.sha256(data).hexdigest()
names = re.findall(r'\\safeincludegraphics\[[^\]]*\]\{([^}]+)\}', (SUB/'main.tex').read_text())
records = []
with tempfile.TemporaryDirectory(prefix='molarium-submitted-figures-') as directory:
    subprocess.run(['pdfimages', '-png', str(SUB/'Molarium.pdf'), str(Path(directory)/'figure')], check=True)
    extracted = sorted(Path(directory).glob('figure-*.png'))
    assert len(extracted) == len(names) == 6, 'Unexpected figure count or image mask'
    for number, (name, image) in enumerate(zip(names, extracted), 1):
        original = Image.open(SUB/name).convert('RGB')
        embedded = Image.open(image).convert('RGB')
        assert original.size == embedded.size and original.tobytes() == embedded.tobytes(), name
        records.append(dict(figure=number, source=name, width=original.width, height=original.height,
                            sourceFileSha256=sha((SUB/name).read_bytes()), rgbPixelSha256=sha(original.tobytes()), exactPixelMatch=True))
result = dict(schema='molarium.submitted-figure-verification/v1',
              method='Poppler pdfimages -png; Pillow RGB decoded pixel equality in document order',
              pdfSha256=sha((SUB/'Molarium.pdf').read_bytes()), sourceSha256=sha((SUB/'main.tex').read_bytes()),
              figures=records, allSixFiguresMatch=True, pdfRewritten=False)
(SUB/'figure-verification.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
