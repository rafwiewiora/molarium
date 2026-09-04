#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const SCHEMA = 'molarium.sos1-aww-designer-contact-factorial/v2';
const AWZ_CAMPAIGN_SHA256 =
  'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81';
const AWW_COMPONENT_ID = 'heterogen:A:1104::AWW';
const REQUIRED_HARD_ATOM_NAMES = Object.freeze(['C12']);
const REQUIRED_RELEASED_ATOM_NAMES = Object.freeze(['C15','CX4','CX5']);
const PHE_STATES = Object.freeze([
  Object.freeze({ id:'native', chiDegrees:null }),
  Object.freeze({ id:'plus60', chiDegrees:Object.freeze([60, 90]) }),
  Object.freeze({ id:'out', chiDegrees:Object.freeze([-180, -90]) }),
]);
const BRANCHES = Object.freeze(PHE_STATES.map((phe) =>
  Object.freeze({ id:`phe-${phe.id}`, phe })));

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function atom(inspection, residueName, residueIndex, atomName) {
  const matches = inspection.atoms.filter((entry) => entry.residueName === residueName
    && Number(entry.residueIndex) === residueIndex && entry.atomName === atomName);
  assert.equal(matches.length, 1,
    `${residueName} ${residueIndex}/${atomName} must occur exactly once in pocket inspection`);
  return matches[0];
}

function distance(first, second) {
  return Math.hypot(...first.coordinatesAngstrom.map((value, index) =>
    value - second.coordinatesAngstrom[index]));
}

function contactMatches(contact, ligandAtomName, receptorResidueName,
  receptorResidueIndex, receptorAtomName) {
  const participants = contact.hydrogenBond?.participants || {};
  const ligand = Object.values(participants).find((entry) =>
    entry?.scope === 'ligand' && entry.atomId?.includes(`::${ligandAtomName}:`));
  const receptor = Object.values(participants).find((entry) =>
    entry?.scope === 'receptor'
      && entry.atomId?.includes(`:${receptorResidueName}:${receptorResidueIndex}::${receptorAtomName}:`));
  return Boolean(ligand && receptor);
}

function selectedRequiredHydrogenBonds(refinement, requiredContactIds) {
  const selected = new Map((refinement.selectedHydrogenBonds || [])
    .map((entry) => [entry.id, entry]));
  return requiredContactIds.map((contactId) => selected.get(contactId) || {
    id:contactId, required:true, satisfied:false, missing:true,
  });
}

async function runBranch({ root, serializedCampaign, branch }) {
  const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
    width:1200, height:800 });
  const records = [];
  const execute = async (action, args = {}) => {
    const requestId = `aww-factorial-${branch.id}-${records.length + 1}-${action}`;
    const response = await browser.evaluate(
      `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);
    records.push({ requestId, action, status:response.status,
      durationMs:response.durationMs, result:response.result });
    assert.equal(response.status, 'completed', `${branch.id} ${action} failed`);
    return response.result;
  };
  try {
    await waitFor(async () => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'),
      90000, 'Molarium Chemist Actions API');
    await execute('campaign.import', { serialized:serializedCampaign });
    const verified = await execute('campaign.verify');
    assert.equal(verified.campaignVerification.valid, true);
    await execute('designRoute.resume', { routeId:'sos1-hit-only', stateId:'AWZ' });
    await execute('protein.parameterize');
    await execute('view.setMode', { mode:'build' });
    await execute('pose.captureReference', { mode:'propagate' });
    const staged = await execute('designRoute.applyStep', {
      stepId:'open-phe890-pocket',
    });
    assert.equal(staged.designStep.stateId, 'AWW');
    const stagedLigand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:false, maximumAtoms:256,
    });
    const rotamers = await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:{ residueName:'PHE', chain:'A', residueIndex:890,
        insertionCode:'' }, maximumCandidates:32,
    });
    let appliedRotamer = null;
    if (branch.phe.chiDegrees) {
      appliedRotamer = await execute('pose.applySidechainRotamer', {
        chiDegrees:[...branch.phe.chiDegrees],
      });
    }
    await execute('pose.updateReceptorReference');

    const beforeContacts = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:false, maximumAtoms:500,
    });
    const inheritedN7 = beforeContacts.contacts.find((contact) =>
      contactMatches(contact, 'N7', 'ASN', 879, 'OD1'));
    let n7Contact;
    if (inheritedN7?.available) {
      await execute('pose.setContact', { contactId:inheritedN7.contactId, required:true });
      n7Contact = { contactId:inheritedN7.contactId, source:'inherited-reference' };
    } else {
      const added = await execute('pose.addContact', {
        ligandAtom:{ componentId:AWW_COMPONENT_ID, atomName:'N7' },
        receptorAtom:{ residueName:'ASN', chain:'A', residueIndex:879,
          insertionCode:'', atomName:'OD1' },
        ligandRole:'donor',
      });
      n7Contact = { contactId:added.contact.contactId, source:'designer-added' };
    }
    const ox3 = await execute('pose.addContact', {
      ligandAtom:{ componentId:AWW_COMPONENT_ID, atomName:'OX3' },
      receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
        insertionCode:'', atomName:'O' },
      ligandRole:'donor',
    });
    const requiredContactIds = [n7Contact.contactId, ox3.contact.contactId];
    const refinementResult = await execute('pose.refine', {
      searchChains:8, execution:'serial', featureSeedingProtocol:'v5',
    });
    const refinement = refinementResult.refinement;
    const runtimeReleasedCoreAtomIndices = refinement.featureGuidedSeeding
      ?.releasedCoreAtomIndices || [];
    const runtimeReleasedCoreAtomNames = [...new Set(runtimeReleasedCoreAtomIndices
      .map((index) => stagedLigand.atoms[index]?.atomName).filter(Boolean))].sort();
    const registeredReleasedAtomNames = staged.designStep.poseTransferPlan
      ?.releasedMappedAtomNames || [];
    const requiredReleasedAtomsSatisfied = REQUIRED_RELEASED_ATOM_NAMES
      .every((atomName) => registeredReleasedAtomNames.includes(atomName))
      && REQUIRED_HARD_ATOM_NAMES.every((atomName) =>
        !registeredReleasedAtomNames.includes(atomName));
    const selectedContacts = selectedRequiredHydrogenBonds(refinement, requiredContactIds);
    const requiredContactsSatisfied = selectedContacts.every((contact) =>
      contact.required && contact.satisfied);
    const selectedSeedAudit = refinement.featureGuidedSeeding?.selectedSeedAudit || {};
    const selectedDonorContactIds = new Set(
      (selectedSeedAudit.donorHydrogenAlignments || [])
        .map((entry) => entry.constraintId));
    const donorHydrogensComposedWithHeavySeed = requiredContactIds.every((contactId) =>
      selectedDonorContactIds.has(contactId));
    const binaryEndpointSignatures = new Set(['0/0', '180/0', '0/180', '180/180']);
    const selectedBinaryEndpointSignatures = new Set((refinement.coverage?.strata || [])
      .filter((entry) => entry.kind === 'affected-existing-two-rotor-endpoint'
        && entry.required === true && entry.selectedSeedOrdinals?.length > 0)
      .map((entry) => entry.rotorAnglesDegrees?.join('/')));
    const coupledRotorCoverage = refinement.featureGuidedSeeding
      ?.affectedRotorCombinationCount === binaryEndpointSignatures.size
      && refinement.featureGuidedSeeding?.affectedRotorCombinationCandidateCount > 0
      && [...binaryEndpointSignatures].every((signature) =>
        selectedBinaryEndpointSignatures.has(signature));
    const endpointFeatureCoverage = refinement.coverage?.strata
      ?.filter((entry) => entry.kind === 'affected-existing-two-rotor-endpoint-feature'
        && entry.required === true)
      .every((entry) => entry.selectedSeedOrdinals?.length > 0)
      && refinement.coverage?.strata?.filter((entry) =>
        entry.kind === 'affected-existing-two-rotor-endpoint-feature').length >= 2;
    const prospectiveGates = {
      coverageComplete:refinement.coverageComplete === true,
      coupledRotorCoverage,
      endpointFeatureCoverage,
      donorHydrogensComposedWithHeavySeed,
      selectedFeasible:refinement.selectedFeasible === true,
      fixedCoreSatisfied:refinement.selectedCore?.satisfied === true,
      chemicalValidity:refinement.selectedChemicalValidity?.valid === true,
      requiredContactsSatisfied,
      requiredReleasedAtomsSatisfied,
    };
    const eligible = Object.values(prospectiveGates).every(Boolean);
    let pocket = null;
    let contactDistances = {
      ox3ToTyr884BackboneOAngstrom:selectedContacts.find((entry) =>
        entry.id === ox3.contact.contactId)?.donorAcceptorDistanceAngstrom ?? null,
      n7ToAsn879Od1Angstrom:selectedContacts.find((entry) =>
        entry.id === n7Contact.contactId)?.donorAcceptorDistanceAngstrom ?? null,
    };
    if (eligible) {
      await execute('pose.apply', { index:Math.max(0, refinement.selectedRank - 1) });
      pocket = await execute('session.inspect', {
        scope:'pocket', includeCoordinates:true, maximumAtoms:500,
      });
      const ox3Atom = atom(pocket, 'AWW', 1104, 'OX3');
      const tyrO = atom(pocket, 'TYR', 884, 'O');
      const n7Atom = atom(pocket, 'AWW', 1104, 'N7');
      const asnOd1 = atom(pocket, 'ASN', 879, 'OD1');
      contactDistances = {
        ox3ToTyr884BackboneOAngstrom:distance(ox3Atom, tyrO),
        n7ToAsn879Od1Angstrom:distance(n7Atom, asnOd1),
      };
    }
    return {
      schema:SCHEMA, branch:branch.id, pheState:branch.phe.id,
      holdoutCoordinatesUsed:false, sourceStateId:'AWZ', predictedStateId:'AWW',
      staged:{ commonHitHeavyAtoms:staged.designStep.commonHitHeavyAtoms,
        productHeavyAtoms:staged.designStep.productHeavyAtoms },
      sidechain:{ generatedCandidateCount:rotamers.sidechainRotamers.generatedCandidateCount,
        applied:appliedRotamer?.sidechainRotamer || appliedRotamer?.appliedSidechainRotamer || null },
      hydration:{ usedForPoseSelection:false,
        interpretation:'pose.refine scores protein ATOM records, not crystallographic waters; water mobility is evaluated only during later full-system induced-fit relaxation' },
      contacts:{ requiredContactIds, n7Source:n7Contact.source,
        selected:selectedContacts, ...contactDistances },
      hardCoreAudit:{ requiredHardAtomNames:[...REQUIRED_HARD_ATOM_NAMES],
        requiredReleasedAtomNames:[...REQUIRED_RELEASED_ATOM_NAMES],
        registeredReleasedAtomNames,
        runtimeReleasedCoreAtomIndices, runtimeReleasedCoreAtomNames,
        satisfied:requiredReleasedAtomsSatisfied },
      prospectiveGates, eligible, refinement, pocket, records,
    };
  } finally {
    await browser.close();
  }
}

async function main(args = process.argv.slice(2)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputArg = valueFor(args, '--output');
  if (!outputArg) throw new Error('Usage: bun scripts/sos1-aww-designer-contact-factorial.browser.mjs --output <new-directory> [--branch phe-native|phe-plus60|phe-out]');
  const branchArg = valueFor(args, '--branch');
  const branches = branchArg ? BRANCHES.filter((branch) => branch.id === branchArg) : BRANCHES;
  if (!branches.length) throw new Error(`Unknown factorial branch: ${branchArg}`);
  const output = resolve(process.cwd(), outputArg);
  try { await access(output); throw new Error(`Refusing to overwrite immutable attempt: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const campaignPath = resolve(root,
    'design-history/publications/sos1/checkpoints/fragment-merge-campaign.json');
  const campaignBytes = await readFile(campaignPath);
  assert.equal(sha256(campaignBytes), AWZ_CAMPAIGN_SHA256,
    'The frozen AWZ source campaign bytes changed');
  await mkdir(output, { recursive:false });
  const save = (name, value) => writeFile(resolve(output, name),
    `${JSON.stringify(value, null, 2)}\n`);
  await save('boundary.json', { schema:SCHEMA, status:'declared-before-compute',
    source:{ stateId:'AWZ', campaignPath,
      campaignSha256:AWZ_CAMPAIGN_SHA256 },
    branches:branches.map((branch) => ({ id:branch.id, pheState:branch.phe.id,
      chiDegrees:branch.phe.chiDegrees })), searchChains:8,
    designerIntent:[
      'AWW OX3 hydroxyl donor -> TYR A884 backbone O acceptor',
      'AWW N7 donor -> ASN A879 OD1 acceptor',
    ],
    selector:'prospective Molarium pose feasibility and energy ranking',
    holdoutCoordinatesUsed:false,
    holdoutPolicy:'5OVH may be opened only after selection; this proxy does not open it',
    hydrationPolicy:'water is outside pose.refine scoring; HOH1507 mobility and remaining overlap are evaluated by later full-system induced-fit relaxation of the prospective winner',
  });
  const results = [];
  for (const branch of branches) {
    const result = await runBranch({ root,
      serializedCampaign:campaignBytes.toString('utf8'), branch });
    results.push(result);
    await save(`${branch.id}.json`, result);
    console.log(`SOS1_AWW_FACTORIAL ${JSON.stringify({ branch:branch.id,
      eligible:result.eligible, prospectiveGates:result.prospectiveGates,
      selectedRank:result.refinement.selectedRank,
      selectedScoreKcalMol:result.refinement.selectedScoreKcalMol,
      selectedPhysicalKcalMol:result.refinement.selectedPhysicalKcalMol,
      coverage:result.refinement.coverage,
      selectedSeedAudit:result.refinement.featureGuidedSeeding?.selectedSeedAudit,
      contacts:result.contacts })}`);
  }
  const eligible = results.filter((result) => result.eligible);
  assert(eligible.length >= 1, 'At least one factorial branch must pass every prospective gate');
  eligible.sort((a, b) => a.refinement.selectedScoreKcalMol
    - b.refinement.selectedScoreKcalMol || a.branch.localeCompare(b.branch));
  const summary = { schema:SCHEMA, status:'completed', holdoutCoordinatesUsed:false,
    selectedBranch:eligible[0].branch,
    selectedPheState:eligible[0].pheState,
    hydrationUsedForPoseSelection:false,
    selectionBasis:'lowest prospective selectedScoreKcalMol among the three Phe890 states after identical feasibility gates; crystallographic water is evaluated later in full-system relaxation',
    branches:results.map((result) => ({ branch:result.branch,
      pheState:result.pheState,
      eligible:result.eligible, prospectiveGates:result.prospectiveGates,
      selectedScoreKcalMol:result.refinement.selectedScoreKcalMol,
      selectedPhysicalKcalMol:result.refinement.selectedPhysicalKcalMol,
      selectedSeedAudit:result.refinement.featureGuidedSeeding?.selectedSeedAudit,
      contacts:result.contacts })) };
  await save('result.json', summary);
  console.log(`SOS1_AWW_FACTORIAL_RESULT ${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
