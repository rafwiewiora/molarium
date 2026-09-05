#!/usr/bin/env python3
"""Compose six hash-verified, unaltered real-interface checkpoint captures."""
import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("sos1_figure", HERE / "build-sos1-paper-figure.py")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

parser = argparse.ArgumentParser()
parser.add_argument("--run", type=Path, required=True)
parser.add_argument("--render-dir", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
run, render = args.run.resolve(), args.render_dir.resolve()
manifest = json.loads((render / "render-manifest.json").read_text())
assert manifest["complete"] is True and manifest["replay"]["status"] == "completed"
assert manifest["sourceRun"]["id"] == run.name
assert manifest["sourceRun"]["resultClass"] in ("designer-intent", "designer-intent-frozen")
assert manifest["sourceRun"]["replayKind"] == "checkpoint-review"
assert BASE.digest(run / "prediction-manifest.json") == manifest["sourceRun"]["predictionManifestSha256"]
assert BASE.digest(run / "post-freeze-validation.json") == manifest["sourceRun"]["evaluationSummarySha256"]
assert manifest["networkPolicy"]["badgeText"] == "Local Lab · network locked"
assert manifest["presentation"]["cameraContract"]["verified"] is True
assert manifest["presentation"]["highlightCameraAudit"]["verified"] is True
source_path = render / manifest["sourceScript"]["path"]
assert BASE.digest(source_path) == manifest["sourceScript"]["fileSha256"]
source = json.loads(source_path.read_text())
stages = ["starting-hit", "scaffold-rewrite", "fragment-merge", "aww-graph",
          "aww-designer-intent", "aww-phe890-response"]
if len(source["actions"]) == 7:
    stages.append("finish-bay-293")
assert len(source["actions"]) == len(stages)
for stage, step in zip(stages, source["actions"]):
    assert step["action"] == "campaign.import"
    assert step["review"]["designStage"] == stage
    assert step["review"]["calculationPolicy"] == "none"
    assert step["review"]["holdoutCoordinatesIncluded"] is False
    assert BASE.digest(BASE.safe_repo_source(step["args"]["sourcePath"])) == step["args"]["sourceSha256"]
assert source["actions"][0]["review"]["registeredStartingHit"] is True
imports = [step for step in manifest["presentationScript"]["timeline"] if step["action"] == "campaign.import"]
assert len(imports) == len(stages)
images, captures = [], []
for index, stage in enumerate(stages):
    start = imports[index]["actionNumber"] - 1
    end = imports[index + 1]["actionNumber"] - 1 if index + 1 < len(imports) else float("inf")
    if index == 0:
        matches = [entry for entry in manifest["captures"]
                   if entry["label"] == "First frozen prediction checkpoint in fixed local pocket"]
    else:
        matches = [entry for entry in manifest["captures"]
                   if isinstance(entry.get("actionIndex"), int) and start < entry["actionIndex"] < end
                   and entry.get("action") == "view.highlightAtoms"
                   and entry["label"].startswith(f"{entry['actionIndex'] + 1}. Result ")]
    assert len(matches) == 1, (stage, len(matches))
    capture = matches[0]
    path = render / capture["qaFilename"]
    assert BASE.digest(path) == capture["sha256"]
    images.append(BASE.Image.open(path).convert("RGB"))
    captures.append({"stage": stage, "path": str(path), "sha256": capture["sha256"]})
w, h = images[0].size
assert all(image.size == (w, h) for image in images)
if len(images) == 7:
    # The full movie retains the scaffold checkpoint; six paper panels focus
    # on the hit, AWZ, the three decisive AWW states, and the BAY-293 endpoint.
    chosen = [0, 2, 3, 4, 5, 6]
    images = [images[index] for index in chosen]
    captures = [captures[index] for index in chosen]
gutter = 18
canvas = BASE.Image.new("RGB", (w * 2 + gutter, h * 3 + 2 * gutter), "white")
draw = BASE.ImageDraw.Draw(canvas)
for index, image in enumerate(images):
    x, y = index % 2 * (w + gutter), index // 2 * (h + gutter)
    canvas.paste(image, (x, y))
    bx, by = x + 350, y + 18
    draw.rounded_rectangle((bx, by, bx + 66, by + 66), radius=14,
                           fill=(19, 35, 50), outline="white", width=3)
    draw.text((bx + 17, by + 7), chr(65 + index), font=BASE.font(48), fill="white")
args.output.parent.mkdir(parents=True, exist_ok=True)
canvas.save(args.output, optimize=True, dpi=(300, 300))
args.output.with_suffix(".provenance.json").write_text(json.dumps({
    "renderManifestSha256": BASE.digest(render / "render-manifest.json"),
    "figureSha256": BASE.digest(args.output), "captures": captures,
    "policy": "unaltered full-interface captures; panel labels only; no molecular interpolation",
}, indent=2) + "\n")
print(args.output)
