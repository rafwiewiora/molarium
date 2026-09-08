"""Assemble rendered PDF pages for whole-document layout QA, not figure editing."""
from pathlib import Path
from PIL import Image, ImageDraw

pages = sorted(Path('/tmp').glob('molarium-a28-qa-*.png'))
assert len(pages) == 41
for offset in range(0, len(pages), 6):
    sheet = Image.new('RGB', (1662, 1480), 'white')
    draw = ImageDraw.Draw(sheet)
    for n, path in enumerate(pages[offset:offset + 6]):
        page = Image.open(path)
        x, y = (n % 3) * 554, (n // 3) * 740
        sheet.paste(page, (x, y + 20))
        draw.text((x + 10, y + 3), f'Page {offset + n + 1}', fill='black')
    output = Path(f'/tmp/molarium-a28-sheet-{offset // 6 + 1}.png')
    sheet.save(output)
    print(output)
