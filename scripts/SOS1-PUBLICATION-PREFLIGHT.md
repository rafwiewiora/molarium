# SOS1 publication preflight

`npm run verify:sos1-publication` is a fail-closed publication check. It never chooses the newest
run and never repairs or regenerates evidence. The declared run must already have passed the
independent holdout evaluator.

The check binds four layers:

- The prediction manifest pins the complete Chemist Actions audit and each coordinate-bearing
  pocket-freeze action by its original audit sequence.
- The public replay is rebuilt from that audit. Its compact action array retains `auditSequence`,
  so a checkpoint resolves the original freeze record without treating an array index as an audit
  sequence. Promotion requests `stateHashGuards: "required"`: every included pose-refinement,
  pose-application, and optimization record must supply complete
  `molarium.molecular-state-hash/v1` input/selected/output guards. A scientifically useful pre-guard
  run may remain in the evidence directory, but cannot become the public replay.
- The checkpoint review pins its provenance and generated-asset manifest. Every displayed
  prospective ligand and Phe890 coordinate is read from disk and compared with the corresponding
  accepted checkpoint; re-hashing a stale scene therefore cannot promote it.
- Registration is checked against the fixed production files (`app.js`, the structure-viewer
  registry, the web bundle list, the local manifest list, and `server.js`). The SOS1 registry entry
  must bind the declared path and file hash, and retired v7 identifiers are rejected.

The focused test includes adversarial cases for missing state guards, a re-hashed coordinate change,
a freeze-sequence mismatch, a declaration that points at a decoy integration file, and a legacy
asset reference.
