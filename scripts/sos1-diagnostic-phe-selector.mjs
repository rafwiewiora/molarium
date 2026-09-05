import { selectSidechainRotamerCandidate, SIDECHAIN_ROTAMER_ENUMERATOR_METHOD,
  SIDECHAIN_ROTAMER_SCHEMA } from '../docking/sidechain-rotamers.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../design-history/integrity.mjs';

export const DIAGNOSTIC_PHE890_SEED_CHI_TOLERANCE_DEGREES = 0.001;
export const DIAGNOSTIC_PHE890_ENUMERATOR = Object.freeze({
  method:SIDECHAIN_ROTAMER_ENUMERATOR_METHOD, schema:SIDECHAIN_ROTAMER_SCHEMA,
});

function normalizeDegrees(value) {
  let normalized = Number(value) % 360;
  if (normalized <= -180) normalized += 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

export function parseDiagnosticPhe890SeedChiDegrees(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim())
    throw new Error('--diagnostic-phe890-seed-chi-degrees requires two comma-separated angles');
  const values = value.split(',').map((entry) => Number(entry.trim()));
  if (values.length !== 2 || values.some((entry) => !Number.isFinite(entry)))
    throw new Error('--diagnostic-phe890-seed-chi-degrees requires exactly two finite comma-separated angles');
  return values.map(normalizeDegrees);
}

export function resolveDiagnosticPhe890Candidate(ensemble, {
  coordinateSha256 = null, seedChiDegrees = null,
} = {}) {
  if (coordinateSha256 != null && seedChiDegrees != null)
    throw new Error('Specify only one diagnostic Phe890 selector');
  if (coordinateSha256 == null && seedChiDegrees == null) return null;
  const selected = selectSidechainRotamerCandidate(ensemble, coordinateSha256 != null
    ? { coordinateSha256 } : { chiDegrees:seedChiDegrees });
  if (seedChiDegrees != null && selected.source !== 'canonical-library')
    throw new Error('The diagnostic seed-chi selector did not resolve to the canonical library');
  return selected;
}

export function diagnosticPhe890SeedChiIdentity(ensemble, seedChiDegrees) {
  if (ensemble?.schema !== DIAGNOSTIC_PHE890_ENUMERATOR.schema
    || ensemble?.method !== DIAGNOSTIC_PHE890_ENUMERATOR.method
    || ensemble?.residue?.residueName !== 'PHE'
    || ensemble.residue.chain !== 'A' || ensemble.residue.residueIndex !== 890
    || (ensemble.residue.insertionCode || '') !== ''
    || !Array.isArray(ensemble.axes) || ensemble.axes.length !== 2
    || canonicalJson(ensemble.axes.map((axis) => ({ chi:axis.chi,
      atomNames:axis.atomNames }))) !== canonicalJson([
      { chi:'chi1', atomNames:['N','CA','CB','CG'] },
      { chi:'chi2', atomNames:['CA','CB','CG','CD1'] },
    ]))
    throw new Error('The current public enumeration lacks the registered Phe890 torsion identity');
  const normalized = parseDiagnosticPhe890SeedChiDegrees(seedChiDegrees.join(','));
  const record = {
    schema:'molarium.sidechain-rotamer-identity/v1',
    residue:{ residueName:'PHE', chain:ensemble.residue.chain,
      residueIndex:ensemble.residue.residueIndex,
      insertionCode:ensemble.residue.insertionCode || '' },
    enumerator:DIAGNOSTIC_PHE890_ENUMERATOR,
    source:'canonical-library',
    axes:ensemble.axes.map((axis) => ({ chi:axis.chi,
      atomNames:[...axis.atomNames], selectionPeriodDegrees:360 })),
    chiDegrees:normalized,
    toleranceDegrees:DIAGNOSTIC_PHE890_SEED_CHI_TOLERANCE_DEGREES,
    matching:'unique normalized periodic match; no nearest-angle or rank fallback',
  };
  return { ...record, canonicalJsonSha256:createHash('sha256')
    .update(canonicalJson(record)).digest('hex') };
}

export function diagnosticPhe890ProtocolFields({ coordinateSha256 = null,
  seedChiDegrees = null, resolved = null } = {}) {
  const diagnosticOnly = coordinateSha256 != null || seedChiDegrees != null;
  if (!diagnosticOnly) return {
    diagnosticExactCoordinateSha256:null, diagnosticSeedChiDegrees:null,
    diagnosticSeedChiIdentity:null, diagnosticSelectedCoordinateSha256:null,
    diagnosticInputCoordinateSha256:null, diagnosticOnly:false,
  };
  if (!resolved || !/^[a-f0-9]{64}$/.test(resolved.inputCoordinateSha256 || '')
    || !/^[a-f0-9]{64}$/.test(resolved.selectedCoordinateSha256 || ''))
    throw new Error('Diagnostic Phe890 manifest lacks the resolved same-enumeration coordinate hashes');
  if (seedChiDegrees != null && resolved.semanticIdentity?.schema
    !== 'molarium.sidechain-rotamer-identity/v1')
    throw new Error('Diagnostic Phe890 manifest lacks its semantic seed-chi identity');
  return {
    diagnosticExactCoordinateSha256:coordinateSha256,
    diagnosticSeedChiDegrees:seedChiDegrees,
    diagnosticSeedChiIdentity:seedChiDegrees == null ? null : resolved.semanticIdentity,
    diagnosticSelectedCoordinateSha256:resolved.selectedCoordinateSha256,
    diagnosticInputCoordinateSha256:resolved.inputCoordinateSha256,
    diagnosticOnly:true,
  };
}
