"""Run the pinned upstream page harness without Molarium's folding wrapper.

Only ports and the browser-profile location are replaced in memory. The page,
ligand preparation, weights, neural code and original harness remain unedited.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import time
import traceback
import zipfile
from datetime import datetime, timezone


REVISION = "5ea3d42c911949700401b54003cb28c557fcf2a6"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], text=True).strip()


def verify_upstream(root):
    if git(root, "rev-parse", "HEAD") != REVISION:
        raise ValueError(f"LocalFold must be pinned to {REVISION}")
    if git(root, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("LocalFold checkout must be clean; refusing to clean or alter it")
    return {"revision": REVISION, "tree": git(root, "rev-parse", "HEAD^{tree}"),
            "files": {name: sha256(root / name) for name in (
                "tools/fold-in-page.py", "tools/cdp.py", "tools/check-job-archive.py", "index.html",
                "web/app.js", "web/af3-model.js", "shared/chem/component.js",
                "shared/bundles/manifests/index.js",
                "shared/bundles/manifests/openbind0.js",
                "shared/bundles/manifests/boltz2.js")}}


def validate_job(raw):
    job = json.loads(raw)
    if isinstance(job, list):
        if len(job) != 1:
            raise ValueError("Supply one job per immutable attempt")
        job = job[0]
    if not isinstance(job, dict) or not job.get("sequences"):
        raise ValueError("Supply an AlphaFold 3 job JSON with sequences")
    seeds = job.get("modelSeeds")
    if not isinstance(seeds, list) or len(seeds) != 1:
        raise ValueError("Supply exactly one modelSeeds entry; upstream otherwise uses only the first")
    # Inputs are passed byte-for-byte. External paths are not portable through
    # a browser file upload; require the caller to provide the actual inline MSA.
    def check(value):
        if isinstance(value, dict):
            if any(key.endswith("Path") for key in value):
                raise ValueError("Use inline inputs, not external file Path fields")
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
    check(job)
    return {"name": job.get("name"), "modelSeeds": seeds}


def observed_controls(log, model, steps, recycles):
    rows = [json.loads(line.removeprefix("controls: "))
            for line in log.splitlines() if line.startswith("controls: ")]
    if len(rows) != 1:
        raise ValueError("Expected one original-page controls record")
    actual = rows[0]
    if (actual.get("model"), str(actual.get("af3count")), str(actual.get("recycles"))) != (
            model, str(steps), str(recycles)):
        raise ValueError(f"Page controls differ from requested settings: {actual}")
    return actual


def unused_ports():
    with socket.socket() as first, socket.socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        return first.getsockname()[1], second.getsockname()[1]


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, value):
        for stream in self.streams:
            stream.write(value)
            stream.flush()
        return len(value)

    def flush(self):
        for stream in self.streams:
            stream.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-root", required=True, type=Path)
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", required=True, choices=["openbind0", "boltz2"])
    parser.add_argument("--steps", required=True, type=int)
    parser.add_argument("--recycles", required=True, type=int)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--prepare-only", action="store_true",
                        help="validate inputs/source and original CLI; do not launch Chrome or fold")
    args = parser.parse_args()
    if args.steps < 1 or args.recycles < 0 or args.timeout < 1:
        parser.error("steps/timeout must be positive and recycles nonnegative")
    root, output = args.upstream_root.resolve(), args.output.resolve()
    if output.is_relative_to(root):
        parser.error("output must be outside the pristine LocalFold checkout")
    source = verify_upstream(root)
    raw = args.job.read_bytes()
    job = validate_job(raw)
    output.mkdir(parents=True, exist_ok=False)
    (output / "input.json").write_bytes(raw)
    receipt = {
        "schema": "molarium.stock-localfold-page.v1", "status": "preparing",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "Original pinned LocalFold page through its own Fold button; no Molarium input or inference wrapper.",
        "upstream": source, "upstreamRoot": str(root), "job": job,
        "inputSha256": sha256(output / "input.json"),
        "launcherSha256": sha256(__file__), "python": sys.version,
        "platform": platform.platform(),
        "requested": {"model": args.model, "steps": args.steps, "recycles": args.recycles},
        "defaults": "All other controls retain upstream page/job behavior; ligand conformer seed is not overridden.",
        "operationalOverrides": ["loopback HTTP/CDP ports", "new task-owned browser profile"],
        "environment": {key: os.environ.get(key) for key in (
            "LOCALFOLD_CHROME", "LOCALFOLD_HEADLESS", "LOCALFOLD_STOCK_FLAGS", "DISPLAY")},
        "hardwareQualification": "Not established by this launcher; do not infer device parity or performance parity.",
        "upstreamHarnessInvoked": False, "neuralInferenceCompleted": False,
    }
    started = time.monotonic()
    original_argv, original_path = sys.argv[:], sys.path[:]
    original_bytecode_setting = sys.dont_write_bytecode
    previous_cdp = sys.modules.get("cdp")
    harness = None
    original_launch = None
    try:
        # Avoid creating __pycache__ in the checkout when importing its tools.
        sys.dont_write_bytecode = True
        sys.modules.pop("cdp", None)
        spec = importlib.util.spec_from_file_location("stock_localfold_page", root / "tools/fold-in-page.py")
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        if args.prepare_only:
            sys.argv = [str(root / "tools/fold-in-page.py"), "--help"]
            with (output / "upstream-help.txt").open("w") as stream, contextlib.redirect_stdout(stream):
                try:
                    harness.main()
                except SystemExit as exc:
                    if exc.code != 0:
                        raise
            receipt["status"] = "prepared-not-run"
        else:
            harness.PORT, harness.DBG = unused_ports()
            receipt["ports"] = {"http": harness.PORT, "cdp": harness.DBG}
            original_launch = harness.cdp.launch

            def launch(port, _upstream_profile, **kwargs):
                receipt["chromeBinary"] = harness.cdp.chrome_binary()
                receipt["chromeFlags"] = harness.cdp.chrome_flags()
                return original_launch(port, str(output / "chrome-profile"), **kwargs)

            harness.cdp.launch = launch
            sys.argv = [str(root / "tools/fold-in-page.py"), "--remote-weights",
                        "--job", str(output / "input.json"), "--model", args.model,
                        "--steps", str(args.steps), "--recycles", str(args.recycles),
                        "--timeout", str(args.timeout), "--save-pdb", str(output / "prediction.pdb"),
                        "--job-archive", str(output / "job.zip")]
            receipt["upstreamArgv"] = sys.argv[:]
            receipt["upstreamHarnessInvoked"] = True
            receipt["status"] = "running"
            (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
            with (output / "upstream.log").open("w") as stream:
                with contextlib.redirect_stdout(Tee(sys.stdout, stream)), contextlib.redirect_stderr(Tee(sys.stderr, stream)):
                    code = harness.main()
            if code != 0:
                raise RuntimeError(f"Original LocalFold harness returned {code}")
            receipt["observedControls"] = observed_controls(
                (output / "upstream.log").read_text(), args.model, args.steps, args.recycles)
            if not any(line.startswith(("ATOM  ", "HETATM"))
                       for line in (output / "prediction.pdb").read_text().splitlines()):
                raise ValueError("Original page did not save an atomic PDB")
            with zipfile.ZipFile(output / "job.zip") as archive:
                if not archive.namelist() or archive.testzip() is not None:
                    raise ValueError("Original job archive is empty or corrupt")
            checked = subprocess.run([sys.executable, "-B", str(root / "tools/check-job-archive.py"),
                "--job", str(output / "input.json"), "--archive", str(output / "job.zip")],
                capture_output=True, text=True)
            (output / "archive-check.log").write_text(checked.stdout + checked.stderr)
            if checked.returncode != 0:
                raise ValueError("Original independent job-archive checker failed; see archive-check.log")
            receipt["outputs"] = {name: {"sha256": sha256(output / name),
                "bytes": (output / name).stat().st_size} for name in (
                    "prediction.pdb", "job.zip", "upstream.log", "archive-check.log")}
            receipt["neuralInferenceCompleted"] = True
            receipt["status"] = "complete"
    except BaseException as exc:
        receipt["status"] = "failed"
        receipt["error"] = f"{type(exc).__name__}: {exc}"
        (output / "failure.txt").write_text(traceback.format_exc())
    finally:
        if original_launch is not None:
            harness.cdp.launch = original_launch
        sys.argv, sys.path = original_argv, original_path
        sys.dont_write_bytecode = original_bytecode_setting
        sys.modules.pop("cdp", None)
        if previous_cdp is not None:
            sys.modules["cdp"] = previous_cdp
        try:
            if verify_upstream(root) != source:
                raise ValueError("Upstream source changed during attempt")
        except Exception as exc:
            receipt["status"] = "failed"
            receipt["sourceVerificationError"] = str(exc)
        receipt["elapsedSeconds"] = time.monotonic() - started
        receipt["finishedAt"] = datetime.now(timezone.utc).isoformat()
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json")}))
    return 0 if receipt["status"] in ("complete", "prepared-not-run") else 1


if __name__ == "__main__":
    raise SystemExit(main())
