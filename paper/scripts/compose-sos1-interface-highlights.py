"""Arrange unaltered full-interface screenshots; add only external panel headings."""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--aligned', action='store_true', help='Compose the aligned a22 captures; preserve a21.')
mode.add_argument('--chemical-difference', action='store_true', help='Compose chemically mapped a23 captures; preserve a21/a22.')
args = parser.parse_args()
CAPTURE = ROOT/('paper/review/captures/2026-09-07-aligned-chemistry-a22' if args.aligned else 'paper/review/captures/2026-09-07-interface-chemistry-a21')
PLAN = ROOT/('design-history/publications/sos1/interface-aligned-chemistry-2026-09-07/capture-plan.json' if args.aligned else 'design-history/publications/sos1/interface-chemistry-2026-09-07/capture-plan.json')
if args.chemical_difference:
    CAPTURE = ROOT/'paper/review/captures/2026-09-07-chemical-difference-a23'
    PLAN = ROOT/'design-history/publications/sos1/interface-chemical-difference-2026-09-07/capture-plan.json'
aligned = args.aligned or args.chemical_difference
plan = json.loads(PLAN.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
audit = json.loads((CAPTURE/'worker-audit.json').read_text()) if aligned else None
headings = ['AXE · Starting hit', 'AWT · Scaffold rewrite', 'AWZ · Fragment merge',
            'AWW · Chemical edit and ligand placement', 'AWW · Receptor-only response', 'BAY-293 · Final rewrite']
images, captures = [], []
for stage in plan['selectedStages']:
    expected = next(s for s in plan['states'] if s['stage'] == stage)
    data = json.loads((CAPTURE/f'{stage}.json').read_text())
    assert data['reviewIndex'] == expected['reviewIndex']
    assert data['caption'] == expected['caption']
    assert sorted(data['highlightedAtomIds']) == sorted(expected['highlightedAtomIds'])
    assert data['depiction'].get('error') is None
    assert data['depiction'].get('pending') is None
    assert data['expanded'] and data['docked']
    assert data['networkPolicy'] == 'Local Lab · network locked'
    if aligned:
        checked = next(s for s in audit['results'] if s['stage'] == stage)
        assert data['replayStatus'] == 'completed'
        assert int(data['depiction']['alignedAtoms']) == 8
        assert data['depiction']['alignmentBackend'] == 'RDKit shared-scaffold 2D coordinates'
        assert data['depiction']['sanitization'] == checked['sanitization']
        assert checked['sanitization'].startswith('strict RDKit sanitization;')
        assert data['depiction']['canonicalSmiles'] == checked['smiles']
        assert sha((CAPTURE/f'{stage}.svg').read_bytes()) == data['svgSha256']
    path = CAPTURE/f'{stage}.png'
    image = Image.open(path).convert('RGB')
    images.append(image)
    captures.append(dict(stage=stage, imageSha256=sha(path.read_bytes()),
                         checkpointSha256=expected['checkpointSha256'], **data))
w,h = images[0].size
assert all(im.size == (w,h) for im in images)
gap, heading = 24, 68
canvas = Image.new('RGB', (w*2+gap, (h+heading)*3+gap*2), 'white')
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 34)
for i,im in enumerate(images):
    x,y = (i%2)*(w+gap), (i//2)*(h+heading+gap)
    draw.text((x+14,y+15), f'{chr(65+i)}  {headings[i]}', fill='#243747', font=font)
    canvas.paste(im,(x,y+heading))
output = CAPTURE/'fig2_sos1_designer_intent.png'
canvas.save(output, optimize=True, dpi=(300,300))
(CAPTURE/'fig2_sos1_designer_intent.provenance.json').write_text(json.dumps(dict(
    schema='molarium.full-interface-chemical-highlights/v1',
    figureSha256=sha(output.read_bytes()), capturePlanSha256=sha(PLAN.read_bytes()),
    presentationSha256=plan['presentationSha256'],
    **(dict(chemicalChangeMap=plan['chemicalChangeMap']) if args.chemical_difference else {}),
    imagePolicy='Unaltered full-interface screenshots. Panel headings are outside screenshots. Molecular highlights are native app overlays from persistent atom IDs, not image edits.',
    calculationPolicy=plan['calculationPolicy'], highlightMeaning=plan['highlightMeaning'],
    captureBrowser='Chrome via browser-client; visible Play/Previous/Next and Enlarge 2D controls',
    sourceCodeSha256={p:sha((ROOT/p).read_bytes()) for p in ['app.js','index.html','styles.css','molarium-workspace.css'] + (['rdkit-worker.js'] if aligned else [])},
    **(dict(depictionAlignment=plan['depictionAlignment'], workerAuditSha256=sha((CAPTURE/'worker-audit.json').read_bytes())) if aligned else {}),
    captures=captures),indent=2)+'\n')
print(output)
