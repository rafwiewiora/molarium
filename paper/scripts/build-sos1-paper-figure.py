#!/usr/bin/env python3
"""Compose Figure 2 from synchronized result frames in the interface replay."""

from argparse import ArgumentParser
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT.parent / "pdfs" / "python_pkgs"
if VENDOR.exists():
    sys.path.insert(0, str(VENDOR))

from PIL import Image, ImageDraw, ImageFont


DEFAULT_RENDER = (
    ROOT / "outputs" / "design-history" / "sos1-hit-only-growth-clash-v7"
    / "molarium-interface-final"
)
OUTPUT = ROOT / "paper" / "figures" / "fig2_sos1_hit_to_bay293.png"

# These identify completed interface checkpoints, not video timestamps. The
# renderer verifies that every result is visibly presented before capturing it.
PANELS = [
    ("A", 5, "view.focusComponent"),
    ("B", 29, "view.highlightAtoms"),
    ("C", 32, "view.highlightAtoms"),
    ("D", 49, "view.highlightAtoms"),
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


def result_capture(manifest, render_dir: Path, action_number: int, action: str):
    timeline = manifest["presentationScript"]["timeline"]
    step = timeline[action_number - 1]
    if step["actionNumber"] != action_number or step["action"] != action:
        raise ValueError(
            f"Action {action_number} is {step['action']!r}, expected {action!r}"
        )
    matches = [
        capture for capture in manifest["captures"]
        if capture.get("actionIndex") == action_number - 1
        and capture.get("action") == action
        and capture["label"].startswith(f"{action_number}. Result ")
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one synchronized result capture for action {action_number}; "
            f"found {len(matches)}"
        )
    path = render_dir / matches[0]["qaFilename"]
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def main():
    parser = ArgumentParser()
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    manifest_path = args.render_dir / "render-manifest.json"
    manifest = json.loads(manifest_path.read_text())

    images = []
    for label, action_number, action in PANELS:
        path = result_capture(manifest, args.render_dir, action_number, action)
        images.append((label, Image.open(path).convert("RGB")))

    panel_w, panel_h = images[0][1].size
    if any(image.size != (panel_w, panel_h) for _, image in images):
        raise ValueError("All interface frames must use the same viewport")
    gutter = 18
    canvas = Image.new("RGB", (panel_w * 2 + gutter, panel_h * 2 + gutter), "white")
    draw = ImageDraw.Draw(canvas)
    label_font = font(48)

    for index, (label, image) in enumerate(images):
        x = (index % 2) * (panel_w + gutter)
        y = (index // 2) * (panel_h + gutter)
        canvas.paste(image, (x, y))
        badge_x, badge_y = x + 354, y + 18
        draw.rounded_rectangle(
            (badge_x, badge_y, badge_x + 66, badge_y + 66),
            radius=14,
            fill=(19, 35, 50),
            outline=(255, 255, 255),
            width=3,
        )
        draw.text((badge_x + 17, badge_y + 7), label, font=label_font, fill="white")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, optimize=True, dpi=(300, 300))
    print(args.output)


if __name__ == "__main__":
    main()
