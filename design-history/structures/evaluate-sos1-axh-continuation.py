#!/usr/bin/env python3
"""Measurement-only comparison of a frozen, reference-informed AXH continuation."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from rdkit import Chem

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
evaluator = load("axh_evaluator", "evaluate-sos1-holdouts.py")
designer = load("axh_designer", "build-sos1-designer-validation.py")
digest = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument("--run", type=Path, required=True)
parser.add_argument("--holdout", type=Path, required=True)
args = parser.parse_args()
run = args.run.resolve()
output = run / "post-freeze-comparison.json"
assert not output.exists(), "Refusing to overwrite an existing comparison"
manifest_bytes = (run / "continuation-manifest.json").read_bytes()
manifest = json.loads(manifest_bytes)
assert manifest["status"] == "completed"
assert manifest["externalReferenceCoordinatesUsed"] is False
descriptor = manifest["checkpoints"]["finish-bay-293"]
campaign_bytes = (run / descriptor["filename"]).read_bytes()
assert digest(campaign_bytes) == descriptor["sha256"]
campaign = json.loads(campaign_bytes)
snapshot = campaign["objects"]["snapshots"][descriptor["snapshotId"]]
assert campaign["branches"]["main"] == descriptor["commitId"]
assert campaign["objects"]["commits"][descriptor["commitId"]]["snapshotId"] == descriptor["snapshotId"]
coords = dict(zip(snapshot["coordinates"]["atomIds"], snapshot["coordinates"]["positions"]))
reference = [{"record":"ATOM", "atomName":atom["atomName"], "residueName":atom["residueName"],
              "chain":atom["chain"], "residueNumber":atom["residueIndex"],
              "insertionCode":atom.get("insertionCode", ""), "point":np.array(coords[atom["atomId"]])}
             for atom in snapshot["graph"]["atoms"] if atom["record"] == "ATOM"]
checkpoint = json.loads((run / "relaxed-coordinates.json").read_text())
checkpoint["predictedStateId"] = "AXH"
route = json.loads((HERE / "generated/sos1-prospective-campaign.json").read_text())
protocol_path = HERE / "generated/sos1-holdout-evaluation-protocol.json"
protocol_bytes, protocol = evaluator.verify_evaluation_protocol(protocol_path)
step = next(entry for entry in route["steps"] if entry["id"] == "finish-bay-293")
integrity = evaluator.prediction_integrity(checkpoint, step, Chem.MolFromSmiles(step["productSmiles"]))
holdout_bytes = args.holdout.read_bytes()
assert evaluator.pdb_identifier(holdout_bytes.decode()) == "5OVI"
measurement = designer.measure_state(next(entry for entry in designer.VALIDATION_SPECS
    if entry["stepId"] == "finish-bay-293"), checkpoint, reference,
    holdout_bytes.decode(), route, protocol, evaluator)
optimization = json.loads((run / "optimization.json").read_text())
report = {"schema":"molarium.sos1-axh-continuation-comparison/v1",
          "measurementOnly":True, "designerIntentReferenceInformed":True,
          "externalReferenceCoordinatesUsed":False, "holdoutCoordinatesIncluded":False,
          "continuationManifestSha256":digest(manifest_bytes), "campaignSha256":digest(campaign_bytes),
          "holdoutSha256":digest(holdout_bytes), "evaluationProtocolSha256":digest(protocol_bytes),
          "ligandIntegrity":integrity, "measurement":measurement,
          "retainedSpatialFeatures":optimization["registeredPoseRetention"]["after"]["features"]}
designer.assert_measurement_only_output(report)
with output.open("x") as handle:
    handle.write(json.dumps(report, indent=2) + "\n")
print(json.dumps({"ligandIntegrity":integrity,
                  "ligandRmsd":measurement["ligand"]["wholeHeavyAtomRmsdAngstrom"],
                  "phe890":measurement["predictedReceptorVersusHoldout"],
                  "features":report["retainedSpatialFeatures"]}, indent=2))
