import { readPanelManifest } from '../docking/benchmark/7kpa-two-terminus-panel.mjs';
import { readEnumerationCatalogue } from './catalogue.mjs';

export async function buildHighDisruptionPanelManifest() {
  const [{ manifest:baseline }, { catalogue }] = await Promise.all([
    readPanelManifest(), readEnumerationCatalogue(),
  ]);
  const contactKeys = Object.keys(baseline.referenceContacts);
  const cases = catalogue.transformations.map((entry) => ({
    id:entry.id,
    locus:entry.id.startsWith('phenyl-') ? 'linker-pyrrolidone' : 'pyrrolidone',
    name:entry.name,
    intendedRoles:['acceptor'],
    operations:entry.operations,
    requiredContacts:entry.requiredContactKeys,
    omittedContacts:contactKeys.filter((key) => !entry.requiredContactKeys.includes(key)),
    expectedProductGraphSha256:entry.expectedProductGraphSha256,
    risks:entry.risks,
    enumeration:{ family:entry.family, hypothesis:entry.hypothesis },
  }));
  return {
    schemaVersion:1,
    panelId:'molarium-7kpa-d84-high-disruption-enumerations',
    version:catalogue.version,
    status:'preregistered-development',
    profile:'high-disruption-enumerations',
    purpose:catalogue.reference.purpose,
    reference:baseline.reference,
    referenceContacts:baseline.referenceContacts,
    protocol:{
      id:'7kpa-high-disruption-public-chemist-actions', version:catalogue.version,
      searchChains:8, replays:2,
      determinism:'Each transformation is expanded only through the public, audited Chemist Actions API.',
      requiredMeasurements:[...baseline.protocol.requiredMeasurements,
        'edit-difficulty-components'],
    },
    cases,
  };
}
