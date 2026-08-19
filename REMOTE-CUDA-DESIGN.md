# Remote CUDA execution design

Molarium is local-first. Remote CUDA is an optional calculation provider for users who want to
connect their own workstation, Modal deployment, Colab session, or another authenticated GPU.
It must never be a silent fallback from browser WebGPU.

## Relevant NVIDIA technology

The NVIDIA project is **ALCHEMI**:

- [ALCHEMI Toolkit](https://github.com/NVIDIA/nvalchemi-toolkit) is an Apache-2.0, GPU-first
  Python framework for batched molecular dynamics and relaxation. It keeps atomistic batches on
  the GPU and supports inflight replacement as individual systems finish.
- [ALCHEMI Toolkit-Ops](https://github.com/NVIDIA/nvalchemi-toolkit-ops) supplies GPU kernels for
  neighbor lists, dispersion, and long-range interactions.
- NVIDIA also distributes ALCHEMI Batched Geometry Relaxation and Batched Molecular Dynamics NIM
  services with HTTP APIs and automatic batch-size estimation.

ALCHEMI currently exposes MACE, AIMNet2, TensorNet, and custom model interfaces. ANI-2x is not a
plug-and-play NIM model. Our quickest independent CUDA reference for ANI is therefore native
[TorchANI](https://github.com/aiqm/torchani), optionally with
[NNPOps](https://github.com/openmm/NNPOps). An ALCHEMI/AIMNet2 adapter can follow after the common
remote protocol is working.

## Product boundary

The browser sees one `RemoteCalculationProvider`. Engines and deployment locations stay behind it.

```text
Molarium calculation request
            |
            v
RemoteCalculationProvider
            |
       signed protocol
      /       |        \
local CUDA   Modal    Colab relay
      \       |        /
       TorchANI CUDA first
       ALCHEMI/AIMNet2 next
```

The provider must return the same logical messages as the current workers:

```text
{ type: "run", id, job, molecule, options }
{ type: "progress", id, phase, model, calculation }
{ type: "result", id, job, ... }
{ type: "error", id, message, code }
```

Remote conformer and trajectory results use the existing packed shapes, including
`ensembleTrajectory`, `ensembleEnergies`, `frameSteps`, `replicaCount`, and
`ensembleLayout: "frame-replica-xyz"`. Arena and the viewer should not need a remote-only result
format.

## Protocol

### Capabilities

`GET /v1/capabilities` returns:

- protocol and runner versions;
- container digest;
- engine and model IDs, versions, and SHA-256 hashes;
- supported elements, charges, spin states, tasks, precision, and deterministic modes;
- device vendor, name, compute capability, memory, and driver;
- maximum atoms, conformers, payload bytes, and runtime;
- supported streaming and cancellation behavior.

A request names the required execution explicitly:

```json
{
  "backend": "torchani-cuda",
  "device": "cuda",
  "precision": "float32",
  "fallback": "forbid"
}
```

An unsupported request fails with `409 capability_mismatch`. Results report requested and actual
engine, model hash, device, precision, deterministic mode, and fallback status.

### Content-addressed assets

Static model weights and parameterized Systems are identified by SHA-256. The runner recomputes
the digest before caching them.

- `HEAD /v1/assets/{sha256}` checks the cache.
- `PUT /v1/assets/{sha256}` uploads an allowed asset.
- A repeated homogeneous search sends only model/System hashes and the coordinate batch.
- A missing cache entry returns `428 asset_required` with the missing hashes.

The first version should allow only preinstalled or allow-listed assets. Arbitrary Python,
pickles, model code, and executable deserialization are forbidden.

### Jobs

- `POST /v1/jobs`
- `GET /v1/jobs/{id}`
- `GET /v1/jobs/{id}/events` using server-sent events
- `GET /v1/jobs/{id}/result`
- `DELETE /v1/jobs/{id}` for idempotent cancellation

Long trajectories are chunked into compressed binary Float32 blocks with declared dtype, shape,
SHA-256, and URL. Progress and frame events use monotonic sequence numbers. A job has exactly one
terminal state: completed, failed, or cancelled.

## Deployment profiles

### Local CUDA sidecar

- Bind only to `127.0.0.1` on a random port.
- Print a one-time pairing token in the terminal.
- Allow only the exact Molarium origin through CORS.
- Prefer an outbound secure relay for hosted Molarium deployments where browser mixed-content or
  local-network restrictions make a direct loopback connection unreliable.

### Modal

- Deploy the same runner as an authenticated FastAPI/ASGI GPU function.
- Keep Modal proxy credentials in browser session memory only.
- Use HTTPS plus SSE or WebSockets; never put credentials in query strings.
- Keep model volumes warm and cache models/Systems by hash.

### Colab

Colab does not provide a stable public inbound service endpoint. The notebook runner should make
an outbound authenticated WebSocket connection to a small pairing relay. The browser and notebook
pair with a one-time code. Payloads remain end-to-end encrypted so the relay cannot inspect
unpublished structures.

## Authentication and safety

- Sign canonical request envelopes with an expiring pairing secret, timestamp, nonce, and payload
  hash. Reject expired or replayed nonces.
- Sign result events and chain them with the prior event hash.
- Use TLS/WSS remotely. Add ECDH-derived AES-GCM when messages traverse a relay.
- Store pairing credentials only in memory unless the user explicitly chooses otherwise.
- Enforce strict schemas, origin checks, atom/conformer/runtime/byte quotas, timeouts, and rate limits.
- Run a read-only container with a bounded content-addressed cache.
- Never log structures, coordinates, credentials, or signed request bodies by default.
- Do not expose an NVIDIA NIM directly; put authentication, TLS, and rate limiting in front of it.

## In-app validation mode

“Validate remote backend” runs hashed fixtures locally and remotely, then shows:

- energy difference;
- force relative RMS and maximum component error;
- geometry RMSD after minimization;
- batch-size-one versus batch-size-N equivalence;
- requested versus actual backend/model/device/precision;
- model, input, runner, and container hashes;
- upload, queue, initialization, calculation, download, and total wall time.

Test mode pins seeds and model/container hashes, requests deterministic algorithms where supported,
and forbids fallback. CUDA results use measured tolerances across devices rather than assumed bitwise
identity.

## Proposed implementation order

1. Define JSON schemas and implement a fake runner used by browser tests.
2. Add `RemoteCalculationProvider` behind the existing worker request/result interface.
3. Build a local TorchANI CUDA runner for energy, forces, batched minimization, and conformer search.
4. Add the in-app local-versus-remote parity gate.
5. Deploy the unchanged runner on Modal.
6. Add the Colab outbound relay and notebook.
7. Add an ALCHEMI/AIMNet2 engine adapter.
8. Add live CUDA testing on at least two NVIDIA architectures.

Suggested code layout:

```text
remote/
  protocol.js
  client.js
  provider.js
  typed-arrays.js
  schemas/
  fake-runner.js
  runner/
    molarium_runner/
      app.py
      capabilities.py
      jobs.py
      assets.py
      security.py
      wire.py
      engines/
        base.py
        torchani.py
        alchemi.py
  deploy/
    modal_app.py
    Molarium_CUDA_Runner.ipynb
  relay/
```

## Acceptance gates

- Schema, model, device, and precision mismatches fail before calculation.
- CPU fallback is never labelled CUDA.
- Signatures, expiry, replay detection, tampering, CORS, and quotas are tested.
- Asset hash mismatches fail; a cache hit enables coordinates-only repeat requests.
- Native TorchANI goldens, finite differences, and single-versus-batch tests pass.
- Batch permutation, duplication, and isolation tests pass per conformer.
- Progress is monotonic; frame hashes and shapes are verified.
- Cancellation stops GPU work and cannot later produce a completed result.
- Browser exports retain exact execution provenance.
- A fake-runner test runs in normal CI; real CUDA tests are gated and retain raw manifests.

A credible local/Modal/Colab MVP is roughly 12–18 engineer-days. An ALCHEMI/AIMNet2 adapter is an
additional 3–6 days. Production multi-tenant service hardening is separate; the initial design is
for users connecting compute they control.
