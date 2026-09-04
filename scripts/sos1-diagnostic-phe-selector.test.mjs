import assert from 'node:assert/strict';
import { diagnosticPhe890ProtocolFields, diagnosticPhe890SeedChiIdentity,
  parseDiagnosticPhe890SeedChiDegrees,
  resolveDiagnosticPhe890Candidate } from './sos1-diagnostic-phe-selector.mjs';

const candidate = (index, chiDegrees, coordinateSha256) => ({
  index, rank:index + 1, chiDegrees, coordinateSha256,
});
const digest = (character) => character.repeat(64);
const ensemble = {
  schema:'molarium.sidechain-rotamers/v1',
  method:'canonical-chi-grid-steric-prerank-v1',
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  axes:[{ chi:'chi1', atomNames:['N','CA','CB','CG'] },
    { chi:'chi2', atomNames:['CA','CB','CG','CD1'] }],
  candidates:[{ ...candidate(0, [-180, 90], digest('a')), source:'canonical-library' },
    { ...candidate(1, [-60, -90], digest('b')), source:'canonical-library' }],
};

assert.deepEqual(parseDiagnosticPhe890SeedChiDegrees('180,450'), [180,90]);
assert.equal(resolveDiagnosticPhe890Candidate(ensemble, {
  seedChiDegrees:[180,90],
}).coordinateSha256, digest('a'), 'periodic seed chi must resolve one current candidate');
assert.throws(() => resolveDiagnosticPhe890Candidate(ensemble, {
  seedChiDegrees:[60,90],
}), /No side-chain rotamer matches chiDegrees/);
assert.throws(() => resolveDiagnosticPhe890Candidate(ensemble, {
  seedChiDegrees:[180,-90],
}), /No side-chain rotamer matches chiDegrees/, '90 and -90 must remain distinct');
assert.throws(() => resolveDiagnosticPhe890Candidate({ ...ensemble,
  candidates:[...ensemble.candidates,
    { ...candidate(2, [180,90], digest('c')), source:'canonical-library' }] }, {
  seedChiDegrees:[180,90],
}), /ambiguously match/);
assert.throws(() => resolveDiagnosticPhe890Candidate(ensemble, {
  coordinateSha256:digest('a'), seedChiDegrees:[180,90],
}), /only one diagnostic Phe890 selector/);
assert.throws(() => parseDiagnosticPhe890SeedChiDegrees('180'), /exactly two finite/);

const identity = diagnosticPhe890SeedChiIdentity(ensemble, [180,90]);
const coordinateChanged = diagnosticPhe890SeedChiIdentity({ ...ensemble,
  inputCoordinateSha256:digest('d'), candidates:ensemble.candidates.map((entry) => ({ ...entry,
    coordinateSha256:digest('e') })) }, [180,90]);
assert.equal(identity.canonicalJsonSha256, coordinateChanged.canonicalJsonSha256,
  'semantic selector identity must not be coupled to unrelated coordinate hashes');
assert.deepEqual(identity.axes.map((axis) => axis.selectionPeriodDegrees), [360,360]);
assert.equal(identity.toleranceDegrees, 0.001);
assert.match(identity.canonicalJsonSha256, /^[a-f0-9]{64}$/);
const protocol = diagnosticPhe890ProtocolFields({ seedChiDegrees:[180,90],
  resolved:{ inputCoordinateSha256:digest('d'), selectedCoordinateSha256:digest('e'),
    semanticIdentity:identity } });
assert.equal(protocol.diagnosticOnly, true);
assert.equal(protocol.diagnosticInputCoordinateSha256, digest('d'));
assert.equal(protocol.diagnosticSelectedCoordinateSha256, digest('e'));
assert.throws(() => diagnosticPhe890ProtocolFields({ seedChiDegrees:[180,90],
  resolved:{ semanticIdentity:identity } }), /lacks the resolved same-enumeration/);
assert.throws(() => diagnosticPhe890SeedChiIdentity({ ...ensemble,
  residue:{ ...ensemble.residue, residueIndex:891 } }, [180,90]), /torsion identity/);
assert.throws(() => diagnosticPhe890SeedChiIdentity({ ...ensemble,
  axes:[ensemble.axes[1], ensemble.axes[0]] }, [180,90]), /torsion identity/);

console.log('SOS1 diagnostic Phe890 selectors are unique, periodic, and fail closed');
