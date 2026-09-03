#!/usr/bin/env python3
"""Compose Figure 2 from synchronized result frames in the interface replay."""

from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT.parent / "pdfs" / "python_pkgs"
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    if VENDOR.exists():
        sys.path.insert(0, str(VENDOR))
    from PIL import Image, ImageDraw, ImageFont


DEFAULT_RENDER = (
    ROOT / "outputs" / "design-history" / "sos1-hit-only-growth-clash-v7"
    / "interface-movie"
)
OUTPUT = ROOT / "paper" / "figures" / "fig2_sos1_hit_to_bay293.png"

# Resolve publication states from replay semantics rather than from action
# numbers, which change whenever the interface presentation gains or loses a
# cue. Bounds distinguish captions reused for compound 21 and BAY-293.
CHECKPOINTS = [
    {
        "label": "A",
        "action": "view.focusComponent",
        "caption": "Center the hit and the local pocket where every design decision will be made",
    },
    {
        "label": "B",
        "action": "view.highlightAtoms",
        "caption": "See exactly where the ligand graph changed",
        "after": ("designRoute.applyStep", "Grow compound 21—and create a clash with Phe890-in"),
        "before": ("pose.enumerateSidechainRotamers", "Enumerate discrete Phe890 side-chain alternatives"),
    },
    {
        "label": "C",
        "action": "view.highlightAtoms",
        "caption": "See Phe890 move out of the ligand growth path",
        "after": ("pose.applySidechainRotamer", "Choose the predicted Phe890-out branch"),
        "before": ("pose.updateReceptorReference", "Make the selected receptor branch the new pose reference"),
    },
    {
        "label": "D",
        "action": "view.highlightAtoms",
        "caption": "Compare the relaxed ligand–pocket geometry in the same fixed view",
        "after": ("optimization.run", "Relax compound 21 and the opened pocket together"),
        "before": ("view.setMode", "Return to Design with the predicted open pocket"),
    },
    {
        "label": "E",
        "action": "view.highlightAtoms",
        "caption": "Compare the relaxed ligand–pocket geometry in the same fixed view",
        "after": ("optimization.run", "Relax the final predicted BAY-293 complex"),
    },
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


def unique_step(timeline, action: str, caption: str):
    matches = [
        step for step in timeline
        if step.get("action") == action and step.get("caption") == caption
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one timeline step for {action!r} / {caption!r}; "
            f"found {len(matches)}"
        )
    return matches[0]


def resolve_checkpoint(manifest, checkpoint):
    timeline = manifest["presentationScript"]["timeline"]
    lower = 0
    upper = float("inf")
    if checkpoint.get("after"):
        lower = unique_step(timeline, *checkpoint["after"])["actionNumber"]
    if checkpoint.get("before"):
        upper = unique_step(timeline, *checkpoint["before"])["actionNumber"]
    matches = [
        step for step in timeline
        if step.get("action") == checkpoint["action"]
        and step.get("caption") == checkpoint["caption"]
        and lower < step["actionNumber"] < upper
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one semantic checkpoint {checkpoint['label']} between "
            f"actions {lower} and {upper}; found {len(matches)}"
        )
    return matches[0]


def result_capture(manifest, render_dir: Path, checkpoint):
    step = resolve_checkpoint(manifest, checkpoint)
    action_number = step["actionNumber"]
    action = step["action"]
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
    expected_sha256 = matches[0].get("sha256")
    if expected_sha256 and sha256(path.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError(f"Interface frame failed its render-manifest hash: {path}")
    return path


def main():
    parser = ArgumentParser()
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    manifest_path = args.render_dir / "render-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("complete") is not True or manifest.get("replay", {}).get("status") != "completed":
        raise ValueError("Paper frames require a complete, expectation-passing interface replay")

    images = []
    for checkpoint in CHECKPOINTS:
        path = result_capture(manifest, args.render_dir, checkpoint)
        images.append((checkpoint["label"], Image.open(path).convert("RGB")))

    panel_w, panel_h = images[0][1].size
    if any(image.size != (panel_w, panel_h) for _, image in images):
        raise ValueError("All interface frames must use the same viewport")
    gutter = 18
    canvas = Image.new("RGB", (panel_w * 2 + gutter, panel_h * 3 + gutter * 2), "white")
    draw = ImageDraw.Draw(canvas)
    label_font = font(48)

    for index, (label, image) in enumerate(images):
        # Five molecular states read more cleanly without a sixth explanatory
        # card. Center the final state beneath the two paired rows.
        if index == len(images) - 1:
            x = (canvas.width - panel_w) // 2
            y = panel_h * 2 + gutter * 2
        else:
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
