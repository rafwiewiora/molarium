import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const curation = JSON.parse(await readFile(path.join(root, 'curation.v0.1.json')));
const fixtureBytes = await readFile(path.join(root, 'fixture-validation.v0.1.json'));
const fixtures = JSON.parse(fixtureBytes);
const scan = JSON.parse(await readFile(path.join(root, 'interaction-scan.v0.1.json')));

assert.equal(scan.datasetId, curation.datasetId);
assert.equal(scan.fixtureValidationSha256, sha256(fixtureBytes));
assert.equal(scan.scans.filter((entry) => entry.error).length, 0);

const fixtureByCase = new Map(fixtures.cases.map((entry) => [entry.caseId, entry]));
const scanByCase = new Map(scan.scans.flatMap((entry) =>
  entry.caseIds.map((caseId) => [caseId, entry])));
const audit = [];

for (const entry of curation.cases) {
  const contactScan = scanByCase.get(entry.id);
  const fixture = fixtureByCase.get(entry.id);
  assert.ok(contactScan && fixture, `${entry.id}: interaction or fixture record is absent`);
  const selection = fixture.reference.selection;
  const componentId = fixture.reference.componentId;
  const isLigand = (atom) => atom.residueName === componentId
    && atom.chain === selection.chain && atom.residueNumber === selection.residueNumber
    && atom.insertionCode === selection.insertionCode;
  const contactFeatures = contactScan.ligandHydrogenBonds.flatMap((contact) => [
    ...(isLigand(contact.donor) ? [{ atomName:contact.donor.atomName, role:'donor', contact }] : []),
    ...(isLigand(contact.acceptor) ? [{ atomName:contact.acceptor.atomName, role:'acceptor', contact }] : []),
  ]);
  const ligandLabelPrefix = `${componentId} ${selection.chain}${selection.residueNumber}${selection.insertionCode}`;
  for (const captured of contactScan.capturedHydrogenBonds) {
    const [donorLabel, acceptorLabel] = captured.label.split(' → ');
    for (const [label, role] of [[donorLabel, 'donor'], [acceptorLabel, 'acceptor']]) {
      if (!label?.startsWith(`${ligandLabelPrefix} `)) continue;
      const atomName = label.slice(ligandLabelPrefix.length + 1);
      if (!contactFeatures.some((feature) => feature.atomName === atomName && feature.role === role))
        contactFeatures.push({ atomName, role, contact:null, capturedLabel:captured.label });
    }
  }

  if (entry.tier !== 'paired-crystal') {
    assert.equal(contactScan.preparationBlockers.length, 0,
      `${entry.id}: prospective/negative reference has preparation blockers`);
    assert.ok(contactScan.capturedHydrogenBonds.length,
      `${entry.id}: prospective/negative reference has no captured H-bond`);
    const requested = entry.transformation.referenceFeatureAtomNames;
    const matched = contactFeatures.filter(({ atomName }) => requested.includes(atomName));
    for (const atomName of requested)
      assert.ok(matched.some((feature) => feature.atomName === atomName),
        `${entry.id}: pre-registered feature ${atomName} is not an observed ligand H-bond participant`);
    if (entry.tier === 'prospective' && entry.transformation.intendedRole.startsWith('acceptor'))
      assert.ok(matched.some(({ role }) => role === 'acceptor'),
        `${entry.id}: intended acceptor transfer is not an observed acceptor contact`);
    if (entry.tier === 'prospective' && entry.transformation.intendedRole.startsWith('donor'))
      assert.ok(matched.some(({ role }) => role === 'donor'),
        `${entry.id}: intended donor transfer is not an observed donor contact`);
    audit.push({ caseId:entry.id, requestedFeatureAtomNames:requested,
      matchedFeatures:matched.map(({ atomName, role, contact, capturedLabel }) => ({ atomName, role,
        receptorAtom:contact ? (role === 'donor' ? contact.acceptor : contact.donor) : null,
        hydrogenAcceptorDistance:contact?.hydrogenAcceptorDistance ?? null,
        donorHydrogenAcceptorCosine:contact?.donorHydrogenAcceptorCosine ?? null,
        capturedLabel:capturedLabel || null })) });
  }
}

const prospectives = curation.cases.filter((entry) => entry.tier === 'prospective');
const negatives = curation.cases.filter((entry) => entry.tier === 'adversarial-negative');
assert.equal(audit.length, prospectives.length + negatives.length);
assert.ok(prospectives.filter((entry) => entry.transformation.intendedRole.startsWith('acceptor')).length >= 6);
assert.ok(prospectives.filter((entry) => entry.transformation.intendedRole.startsWith('donor')).length >= 3);

console.log(`Bioisostere interaction hypotheses: PASS (${prospectives.length} prospective, ${negatives.length} adversarial; every proposed feature observed before product evaluation)`);
