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


OUTPUT = ROOT / "paper" / "figures" / "fig2_sos1_hit_to_bay293.png"
STEP_IDS = [
    "scaffold-rewrite", "fragment-merge", "open-phe890-pocket", "finish-bay-293"
]
HOLDOUT_IDS = {"5OVF", "5OVG", "5OVH", "5OVI"}
COORDINATE_KEYS = {
    "coordinates", "coordinatesAngstrom", "directCoordinates", "pdbText", "molBlock"
}

# Resolve publication states from replay semantics rather than from action
# numbers, which change whenever the interface presentation gains or loses a
# cue. Immutable request IDs from the accepted pre-freeze audit distinguish
# captions reused for compound 21 and BAY-293.
CHECKPOINTS = [
    {
        "label": "A",
        "action": "view.focusComponent",
        "caption": "Center the hit and the local pocket where every design decision will be made",
        "after_request": "route-prepare-hit",
        "before_request": "route-capture-hit",
    },
    {
        "label": "B",
        "action": "view.highlightAtoms",
        "caption": "See exactly where the ligand graph changed",
        "after_request": "open-phe890-pocket-stage",
        "before_request": "open-phe890-pocket-enumerate-phe890-final",
    },
    {
        "label": "C",
        "action": "view.highlightAtoms",
        "caption": "See Phe890 move out of the ligand growth path",
        "after_request": "open-phe890-pocket-apply-selected-phe890-branch",
        "before_request": "open-phe890-pocket-accept-selected-receptor-branch",
    },
    {
        "label": "D",
        "action": "view.highlightAtoms",
        "caption": "Compare the relaxed ligand–pocket geometry in the same fixed view",
        "after_request": "open-phe890-pocket-relax-selected-phe890-branch",
        "before_request": "open-phe890-pocket-advance-build",
    },
    {
        "label": "E",
        "action": "view.highlightAtoms",
        "caption": "Compare the relaxed ligand–pocket geometry in the same fixed view",
        "after_request": "finish-bay-293-complex-relax",
        "before_request": "finish-bay-293-advance-build",
    },
]
if len(CHECKPOINTS) != 5:
    raise RuntimeError("Publication Figure 2 must contain exactly five interface panels")


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


def json_file(path: Path):
    return json.loads(path.read_text())


def file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def require_hash(value, label: str):
    if not isinstance(value, str) or len(value) != 64 \
            or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{label} is not a lowercase SHA-256 fingerprint")


def assert_no_holdout_coordinates(value, path="checkpoint"):
    if isinstance(value, list):
        for index, entry in enumerate(value):
            assert_no_holdout_coordinates(entry, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    coordinate_payload = any(key in value for key in COORDINATE_KEYS)
    identities = {
        str(value.get("pdbId", "")).upper(),
        str(value.get("holdoutPdbId", "")).upper(),
    }
    holdout_identity = (value.get("coordinateClass") == "evaluation-only-holdout"
                        or value.get("role") == "evaluation-only"
                        or bool(identities & HOLDOUT_IDS))
    if coordinate_payload and holdout_identity:
        raise ValueError(f"{path} contains evaluation-only holdout coordinates")
    for key, entry in value.items():
        assert_no_holdout_coordinates(entry, f"{path}.{key}")


def verify_accepted_inputs(run_dir: Path, render_dir: Path, render_manifest: dict):
    required = [
        run_dir / "prediction-manifest.json",
        run_dir / "holdout-evaluation-summary.json",
        run_dir / "chemist-action-audit.json",
    ]
    if any(not path.exists() for path in required):
        missing = [str(path) for path in required if not path.exists()]
        raise FileNotFoundError(f"Accepted-run evidence is incomplete: {missing}")
    prediction_bytes = required[0].read_bytes()
    evaluation_bytes = required[1].read_bytes()
    audit_bytes = required[2].read_bytes()
    prediction = json.loads(prediction_bytes)
    evaluation = json.loads(evaluation_bytes)
    audit = json.loads(audit_bytes)
    if prediction.get("schema") != "molarium.design-prediction-run/v1" \
            or prediction.get("routeId") != "sos1-hit-only" \
            or prediction.get("status") != "predictions-frozen-holdouts-unopened":
        raise ValueError("Figure 2 requires a frozen SOS1 hit-only prediction manifest")
    if prediction.get("protocol", {}).get("initialCoordinateInput") != "PDB 5OVE/AXE only" \
            or prediction.get("protocol", {}).get("sequentialPredictedReferences") is not True:
        raise ValueError("Figure 2 prediction manifest violates the prospective boundary")
    if prediction.get("agentApi", {}).get("auditSha256") != sha256(audit_bytes).hexdigest() \
            or prediction.get("agentApi", {}).get("auditRecords") != len(audit.get("records", [])):
        raise ValueError("Pre-freeze Chemist Actions audit does not match the prediction manifest")
    if evaluation.get("schema") != \
            "molarium.design-prediction-holdout-evaluation-summary/v2" \
            or evaluation.get("routeId") != "sos1-hit-only" \
            or evaluation.get("predictionManifestSha256") != sha256(prediction_bytes).hexdigest():
        raise ValueError("Holdout evaluation does not belong to the prediction manifest")
    if evaluation.get("holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified") is not True \
            or evaluation.get("accepted") is not True \
            or evaluation.get("continuity", {}).get("accepted") is not True:
        raise ValueError("Figure 2 refuses a run that failed holdout or continuity acceptance")
    results = evaluation.get("results", [])
    if [entry.get("stepId") for entry in results] != STEP_IDS \
            or not all(entry.get("accepted") is True
                       and entry.get("failedChecks") == [] for entry in results):
        raise ValueError("Figure 2 requires four accepted SOS1 evaluation results")
    checkpoints = prediction.get("checkpoints", [])
    if [entry.get("stepId") for entry in checkpoints] != STEP_IDS:
        raise ValueError("Prediction manifest does not contain the complete SOS1 route")
    for entry in checkpoints:
        checkpoint_path = run_dir / entry["filename"]
        checkpoint_bytes = checkpoint_path.read_bytes()
        if sha256(checkpoint_bytes).hexdigest() != entry.get("sha256"):
            raise ValueError(f"Frozen checkpoint changed: {entry['stepId']}")
        checkpoint = json.loads(checkpoint_bytes)
        if checkpoint.get("stepId") != entry["stepId"] \
                or checkpoint.get("frozenBeforeHoldoutAccess") is not True:
            raise ValueError(f"Invalid frozen checkpoint: {entry['stepId']}")
        assert_no_holdout_coordinates(checkpoint, f"{entry['stepId']} checkpoint")

    accepted = render_manifest.get("acceptedRun", {})
    for key in ("predictionManifestSha256", "evaluationSummarySha256"):
        require_hash(accepted.get(key), f"render-manifest acceptedRun.{key}")
    if accepted.get("accepted") is not True \
            or accepted.get("id") != run_dir.name \
            or accepted.get("predictionManifestSha256") != sha256(prediction_bytes).hexdigest() \
            or accepted.get("evaluationSummarySha256") != sha256(evaluation_bytes).hexdigest():
        raise ValueError("Interface render is not bound to this accepted SOS1 run")

    source_record = render_manifest.get("sourceScript", {})
    source_path = (render_dir / source_record.get("path", "")).resolve()
    if render_dir.resolve() not in source_path.parents or not source_path.is_file():
        raise ValueError("Interface render has an invalid source action-script path")
    require_hash(source_record.get("fileSha256"), "render-manifest sourceScript.fileSha256")
    if file_sha256(source_path) != source_record["fileSha256"] \
            or source_record.get("sourceAuditSha256") != sha256(audit_bytes).hexdigest():
        raise ValueError("Interface replay source does not match its accepted pre-freeze audit")
    source = json_file(source_path)
    serialized = json.dumps(source, sort_keys=True)
    if source.get("schema") != "molarium.chemist-action-script/v1" \
            or any(pdb_id in serialized for pdb_id in HOLDOUT_IDS):
        raise ValueError("Interface replay source contains a holdout or has the wrong schema")
    if any(key in serialized for key in [f'"{key}"' for key in COORDINATE_KEYS]):
        raise ValueError("Interface replay source embeds coordinates")
    if any(str(step.get("action", "")).startswith("designerScript.")
           or step.get("action") == "interface.presentDesignerStep"
           for step in source.get("actions", [])):
        raise ValueError("Interface replay source contains a private replay shortcut")
    source_request_ids = [step.get("auditRequestId") for step in source.get("actions", [])]
    if not source_request_ids or any(not request_id for request_id in source_request_ids):
        raise ValueError("Interface replay source is not traceable to audit request IDs")
    timeline_request_ids = [step.get("auditRequestId")
                            for step in render_manifest["presentationScript"]["timeline"]
                            if step.get("auditRequestId")]
    if timeline_request_ids != source_request_ids:
        raise ValueError("Presentation timeline changed or reordered the accepted source actions")


def unique_request_step(timeline, request_id: str):
    matches = [step for step in timeline if step.get("auditRequestId") == request_id]
    if len(matches) != 1:
        raise ValueError(f"Expected one timeline step for audit request {request_id!r}; "
                         f"found {len(matches)}")
    return matches[0]


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
    if checkpoint.get("after_request"):
        lower = unique_request_step(timeline, checkpoint["after_request"])["actionNumber"]
    if checkpoint.get("before_request"):
        upper = unique_request_step(timeline, checkpoint["before_request"])["actionNumber"]
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
    parser.add_argument(
        "--run",
        type=Path,
        required=True,
        help="Explicit accepted SOS1 run directory; no run is selected implicitly",
    )
    parser.add_argument(
        "--render-dir",
        type=Path,
        required=True,
        help=(
            "Directory containing the accepted interface replay's "
            "render-manifest.json and synchronized QA frames"
        ),
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    run_dir = args.run.resolve()
    render_dir = args.render_dir.resolve()
    manifest_path = render_dir / "render-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != "molarium.designer-moves-interface-render/v1":
        raise ValueError("Unsupported interface render manifest schema")
    if manifest.get("complete") is not True or manifest.get("replay", {}).get("status") != "completed":
        raise ValueError("Paper frames require a complete, expectation-passing interface replay")
    verify_accepted_inputs(run_dir, render_dir, manifest)

    images = []
    for checkpoint in CHECKPOINTS:
        path = result_capture(manifest, render_dir, checkpoint)
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
