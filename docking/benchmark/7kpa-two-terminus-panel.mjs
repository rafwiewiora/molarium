import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const panelRoot = path.dirname(fileURLToPath(import.meta.url));
export const panelManifestName = '7kpa-two-terminus-panel.v0.1.json';
export const allowedPanelOperations = new Set([
  'setBond', 'setAtom', 'addHydrogen', 'removeHydrogen', 'deleteAtom', 'deleteBond',
  'addAtom', 'createBond', 'finish',
]);
export const operationActions = Object.freeze({
  setBond:'chemistry.setBond', setAtom:'chemistry.setAtom',
  addHydrogen:'chemistry.addHydrogen', removeHydrogen:'chemistry.removeHydrogen',
  deleteAtom:'chemistry.deleteAtom', deleteBond:'chemistry.deleteBond',
  addAtom:'chemistry.addAtom', createBond:'chemistry.createBond', finish:'chemistry.finish',
});

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function deterministicHash(value) {
  return sha256(canonicalJson(value));
}

const volatileRemapKeys = new Set([
  'at', 'capturedAt', 'committedAt', 'committedEditId', 'originatingCommittedEditId',
]);

function stableContactRemap(value) {
  if (Array.isArray(value)) return value.map(stableContactRemap);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !volatileRemapKeys.has(key))
    .map(([key, entry]) => [key, stableContactRemap(entry)]));
}

export async function readPanelManifest(name = panelManifestName) {
  const bytes = await readFile(path.isAbsolute(name) ? name : path.join(panelRoot, name));
  return { bytes, manifest:JSON.parse(bytes) };
}

function parseCcdGraph(text) {
  const atoms = new Map();
  const bonds = new Map();
  const atomLines = text.match(/(?:^|\n)D84\s+\S+\s+\S+\s+[A-Z][a-z]?\s+[-+]?\d+.*$/gm) || [];
  for (const line of atomLines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 17) continue;
    atoms.set(fields[1], { element:fields[3], formalCharge:Number(fields[4]) || 0,
      aromatic:fields[6] === 'Y' });
  }
  const order = { SING:1, DOUB:2, TRIP:3, AROM:1.5 };
  const bondLines = text.match(/(?:^|\n)D84\s+\S+\s+\S+\s+(?:SING|DOUB|TRIP|AROM)\s+[YN]\s+[A-Z?]\s+\d+\s*$/gm) || [];
  for (const line of bondLines) {
    const fields = line.trim().split(/\s+/);
    const names = [fields[1], fields[2]].sort();
    bonds.set(names.join('|'), order[fields[3]]);
  }
  return { atoms, bonds };
}

function simulateOperations(entry, referenceGraph) {
  const atoms = new Map([...referenceGraph.atoms].map(([key, value]) => [key, { ...value }]));
  const bonds = new Map(referenceGraph.bonds);
  let mutationsSinceFinish = 0;
  let syntheticHydrogen = 0;
  const aliases = new Map();
  const resolvedName = (name) => aliases.get(name) || name;
  const attachedHydrogens = (atomName) => [...atoms].filter(([name, atom]) => atom.element === 'H'
    && bonds.has([name, atomName].sort().join('|'))).map(([name]) => name);
  const addHydrogen = (atomName) => {
    let name;
    do { name = `__H${++syntheticHydrogen}_${atomName}`; } while (atoms.has(name));
    atoms.set(name, { element:'H', formalCharge:0, aromatic:false });
    bonds.set([name, atomName].sort().join('|'), 1);
  };
  const deleteAtom = (atomName) => {
    atoms.delete(atomName);
    for (const key of [...bonds.keys()]) if (key.split('|').includes(atomName)) bonds.delete(key);
  };
  const targetValence = (atom, heavyValence) => {
    const charge = atom.formalCharge || 0;
    if (atom.element === 'H') return 1;
    if (atom.element === 'C') return charge ? 3 : 4;
    if (atom.element === 'N') return charge > 0 ? 4 : charge < 0 ? 2 : 3;
    if (atom.element === 'O') return charge > 0 ? 3 : charge < 0 ? 1 : 2;
    if (atom.element === 'S') return heavyValence > 4 ? 6 : heavyValence > 2 ? 4
      : charge < 0 ? 1 : 2;
    if (['F','Cl','Br','I'].includes(atom.element)) return charge > 0 ? 2 : 1;
    return null;
  };
  const reconcileHydrogens = () => {
    for (const [name, atom] of [...atoms]) {
      if (atom.element === 'H' || (atom.aromatic && atom.element !== 'C')) continue;
      const heavyValence = [...bonds].reduce((sum, [key, order]) => {
        const names = key.split('|');
        if (!names.includes(name)) return sum;
        const other = names[0] === name ? names[1] : names[0];
        return atoms.get(other)?.element === 'H' ? sum : sum + Number(order);
      }, 0);
      const target = targetValence(atom, heavyValence);
      if (target == null || heavyValence > target + 0.05) continue;
      const desired = Math.max(0, Math.round(target - heavyValence));
      let hydrogens = attachedHydrogens(name);
      while (hydrogens.length > desired) {
        deleteAtom(hydrogens.at(-1)); hydrogens = attachedHydrogens(name);
      }
      while (hydrogens.length < desired) { addHydrogen(name); hydrogens = attachedHydrogens(name); }
    }
  };
  for (const [index, operation] of entry.operations.entries()) {
    assert.ok(allowedPanelOperations.has(operation.op), `${entry.id}: unknown operation ${operation.op}`);
    if (operation.op === 'finish') {
      assert.ok(mutationsSinceFinish > 0, `${entry.id}: empty or consecutive finish at operation ${index + 1}`);
      reconcileHydrogens();
      mutationsSinceFinish = 0;
      continue;
    }
    mutationsSinceFinish += 1;
    if (operation.op === 'setBond') {
      assert.ok(Array.isArray(operation.atoms) && operation.atoms.length === 2,
        `${entry.id}: setBond requires two atom names`);
      const names = operation.atoms.map(resolvedName);
      names.forEach((name) => assert.ok(atoms.has(name), `${entry.id}: unknown atom ${name}`));
      const key = [...names].sort().join('|');
      assert.ok(bonds.has(key), `${entry.id}: ${operation.atoms.join('-')} is not an existing bond`);
      assert.ok([1,1.5,2,3].includes(operation.order), `${entry.id}: invalid bond order`);
      bonds.set(key, operation.order);
      continue;
    }
    if (operation.op === 'deleteBond' || operation.op === 'createBond') {
      assert.ok(Array.isArray(operation.atoms) && operation.atoms.length === 2,
        `${entry.id}: ${operation.op} requires two atom names`);
      const names = operation.atoms.map(resolvedName);
      names.forEach((name) => assert.ok(atoms.has(name), `${entry.id}: unknown atom ${name}`));
      const key = [...names].sort().join('|');
      if (operation.op === 'deleteBond') {
        assert.ok(bonds.has(key), `${entry.id}: ${operation.atoms.join('-')} is not an existing bond`);
        bonds.delete(key);
      } else {
        assert.ok(!bonds.has(key), `${entry.id}: ${operation.atoms.join('-')} is already bonded`);
        assert.ok([1,1.5,2,3].includes(operation.order), `${entry.id}: invalid bond order`);
        bonds.set(key, operation.order);
      }
      continue;
    }
    if (operation.op === 'addAtom') {
      assert.match(operation.as, /^[A-Za-z][A-Za-z0-9_-]*$/,
        `${entry.id}: addAtom requires a stable alias`);
      assert.ok(!aliases.has(operation.as) && !atoms.has(operation.as),
        `${entry.id}: duplicate atom alias ${operation.as}`);
      const attachedTo = resolvedName(operation.attachedTo);
      assert.ok(atoms.has(attachedTo), `${entry.id}: unknown attachment atom ${operation.attachedTo}`);
      assert.match(operation.element, /^(?:C|N|O|S|P|F|Cl|Br|I)$/,
        `${entry.id}: unsupported added element`);
      aliases.set(operation.as, operation.as);
      atoms.set(operation.as, { element:operation.element, formalCharge:0, aromatic:false });
      bonds.set([operation.as, attachedTo].sort().join('|'), 1);
      continue;
    }
    assert.equal(typeof operation.atom, 'string', `${entry.id}: ${operation.op} requires atom`);
    const operationAtom = resolvedName(operation.atom);
    assert.ok(atoms.has(operationAtom), `${entry.id}: unknown atom ${operation.atom}`);
    if (operation.op === 'setAtom') {
      assert.match(operation.element, /^(?:C|N|O|S)$/,
        `${entry.id}: panel atom replacements are limited to C/N/O/S`);
      assert.ok(Number.isInteger(operation.formalCharge) && Math.abs(operation.formalCharge) <= 2,
        `${entry.id}: invalid formal charge`);
      atoms.get(operationAtom).element = operation.element;
      atoms.get(operationAtom).formalCharge = operation.formalCharge;
      atoms.get(operationAtom).aromatic = false;
    } else if (operation.op === 'deleteAtom') {
      deleteAtom(operationAtom);
    } else if (operation.op === 'removeHydrogen') {
      const hydrogen = attachedHydrogens(operationAtom)[0];
      assert.ok(hydrogen, `${entry.id}: ${operation.atom} has no explicit hydrogen to remove`);
      deleteAtom(hydrogen);
    } else if (operation.op === 'addHydrogen') {
      addHydrogen(operationAtom);
    }
  }
  assert.equal(mutationsSinceFinish, 0, `${entry.id}: final mutation batch is not finished`);
  return { atoms, bonds };
}

function graphContractFromMaps(atoms, bonds) {
  return [...atoms].filter(([, atom]) => atom.element !== 'H').map(([name, atom]) => {
    const attached = [...bonds].flatMap(([key, order]) => {
      const names = key.split('|');
      if (!names.includes(name)) return [];
      const otherName = names[0] === name ? names[1] : names[0];
      const other = atoms.get(otherName);
      return other ? [{ name:otherName, element:other.element, order:Number(order) }] : [];
    });
    return { atomName:name, element:atom.element, formalCharge:atom.formalCharge || 0,
      hydrogenCount:attached.filter((entry) => entry.element === 'H').length,
      heavyBonds:attached.filter((entry) => entry.element !== 'H')
        .map(({ name:otherAtomName, order }) => ({ otherAtomName, order }))
        .sort((first, second) => first.otherAtomName.localeCompare(second.otherAtomName)
          || first.order - second.order) };
  }).sort((first, second) => first.atomName.localeCompare(second.atomName));
}

export function graphContractFromInspection(atoms, bonds) {
  const byId = new Map(atoms.map((atom) => [atom.atomId, atom]));
  const graphLabel = (atom) => atom?.atomName || (atom?.atomId ? `@${atom.atomId}` : null);
  const atomMap = new Map(atoms.map((atom) => [graphLabel(atom), {
    element:atom.element, formalCharge:atom.formalCharge || 0, aromatic:Boolean(atom.aromatic),
  }]).filter(([label]) => label));
  const bondMap = new Map();
  for (const bond of bonds) {
    const names = bond.atomIds.map((id) => graphLabel(byId.get(id)));
    if (names.some((name) => !name)) continue;
    bondMap.set(names.sort().join('|'), Number(bond.order));
  }
  return graphContractFromMaps(atomMap, bondMap);
}

export async function expectedProductGraph(entry, manifest) {
  const ccd = await readFile(path.join(panelRoot, manifest.reference.ccdFile), 'utf8');
  const simulated = simulateOperations(entry, parseCcdGraph(ccd));
  const contract = graphContractFromMaps(simulated.atoms, simulated.bonds);
  return { contract, sha256:deterministicHash(contract) };
}

export async function validatePanelManifest(manifest, { verifyAssets = true } = {}) {
  assert.equal(manifest.schemaVersion, 1);
  const highDisruption = manifest.profile === 'high-disruption-enumerations';
  assert.equal(manifest.panelId, highDisruption
    ? 'molarium-7kpa-d84-high-disruption-enumerations'
    : 'molarium-7kpa-d84-two-terminus-analogues');
  assert.equal(manifest.status, 'preregistered-development');
  assert.equal(manifest.reference.pdbId, '7KPA');
  assert.equal(manifest.reference.componentId, 'D84');
  assert.equal(manifest.reference.chain, 'C');
  assert.equal(manifest.reference.residueNumber, 201);
  assert.equal(manifest.reference.waterPolicy, 'retain');
  assert.ok([8,16,32,64].includes(manifest.protocol.searchChains));
  assert.ok(Number.isInteger(manifest.protocol.replays) && manifest.protocol.replays >= 2);
  assert.ok(manifest.protocol.requiredMeasurements.includes('replay-hash'));
  assert.ok(Array.isArray(manifest.cases)
    && manifest.cases.length >= (highDisruption ? 3 : 16));
  assert.equal(new Set(manifest.cases.map((entry) => entry.id)).size, manifest.cases.length,
    'panel case IDs must be unique');
  const contactKeys = new Set(Object.keys(manifest.referenceContacts));
  const locus = new Set(['pyridone','pyrrolidone','dual','linker-pyrrolidone']);
  let referenceGraph = { atoms:new Map(), bonds:new Map() };
  if (verifyAssets) {
    const pdbBytes = await readFile(path.join(panelRoot, manifest.reference.coordinateFile));
    const ccdBytes = await readFile(path.join(panelRoot, manifest.reference.ccdFile));
    assert.equal(sha256(pdbBytes), manifest.reference.coordinateSha256,
      '7KPA coordinate fixture hash changed');
    assert.equal(sha256(ccdBytes), manifest.reference.ccdSha256, 'D84 CCD fixture hash changed');
    referenceGraph = parseCcdGraph(ccdBytes.toString('utf8'));
    assert.ok(referenceGraph.atoms.size >= 67, 'D84 CCD atom graph was not parsed');
    assert.ok(referenceGraph.bonds.size >= 72, 'D84 CCD bond graph was not parsed');
  }
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(locus.has(entry.locus), `${entry.id}: unknown locus`);
    assert.ok(entry.name && Array.isArray(entry.intendedRoles));
    assert.ok(entry.intendedRoles.every((role) => ['acceptor','donor'].includes(role)));
    assert.ok(Array.isArray(entry.operations) && Array.isArray(entry.risks));
    assert.ok(Array.isArray(entry.requiredContacts) && Array.isArray(entry.omittedContacts));
    const required = new Set(entry.requiredContacts), omitted = new Set(entry.omittedContacts);
    assert.equal(required.size, entry.requiredContacts.length, `${entry.id}: duplicate required contact`);
    assert.equal(omitted.size, entry.omittedContacts.length, `${entry.id}: duplicate omitted contact`);
    assert.ok([...required, ...omitted].every((key) => contactKeys.has(key)),
      `${entry.id}: unknown contact policy key`);
    assert.equal([...required].filter((key) => omitted.has(key)).length, 0,
      `${entry.id}: required and omitted contacts overlap`);
    assert.equal(required.size + omitted.size, contactKeys.size,
      `${entry.id}: every captured reference contact must be required or omitted`);
    if (entry.operations.length) {
      assert.notEqual(entry.operations[0].op, 'finish', `${entry.id}: script cannot start with finish`);
      assert.equal(entry.operations.at(-1).op, 'finish',
        `${entry.id}: every final mutation batch must finish chemistry`);
      entry.operations.forEach((operation, index) => {
        if (operation.op === 'finish') assert.notEqual(entry.operations[index - 1]?.op, 'finish',
          `${entry.id}: script cannot contain consecutive finishes`);
      });
    }
    if (verifyAssets) {
      const simulated = simulateOperations(entry, referenceGraph);
      const expected = graphContractFromMaps(simulated.atoms, simulated.bonds);
      assert.match(entry.expectedProductGraphSha256, /^[a-f0-9]{64}$/,
        `${entry.id}: expected product graph hash is missing`);
      assert.equal(entry.expectedProductGraphSha256, deterministicHash(expected),
        `${entry.id}: preregistered product graph contract does not match its operation script`);
    }
  }
  if (!highDisruption) for (const site of ['pyridone','pyrrolidone']) {
    const cases = manifest.cases.filter((entry) => entry.locus === site);
    assert.ok(cases.some((entry) => entry.intendedRoles.includes('acceptor')
      && !entry.intendedRoles.includes('donor')), `${site}: acceptor-only case is required`);
    assert.ok(cases.some((entry) => entry.intendedRoles.includes('acceptor')
      && entry.intendedRoles.includes('donor')), `${site}: donor-acceptor case is required`);
  }
  if (!highDisruption) assert.ok(manifest.cases.filter((entry) => entry.locus === 'dual').length >= 2,
    'at least two dual-end stress cases are required');
  const locusNames = highDisruption
    ? [...new Set(manifest.cases.map((entry) => entry.locus))].sort()
    : ['pyridone','pyrrolidone','dual'];
  return { cases:manifest.cases.length, loci:Object.fromEntries(locusNames
    .map((name) => [name, manifest.cases.filter((entry) => entry.locus === name).length])) };
}

export function stableReplayPayload(record) {
  const refinement = record.refinement ? { ...record.refinement } : null;
  if (refinement) delete refinement.runtimeMs;
  const chemistry = record.chemistry ? {
    commits:(record.chemistry.commits || []).map((commit) => ({
      validation:commit.validation || null,
      polish:commit.polish ? { cleanupMode:commit.polish.cleanupMode || null,
        initialEnergy:commit.polish.initialEnergy ?? null,
        finalEnergy:commit.polish.finalEnergy ?? null } : null,
      contactFeatureRemaps:stableContactRemap(commit.contactFeatureRemaps || []),
    })),
    moleculeValidation:record.chemistry.moleculeValidation || null,
    atoms:record.chemistry.atoms || [], bonds:record.chemistry.bonds || [],
    error:record.chemistry.error || null,
  } : null;
  return {
    caseId:record.caseId,
    caseInputSha256:record.caseInputSha256,
    terminalOutcome:record.terminalOutcome,
    actions:record.actions?.map((entry) => ({ action:entry.action, args:entry.args,
      status:entry.status, error:entry.error || null })) || [],
    chemistry,
    contactMapping:record.contactMapping || null,
    refinement,
    appliedPose:record.appliedPose || null,
    candidateExportIntegrity:record.candidateExportIntegrity
      ? record.candidateExportIntegrity.map(({ id:ignoredId, ...entry }) => entry) : null,
    referenceGraphSha256:record.referenceGraphSha256 || null,
    productGraphSha256:record.productGraphSha256 || null,
    expectedProductGraphSha256:record.expectedProductGraphSha256 || null,
    productGraphMatchesExpected:Boolean(record.productGraphMatchesExpected),
    editDifficulty:record.editDifficulty || null,
    enumerationPoseScreen:record.enumerationPoseScreen || null,
    labbookAudit:record.labbookAudit ? { protocolSha256:record.labbookAudit.protocolSha256,
      eventCount:record.labbookAudit.eventCount, valid:record.labbookAudit.valid,
      reason:record.labbookAudit.reason || null } : null,
  };
}

export function validatePanelResults(results, manifest, { requireComplete = false } = {}) {
  assert.equal(results.schemaVersion, 1);
  assert.equal(results.panelId, manifest.panelId);
  assert.equal(results.panelVersion, manifest.version);
  assert.equal(results.manifestSha256, deterministicHash(manifest));
  assert.ok(Array.isArray(results.cases));
  const registered = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  assert.equal(new Set(results.cases.map((entry) => entry.caseId)).size, results.cases.length,
    'result case IDs must be unique');
  if (requireComplete) assert.equal(results.cases.length, manifest.cases.length);
  for (const record of results.cases) {
    const entry = registered.get(record.caseId);
    assert.ok(entry, `${record.caseId}: result is not registered`);
    assert.equal(record.caseInputSha256, deterministicHash(entry));
    assert.ok(Array.isArray(record.replays) && record.replays.length >= 1);
    for (const replay of record.replays) {
      assert.equal(replay.caseId, entry.id);
      assert.equal(replay.caseInputSha256, record.caseInputSha256);
      assert.equal(replay.deterministicSha256, deterministicHash(stableReplayPayload(replay)),
        `${entry.id}: replay hash does not match payload`);
      assert.match(replay.referenceGraphSha256, /^[a-f0-9]{64}$/,
        `${entry.id}: prepared reference graph hash is missing`);
      assert.match(replay.productGraphSha256, /^[a-f0-9]{64}$/,
        `${entry.id}: product graph hash is missing`);
      assert.equal(replay.expectedProductGraphSha256, entry.expectedProductGraphSha256,
        `${entry.id}: result does not carry the preregistered product identity`);
      if (!['chemistry-invalid','runtime-failure'].includes(replay.terminalOutcome))
        assert.equal(replay.productGraphMatchesExpected, true,
          `${entry.id}: finished chemistry differs from preregistered product graph`);
      if (replay.labbookAudit) {
        assert.equal(replay.labbookAudit.valid, true, `${entry.id}: labbook verification failed`);
        assert.match(replay.labbookAudit.labbookSha256, /^[a-f0-9]{64}$/,
          `${entry.id}: completed labbook hash is missing`);
      }
      assert.ok(Number.isFinite(replay.runtime?.totalMs) && replay.runtime.totalMs >= 0);
      assert.ok(replay.actions.every((action) => Object.values(operationActions).includes(action.action)
        || ['view.setMode','build.setTool','selection.replace','pose.captureReference',
          'pose.setContact','pose.refine','pose.apply','session.inspect'].includes(action.action)),
      `${entry.id}: replay used a route outside public Chemist Actions`);
      if (replay.refinement) {
        assert.equal(typeof replay.refinement.selectedFeasible, 'boolean');
        assert.ok(Number.isFinite(replay.refinement.selectedPhysicalKcalMol));
        assert.ok(Number.isFinite(replay.refinement.selectedConstraintPenaltyKcalMol));
        assert.ok(Number.isFinite(replay.refinement.selectedPhysicalComponents?.ligandStrainKcalMol));
        assert.ok(Number.isFinite(replay.refinement.selectedPhysicalComponents?.lennardJonesKcalMol));
        assert.ok(Number.isInteger(replay.refinement.selectedPhysicalComponents?.stericClashes));
        assert.ok(Array.isArray(replay.refinement.selectedHydrogenBonds));
      }
      if (manifest.profile === 'high-disruption-enumerations' && replay.refinement) {
        assert.equal(replay.editDifficulty?.schema, 'molarium.edit-difficulty/v1');
        assert.ok(Number.isFinite(replay.editDifficulty.score)
          && replay.editDifficulty.score >= 0 && replay.editDifficulty.score <= 100);
        assert.equal(replay.enumerationPoseScreen?.schema,
          'molarium.enumeration-pose-screen/v1');
        assert.ok(['contact-infeasible','contact-feasible-review-required',
          'development-screen-pass'].includes(replay.enumerationPoseScreen.verdict));
      }
    }
    const hashes = new Set(record.replays.map((replay) => replay.deterministicSha256));
    assert.equal(record.replayAgreement, hashes.size === 1,
      `${entry.id}: replay-agreement flag is inconsistent`);
  }
  assert.equal(results.resultsSha256, deterministicHash(results.cases));
  const repeated = results.cases.filter((entry) => entry.replays.length >= 2);
  return { cases:results.cases.length,
    agreeing:results.cases.filter((entry) => entry.replayAgreement).length,
    repeatedCases:repeated.length,
    repeatedAgreeing:repeated.filter((entry) => entry.replayAgreement).length };
}
