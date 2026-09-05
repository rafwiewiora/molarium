#!/usr/bin/env python3
"""Compose Figure 2 from the exact five-state SOS1 checkpoint review.

This is a presentation-only operation. It consumes hash-pinned full-interface
captures from the calculation-free public ``campaign.import`` review and never
derives, interpolates, or edits molecular coordinates.
"""

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


OUTPUT = ROOT / "paper" / "figures" / "fig2_sos1_hit_to_bay293.png"
CHECKPOINTS = [
    ("A", "starting-hit", "starting-hit-campaign.json"),
    ("B", "scaffold-rewrite", "scaffold-rewrite-campaign.json"),
    ("C", "fragment-merge", "fragment-merge-campaign.json"),
    ("D", "open-phe890-pocket", "open-phe890-pocket-campaign.json"),
    ("E", "finish-bay-293", "finish-bay-293-campaign.json"),
]
HOLDOUT_IDS = {"5OVF", "5OVG", "5OVH", "5OVI"}


def font(size: int):
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def require_hash(value, label: str):
    if not isinstance(value, str) or len(value) != 64 \
            or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{label} is not a lowercase SHA-256 fingerprint")


def safe_repo_source(source_path: str) -> Path:
    if not isinstance(source_path, str) or not source_path.startswith("./"):
        raise ValueError("Checkpoint sourcePath must be a same-origin relative path")
    path = (ROOT / source_path[2:]).resolve()
    if ROOT.resolve() not in path.parents:
        raise ValueError("Checkpoint sourcePath escapes the repository")
    return path


def verify_inputs(run_dir: Path, render_dir: Path, manifest: dict):
    if manifest.get("schema") != "molarium.designer-moves-interface-render/v1" \
            or manifest.get("complete") is not True \
            or manifest.get("replay", {}).get("status") != "completed":
        raise ValueError("Figure 2 requires a completed interface checkpoint review")
    source_run = manifest.get("sourceRun", {})
    if source_run.get("id") != run_dir.name \
            or source_run.get("resultClass") != "complete-frozen" \
            or source_run.get("replayKind") != "checkpoint-review":
        raise ValueError("Figure 2 requires the declared complete-frozen checkpoint review")
    presentation = manifest.get("presentation", {})
    if presentation.get("cameraContract", {}).get("verified") is not True \
            or presentation.get("highlightCameraAudit", {}).get("verified") is not True:
        raise ValueError("Figure 2 requires a verified fixed interface camera")
    if manifest.get("networkPolicy", {}).get("badgeText") != "Local Lab · network locked":
        raise ValueError("Figure 2 must show the network-locked Local Lab")

    prediction_path = run_dir / "prediction-manifest.json"
    prediction = json.loads(prediction_path.read_text())
    if prediction.get("schema") != "molarium.design-prediction-run/v1" \
            or prediction.get("routeId") != "sos1-hit-only" \
            or prediction.get("status") != "predictions-frozen-holdouts-unopened" \
            or prediction.get("protocol", {}).get("initialCoordinateInput") != "PDB 5OVE/AXE only":
        raise ValueError("Run does not preserve the SOS1 prospective coordinate boundary")
    require_hash(source_run.get("predictionManifestSha256"), "sourceRun prediction hash")
    if digest(prediction_path) != source_run["predictionManifestSha256"]:
        raise ValueError("Render is not bound to this prediction manifest")

    source_record = manifest.get("sourceScript", {})
    source_copy = render_dir / source_record.get("path", "")
    require_hash(source_record.get("fileSha256"), "source script hash")
    if not source_copy.is_file() or digest(source_copy) != source_record["fileSha256"]:
        raise ValueError("Rendered source action script failed its manifest hash")
    source = json.loads(source_copy.read_text())
    actions = source.get("actions", [])
    if source.get("schema") != "molarium.chemist-action-script/v1" \
            or len(actions) != len(CHECKPOINTS) \
            or any(step.get("action") != "campaign.import" for step in actions):
        raise ValueError("Figure 2 source must be the five public campaign.import actions")

    for index, (step, (_, checkpoint_id, filename)) in enumerate(zip(actions, CHECKPOINTS)):
        action_args = step.get("args", {})
        review = step.get("review", {})
        path = safe_repo_source(action_args.get("sourcePath"))
        if path.name != filename or not path.is_file():
            raise ValueError(f"Missing exact {checkpoint_id} campaign")
        require_hash(action_args.get("sourceSha256"), f"{checkpoint_id} source hash")
        if digest(path) != action_args["sourceSha256"] \
                or review.get("campaignSha256") != action_args["sourceSha256"] \
                or review.get("immutableSnapshot") is not True \
                or review.get("calculationPolicy") != "none" \
                or review.get("holdoutCoordinatesIncluded") is not False:
            raise ValueError(f"Invalid exact {checkpoint_id} campaign declaration")
        if index == 0 and (review.get("registeredStartingHit") is not True
                           or review.get("exactHistoryPrefix") is not True):
            raise ValueError("Panel A is not the exact registered starting-hit checkpoint")
    serialized = json.dumps(source, sort_keys=True).upper()
    if any(pdb_id in serialized for pdb_id in HOLDOUT_IDS):
        raise ValueError("Checkpoint review source contains post-freeze holdout identity")


def exact_capture(manifest: dict, render_dir: Path, label: str, checkpoint_index: int):
    captures = manifest.get("captures", [])
    if checkpoint_index == 0:
        matches = [capture for capture in captures
                   if capture.get("label") ==
                   "First frozen prediction checkpoint in fixed local pocket"]
    else:
        imports = [step for step in manifest["presentationScript"]["timeline"]
                   if step.get("action") == "campaign.import"]
        if len(imports) != len(CHECKPOINTS):
            raise ValueError("Presentation timeline does not contain five checkpoint imports")
        import_number = imports[checkpoint_index]["actionNumber"]
        upper = next((step["actionNumber"] for step in imports
                      if step["actionNumber"] > import_number), float("inf"))
        matches = [capture for capture in captures
                   if isinstance(capture.get("actionIndex"), int)
                   and import_number - 1 < capture["actionIndex"] < upper - 1
                   and capture.get("action") == "view.highlightAtoms"
                   and capture.get("label", "").startswith(
                       f"{capture['actionIndex'] + 1}. Result ")]
    if len(matches) != 1:
        raise ValueError(f"Expected one settled exact capture for panel {label}; found {len(matches)}")
    path = render_dir / matches[0]["qaFilename"]
    if not path.is_file() or digest(path) != matches[0].get("sha256"):
        raise ValueError(f"Panel {label} failed its render-manifest hash")
    return path


def main():
    parser = ArgumentParser()
    parser.add_argument("--run", type=Path, required=True,
                        help="Explicit complete-frozen SOS1 source-run directory")
    parser.add_argument("--render-dir", type=Path, required=True,
                        help="Completed five-state checkpoint-review render directory")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    run_dir, render_dir = args.run.resolve(), args.render_dir.resolve()
    manifest = json.loads((render_dir / "render-manifest.json").read_text())
    verify_inputs(run_dir, render_dir, manifest)

    images = []
    for index, (label, _, _) in enumerate(CHECKPOINTS):
        capture = exact_capture(manifest, render_dir, label, index)
        images.append((label, Image.open(capture).convert("RGB")))
    panel_w, panel_h = images[0][1].size
    if any(image.size != (panel_w, panel_h) for _, image in images):
        raise ValueError("All exact interface frames must use the same viewport")

    gutter = 18
    canvas = Image.new("RGB", (panel_w * 2 + gutter, panel_h * 3 + gutter * 2), "white")
    draw = ImageDraw.Draw(canvas)
    label_font = font(48)
    for index, (label, image) in enumerate(images):
        x = (canvas.width - panel_w) // 2 if index == 4 else (index % 2) * (panel_w + gutter)
        y = panel_h * 2 + gutter * 2 if index == 4 else (index // 2) * (panel_h + gutter)
        canvas.paste(image, (x, y))
        # Put the panel key between the left UI and molecule without covering
        # the Molarium brand or the checkpoint caption.
        badge_x, badge_y = x + 350, y + 18
        draw.rounded_rectangle((badge_x, badge_y, badge_x + 66, badge_y + 66),
                               radius=14, fill=(19, 35, 50), outline="white", width=3)
        draw.text((badge_x + 17, badge_y + 7), label, font=label_font, fill="white")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, optimize=True, dpi=(300, 300))
    print(args.output)


if __name__ == "__main__":
    main()
