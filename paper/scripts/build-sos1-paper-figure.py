#!/usr/bin/env python3
"""Compose the four reviewed SOS1 structure-story frames used in the paper."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT.parent / "pdfs" / "python_pkgs"
if VENDOR.exists():
    sys.path.insert(0, str(VENDOR))

from PIL import Image, ImageDraw, ImageFont


SOURCE = ROOT / "outputs" / "design-history" / "sos1-hit-only-growth-clash-v7" / "recovered-clean-v4-final" / "qa"
OUTPUT = ROOT / "paper" / "figures" / "fig2_sos1_hit_to_bay293.png"
FRAMES = [
    ("A", SOURCE / "keyframe-01.png"),
    ("B", SOURCE / "keyframe-02.png"),
    ("C", SOURCE / "keyframe-03.png"),
    ("D", SOURCE / "keyframe-05.png"),
]


def font(size: int):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def main():
    images = []
    for label, path in FRAMES:
        if not path.exists():
            raise FileNotFoundError(path)
        images.append((label, Image.open(path).convert("RGB")))

    panel_w, panel_h = images[0][1].size
    gutter = 18
    canvas = Image.new("RGB", (panel_w * 2 + gutter, panel_h * 2 + gutter), "white")
    draw = ImageDraw.Draw(canvas)
    label_font = font(48)

    for index, (label, image) in enumerate(images):
        x = (index % 2) * (panel_w + gutter)
        y = (index // 2) * (panel_h + gutter)
        canvas.paste(image, (x, y))
        # Put the panel identifier in the molecular viewport rather than over the
        # story title, preserving the scientific labels already in each frame.
        badge_x, badge_y = x + 354, y + 18
        draw.rounded_rectangle(
            (badge_x, badge_y, badge_x + 66, badge_y + 66),
            radius=14,
            fill=(19, 35, 50),
            outline=(255, 255, 255),
            width=3,
        )
        draw.text((badge_x + 17, badge_y + 7), label, font=label_font, fill="white")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True, dpi=(300, 300))
    print(OUTPUT)


if __name__ == "__main__":
    main()
