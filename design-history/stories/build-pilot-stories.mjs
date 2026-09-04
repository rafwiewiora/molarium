import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCampaign, storeSnapshot, storeActionScript, appendEvent, commitMolecule,
  recordDecision, finalizeCampaign, verifyCampaign, campaignSummary } from '../ledger.mjs';
import { buildMovieManifest, verifyMovieManifest } from '../movie.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const output = path.join(here, 'generated');

function clock(occurredBase, recordedBase) {
  let ordinal = 0;
  return () => {
    const occurredAt = new Date(Date.parse(occurredBase) + ordinal * 1000).toISOString();
    const recordedAt = new Date(Date.parse(recordedBase) + ordinal * 1000).toISOString();
    ordinal += 1; return { occurredAt, recordedAt };
  };
}

async function addObservation(campaign, next, { actorId, branch = 'main', subjectIds = [],
  sourceIds = [], kind = 'observation.recorded', payload }) {
  return appendEvent(campaign, { ...next(), kind, actorId, branch, subjectIds, sourceIds, payload });
}

async function addCommit(campaign, next, { label, canonicalSmiles = null, externalRefs = [],
  properties = {}, parents = [], branch = 'main', message, actorId, sourceIds = [],
  actionScriptId = null, hypothesisIds = [], evidenceIds = [], tags = [] }) {
  const snapshotId = await storeSnapshot(campaign, { label, canonicalSmiles, externalRefs, properties });
  const commitId = await commitMolecule(campaign, { snapshotId, parents, branch, message, actorId,
    ...next(), sourceIds, actionScriptId, hypothesisIds, evidenceIds, tags });
  return { snapshotId, commitId };
}

async function decide(campaign, next, options) {
  return recordDecision(campaign, { ...options, ...next() });
}

function reported(payload) { return { claimStatus:'reported-in-source', ...payload }; }
function reconstruction(payload) { return { claimStatus:'molarium-reconstruction', ...payload }; }

async function structureStoryCueScript(campaign, cueId, label) {
  return storeActionScript(campaign, { label:`Replay ${label} in the structure story`, actions:[
    { action:'structureStory.load', args:{ storyId:campaign.campaignId },
      caption:'Load the registered, provenance-pinned structure story.' },
    { action:'structureStory.selectCue', args:{ cueId },
      caption:`Select the persistent ${label} trajectory cue.` },
  ], compiler:{ name:'structure-story-cue/v1', boundary:'molarium.chemist-actions/v1',
    storyId:campaign.campaignId, cueId } });
}

async function moonshotStory() {
  const next = clock('2025-06-17T00:00:00.000Z', '2026-08-30T18:00:00.000Z');
  const campaign = createCampaign({ campaignId:'moonshot-dndi-6510',
    title:'From Moonshot lead (S)-x1 to DNDI-6510',
    description:'A source-grounded reconstruction of the reported branches, stopped ideas, lead selection, and eventual program discontinuation.',
    createdAt:'2026-08-30T18:00:00.000Z',
    actors:[
      { id:'reported.moonshot-authors', type:'import', displayName:'Reported study authors' },
      { id:'curator.sol', type:'agent', displayName:'Sol · Molarium curator' },
    ],
    sources:[
      { id:'source.dndi-paper', type:'publication',
        title:'Open-science discovery of DNDI-6510',
        locator:'doi:10.1101/2025.06.16.660018',
        url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12262575/', license:'CC BY 4.0' },
      { id:'source.7gn8', type:'structure', title:'SARS-CoV-2 Mpro with Moonshot lead (S)-x1',
        locator:'PDB:7GN8 / CCD:RPZ', url:'https://www.rcsb.org/structure/7GN8' },
      { id:'source.7gnr', type:'structure', title:'SARS-CoV-2 Mpro with (S)-x38 DNDI-6510',
        locator:'PDB:7GNR / CCD:RZU', url:'https://www.rcsb.org/structure/7GNR' },
      { id:'source.public-cdd', type:'dataset', title:'COVID Moonshot public compound data',
        locator:'Public CDD Vault and ChEMBL, as cited by the study' },
    ], application:{ version:'1.0.0', reconstruction:'literature narrative v1' } });
  const start = await addObservation(campaign, next, { actorId:'curator.sol',
    kind:'campaign.started', sourceIds:['source.dndi-paper'], payload:reconstruction({
      objective:'Preserve the full reported decision history, including routes that were stopped.',
      caveat:'Narrative order follows the paper. Exact experiment dates were not established; occurredAt encodes publication-order sequence.',
    }) });
  const x1 = await addCommit(campaign, next, { label:'(S)-x1 · Moonshot lead',
    canonicalSmiles:'CNC(=O)CN1Cc2ccc(cc2[C@]3(C1)CCN(C3=O)c4cncc5c4cccc5)Cl',
    externalRefs:[{ sourceId:'source.7gn8', pdbId:'7GN8', componentId:'RPZ', chain:'A', residueNumber:407 },
      { sourceId:'source.public-cdd', compoundId:'MAT-POS-c7726e07-5' }],
    properties:reported({ role:'starting lead', liabilities:['positive Ames signal','rapid rodent clearance','racemization risk'] }),
    message:'Record the crystallographic Moonshot starting lead and its disclosed liabilities.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper','source.7gn8'],
    tags:['starting-point','crystal-structure'] });
  const liability = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    subjectIds:[x1.commitId], sourceIds:['source.dndi-paper'], payload:reported({
      observation:'The lead series required simultaneous mitigation of Ames risk, metabolic clearance, and racemization while maintaining Mpro potency.',
      structuralRequirements:['isoquinoline N–His163 hydrogen bond','carbonyl–Glu166 backbone NH hydrogen bond','aromatic chlorine in S2'],
    }) });
  await decide(campaign, next, { targetCommitId:x1.commitId, disposition:'progressed',
    reasonCodes:['potency'], rationale:'Retained as the structural and activity reference despite known liabilities.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'], evidenceIds:[liability.eventId] });

  const approaches = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    kind:'hypothesis.proposed', parentEventIds:[start.eventId], subjectIds:[x1.commitId],
    sourceIds:['source.dndi-paper'], payload:reported({ statement:'Test three Ames-mitigation strategies in parallel.',
      approaches:['6-position substitution','amino-heterocycle replacement','spirocyclisation to prevent metabolite release'] }) });

  const ewg = await addCommit(campaign, next, { label:'6-position electron-withdrawing series',
    externalRefs:[{ sourceId:'source.dndi-paper', locator:'Figure 2C', examples:['F','SO2Me','CN','CF3'] }],
    properties:reported({ series:true, intendedOutcome:'reduce oxidative activation' }), parents:[x1.commitId],
    branch:'ames.6-position-ewg', message:'Explore electron-withdrawing 6-position substitutions.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'], hypothesisIds:[approaches.eventId] });
  const ewgResult = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'ames.6-position-ewg', subjectIds:[ewg.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'SARS-CoV-2 Mpro inhibition', result:'less active than electron-donating substitutions' }) });
  const ewgDecision = await decide(campaign, next, { targetCommitId:ewg.commitId,
    disposition:'not-progressed', reasonCodes:['potency'],
    rationale:'Electron-withdrawing examples lost Mpro activity; the approach was discontinued.',
    actorId:'reported.moonshot-authors', branch:'ames.6-position-ewg',
    sourceIds:['source.dndi-paper'], evidenceIds:[ewgResult.eventId] });

  const heterocycles = await addCommit(campaign, next, { label:'Amino-heterocycle replacement series',
    externalRefs:[{ sourceId:'source.dndi-paper', locator:'Figure 2D', example:'x42 tetrahydroisoquinoline' }],
    properties:reported({ intendedOutcome:'retain His163 acceptor while lowering mutagenicity risk' }),
    parents:[x1.commitId], branch:'ames.heterocycles',
    message:'Replace the amino isoquinoline with alternative heterocycles.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'], hypothesisIds:[approaches.eventId] });
  const heteroResult = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'ames.heterocycles', subjectIds:[heterocycles.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'Mpro potency and metabolic-risk review',
      result:'Most replacements lost >3-fold potency; x42 retained potency but could oxidatively re-aromatize.' }) });
  const heteroDecision = await decide(campaign, next, { targetCommitId:heterocycles.commitId,
    disposition:'not-progressed', reasonCodes:['potency','genotoxicity'],
    rationale:'The only potency-retaining replacement retained an unacceptable route back to the risky isoquinoline.',
    actorId:'reported.moonshot-authors', branch:'ames.heterocycles',
    sourceIds:['source.dndi-paper'], evidenceIds:[heteroResult.eventId] });

  const hydantoin = await addCommit(campaign, next, { label:'Early spiro hydantoin matched pairs',
    externalRefs:[{ sourceId:'source.dndi-paper', locator:'Figure 2E' }],
    properties:reported({ intendedOutcome:'lock the amino isoquinoline against release' }),
    parents:[x1.commitId], branch:'ames.spiro', message:'Test the first spirocyclised hydantoin designs.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'], hypothesisIds:[approaches.eventId] });
  const hydantoinResult = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'ames.spiro', subjectIds:[hydantoin.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'Mpro potency', result:'Crystal structures aligned, but potency was not promising.' }) });
  await decide(campaign, next, { targetCommitId:hydantoin.commitId, disposition:'not-progressed',
    reasonCodes:['potency'], rationale:'The first hydantoin variants did not justify further progression.',
    actorId:'reported.moonshot-authors', branch:'ames.spiro', sourceIds:['source.dndi-paper'],
    evidenceIds:[hydantoinResult.eventId] });

  const ring6 = await addCommit(campaign, next, { label:'Six-membered ring lactam',
    externalRefs:[{ sourceId:'source.dndi-paper', locator:'Figure 2E' }],
    properties:reported({ hypothesis:'extra lipophilicity or altered conformation might improve potency' }),
    parents:[hydantoin.commitId], branch:'ames.spiro.six-membered-lactam',
    message:'Expand the spiro lactam ring.', actorId:'reported.moonshot-authors',
    sourceIds:['source.dndi-paper'] });
  const ring6Result = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'ames.spiro.six-membered-lactam', subjectIds:[ring6.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'Mpro potency and crystallographic pose',
      result:'Significantly less potent; crystal structure showed substantial ligand displacement.' }) });
  const ring6Decision = await decide(campaign, next, { targetCommitId:ring6.commitId,
    disposition:'not-progressed', reasonCodes:['potency','contact-loss'],
    rationale:'Ring expansion displaced the ligand and reduced potency.',
    actorId:'reported.moonshot-authors', branch:'ames.spiro.six-membered-lactam',
    sourceIds:['source.dndi-paper'], evidenceIds:[ring6Result.eventId] });

  const x29 = await addCommit(campaign, next, { label:'(S)-x29 · spiro lactam',
    externalRefs:[{ sourceId:'source.dndi-paper', compound:'(S)-x29', locator:'Figure 2 / Supplementary Table 1' }],
    properties:reported({ series:'spiro lactam', Ames:'negative in reported tests', stereocenter:'all-carbon' }),
    parents:[hydantoin.commitId], branch:'ames.spiro.lactam',
    message:'Advance the potency-retaining spiro lactam series.', actorId:'reported.moonshot-authors',
    sourceIds:['source.dndi-paper'] });
  const x29Result = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'ames.spiro.lactam', subjectIds:[x29.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'Ames and Mpro', result:'High potency with no concerning Ames activity at tested concentrations.' }) });
  const x29Decision = await decide(campaign, next, { targetCommitId:x29.commitId,
    disposition:'progressed', reasonCodes:['potency','genotoxicity'],
    rationale:'Selected as the tractable series for further metabolism optimization.',
    actorId:'reported.moonshot-authors', branch:'ames.spiro.lactam',
    sourceIds:['source.dndi-paper'], evidenceIds:[x29Result.eventId] });

  const x31 = await addCommit(campaign, next, { label:'(S)-x31 · optimized lead',
    externalRefs:[{ sourceId:'source.dndi-paper', compound:'(S)-x31', locator:'Figure 4' }],
    properties:reported({ antiviralEC90nM:142, Ames:'negative in reported tests' }),
    parents:[x29.commitId], branch:'lead-optimization', message:'Combine spiro locking with metabolism-focused changes.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'] });
  const x37 = await addCommit(campaign, next, { label:'(S)-x37 · optimized lead',
    externalRefs:[{ sourceId:'source.dndi-paper', compound:'(S)-x37', locator:'Figure 4' }],
    properties:reported({ antiviralEC90nM:64, Ames:'negative in reported tests' }),
    parents:[x29.commitId], branch:'lead-optimization.x37', message:'Retain a parallel optimized lead.',
    actorId:'reported.moonshot-authors', sourceIds:['source.dndi-paper'] });
  const x38 = await addCommit(campaign, next, { label:'(S)-x38 · DNDI-6510',
    canonicalSmiles:'CNC(=O)C1(CC1)N2C[C@]3(CCN(C3=O)c4cncc5c4cccc5)c6cc(ccc6C2=O)Cl',
    externalRefs:[{ sourceId:'source.7gnr', pdbId:'7GNR', componentId:'RZU', chain:'A', residueNumber:408 }],
    properties:reported({ role:'preclinical candidate', antiviralEC90nM:66,
      ratLiverMicrosomeClearance:'16 µL/min/mg', Ames:'negative in reported tests' }),
    parents:[x31.commitId,x37.commitId], branch:'lead-optimization',
    message:'Select the structurally confirmed optimized candidate.', actorId:'reported.moonshot-authors',
    sourceIds:['source.dndi-paper','source.7gnr'], tags:['candidate','crystal-structure'] });
  await decide(campaign, next, { targetCommitId:x31.commitId, disposition:'superseded',
    reasonCodes:['lower-priority'], rationale:'Retained as a reported optimized lead, but x38 was selected for the candidate profile.',
    actorId:'reported.moonshot-authors', branch:'lead-optimization', sourceIds:['source.dndi-paper'] });
  await decide(campaign, next, { targetCommitId:x37.commitId, disposition:'superseded',
    reasonCodes:['lower-priority'], rationale:'Retained as a reported optimized lead, but x38 was selected for the candidate profile.',
    actorId:'reported.moonshot-authors', branch:'lead-optimization.x37', sourceIds:['source.dndi-paper'] });
  const x38Result = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'lead-optimization', subjectIds:[x38.commitId], sourceIds:['source.dndi-paper','source.7gnr'],
    kind:'measurement.recorded', payload:reported({ endpoint:'candidate profile',
      result:'Key S1/S2 contacts preserved; rat microsomal clearance improved from 605 for x1 to 16 µL/min/mg for x38.' }) });
  const x38Progress = await decide(campaign, next, { targetCommitId:x38.commitId,
    disposition:'progressed', reasonCodes:['potency','clearance','genotoxicity'],
    rationale:'Advanced as DNDI-6510 after balancing potency, exposure, and Ames risk.',
    actorId:'reported.moonshot-authors', branch:'lead-optimization',
    sourceIds:['source.dndi-paper','source.7gnr'], evidenceIds:[x38Result.eventId] });
  const induction = await addObservation(campaign, next, { actorId:'reported.moonshot-authors',
    branch:'lead-optimization', subjectIds:[x38.commitId], sourceIds:['source.dndi-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'repeat dosing and nuclear hormone receptor induction',
      result:'Exposure fell on repeat dosing in rodents; cross-species assays indicated PXR-linked induction.' }) });
  const stopped = await decide(campaign, next, { targetCommitId:x38.commitId,
    disposition:'archived', reasonCodes:['program-discontinued','clearance'],
    rationale:'Preclinical development was discontinued after repeat dosing could not exceed predicted efficacious human exposure in two rodent species.',
    actorId:'reported.moonshot-authors', branch:'lead-optimization',
    sourceIds:['source.dndi-paper'], evidenceIds:[induction.eventId] });
  await finalizeCampaign(campaign, { finalizedAt:'2026-08-30T18:30:00.000Z', actorId:'curator.sol' });

  const movie = await buildMovieManifest({ campaign, title:'A complete lead-optimization history',
    createdAt:'2026-08-30T18:31:00.000Z', width:1440, height:900, fps:30, cues:[
      { title:'Start with (S)-x1', durationMs:2600, commitId:x1.commitId, eventId:liability.eventId,
        narration:'A potent structural lead arrives with mutagenicity, clearance, and stereochemical liabilities.' },
      { title:'Three parallel ideas', durationMs:2200, eventId:approaches.eventId,
        narration:'The study reports three distinct strategies rather than one retrospective success path.' },
      { title:'6-position substitutions stop', durationMs:2200, commitId:ewg.commitId, eventId:ewgDecision.eventId,
        narration:'Electron-withdrawing substitutions reduce activity and this branch is not progressed.' },
      { title:'Heterocycle replacement stops', durationMs:2200, commitId:heterocycles.commitId, eventId:heteroDecision.eventId,
        narration:'Most heterocycles lose potency; the exception retains a re-aromatization risk.' },
      { title:'Ring expansion stops', durationMs:2200, commitId:ring6.commitId, eventId:ring6Decision.eventId,
        narration:'A six-membered lactam displaces the ligand and is retained as a negative decision.' },
      { title:'Spiro lactam progresses', durationMs:2600, commitId:x29.commitId, eventId:x29Decision.eventId,
        narration:'The spiro lactam preserves activity while addressing the Ames and racemization hypotheses.' },
      { title:'DNDI-6510 selected', durationMs:3000, commitId:x38.commitId, snapshotId:x38.snapshotId,
        eventId:x38Progress.eventId, narration:'Multi-parameter optimization produces the structurally confirmed preclinical candidate.' },
      { title:'The program still stops', durationMs:3200, commitId:x38.commitId, eventId:stopped.eventId,
        narration:'The durable record keeps the later PXR-linked repeat-dose exposure failure beside the successful lead selection.' },
    ] });
  return { campaign, movie };
}

async function bclStory() {
  const next = clock('2012-05-10T00:00:00.000Z', '2026-08-30T19:00:00.000Z');
  const campaign = createCampaign({ campaignId:'bclxl-fragment-linking',
    title:'BCL-xL fragment linking and linker optimization',
    description:'A reconstruction of a branching structure-based design story in which two weak site binders become subnanomolar linked inhibitors.',
    createdAt:'2026-08-30T19:00:00.000Z', actors:[
      { id:'reported.bcl-authors', type:'import', displayName:'Reported study authors' },
      { id:'curator.sol', type:'agent', displayName:'Sol · Molarium curator' },
    ], sources:[
      { id:'source.bcl-paper', type:'publication',
        title:'Design of Bcl-2 and Bcl-xL inhibitors with subnanomolar binding affinities based upon a new scaffold',
        locator:'doi:10.1021/jm300178u / PMID:22448988',
        url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3397176/' },
      { id:'source.3spf', type:'structure', title:'BCL-xL complex with compound 4',
        locator:'PDB:3SPF / CCD:B50', url:'https://www.rcsb.org/structure/3SPF' },
    ], application:{ version:'1.0.0', reconstruction:'literature narrative v1' } });
  await addObservation(campaign, next, { actorId:'curator.sol', kind:'campaign.started',
    sourceIds:['source.bcl-paper'], payload:reconstruction({
      objective:'Represent the weak-fragment, linking, linker-length, and cellular-activity branches reported in the study.',
      caveat:'Narrative order follows the publication; exact experiment dates were not reported.' }) });
  const c4Script = await structureStoryCueScript(campaign, 'compound-4-crystal', 'compound 4');
  const c4 = await addCommit(campaign, next, { label:'Compound 4 · Site 1 scaffold',
    canonicalSmiles:'ClC1=CC=C(C=C1)C=1C(=C(N(C1)CC[C@@H](CO)O)C(=O)NCCCN1CCN(CC1)C)C1=CC=CC=C1',
    externalRefs:[{ sourceId:'source.3spf', pdbId:'3SPF', componentId:'B50', chain:'A', residueNumber:501 }],
    properties:reported({ bcl2Ki:'78.0 µM', bclxlKi:'138 µM', role:'weak Site 1 binder' }),
    message:'Record the crystallographic weak Site 1 lead.', actorId:'reported.bcl-authors',
    sourceIds:['source.bcl-paper','source.3spf'], actionScriptId:c4Script,
    tags:['starting-point','crystal-structure','chemist-actions'] });
  const c4Data = await addObservation(campaign, next, { actorId:'reported.bcl-authors',
    subjectIds:[c4.commitId], sourceIds:['source.bcl-paper'], kind:'measurement.recorded',
    payload:reported({ endpoint:'fluorescence-polarization binding', bcl2KiMicromolar:78,
      bclxlKiMicromolar:138, interpretation:'Weak, but soluble and structurally confirmed in Site 1.' }) });
  await decide(campaign, next, { targetCommitId:c4.commitId, disposition:'progressed',
    reasonCodes:['other'], rationale:'The weak compound was retained because its core was tractable, soluble, and crystallographically validated.',
    actorId:'reported.bcl-authors', sourceIds:['source.bcl-paper','source.3spf'], evidenceIds:[c4Data.eventId] });
  const c5 = await addCommit(campaign, next, { label:'Compound 5 · Site 2 fragment',
    externalRefs:[{ sourceId:'source.bcl-paper', compound:'5', locator:'Figure 5' }],
    properties:reported({ bclxlKi:'75.0 µM', role:'weak Site 2 fragment derived from ABT-737' }),
    message:'Record the complementary weak Site 2 fragment.', actorId:'reported.bcl-authors',
    sourceIds:['source.bcl-paper'], tags:['fragment'] });
  await decide(campaign, next, { targetCommitId:c5.commitId, disposition:'progressed',
    reasonCodes:['other'], rationale:'Retained as a complementary Site 2 anchor despite weak isolated affinity.',
    actorId:'reported.bcl-authors', sourceIds:['source.bcl-paper'] });
  const linkHypothesis = await addObservation(campaign, next, { actorId:'reported.bcl-authors',
    kind:'hypothesis.proposed', subjectIds:[c4.commitId,c5.commitId], sourceIds:['source.bcl-paper'],
    payload:reported({ statement:'Link the meta position of compound 4 to the sulfonamido nitrogen of fragment 5.',
      measuredGapAngstrom:8.2 }) });
  const c6Script = await structureStoryCueScript(campaign, 'compound-6-linked', 'compound 6');
  const c6 = await addCommit(campaign, next, { label:'Compound 6 · first linked design',
    canonicalSmiles:'ClC1=CC=C(C=C1)C=1C(=C(N(C1)CC[C@@H](CO)O)C(=O)NCCCN1CCN(CC1)C)C1=CC(=CC=C1)N1CCN(CC1)C1=CC=C(C=C1)C(NS(=O)(=O)C1=CC(=C(C=C1)N[C@H](CSC1=CC=CC=C1)CCN(C)C)[N+](=O)[O-])=O',
    externalRefs:[{ sourceId:'source.bcl-paper', compound:'6', locator:'Figures 5C and 6' }],
    properties:reported({ linkerLengthAngstrom:10.6, bcl2KiNanomolar:2, bclxlKi:'<1 nM' }),
    parents:[c4.commitId,c5.commitId], branch:'linked-series', message:'Link the two weak binders with the initial 10.6 Å design.',
    actorId:'reported.bcl-authors', sourceIds:['source.bcl-paper'], actionScriptId:c6Script,
    hypothesisIds:[linkHypothesis.eventId], tags:['chemist-actions','reconstructed-pose'] });
  const c6Data = await addObservation(campaign, next, { actorId:'reported.bcl-authors', branch:'linked-series',
    subjectIds:[c6.commitId], sourceIds:['source.bcl-paper'], kind:'measurement.recorded',
    payload:reported({ endpoint:'binding affinity', result:'>10,000-fold improvement over either fragment; BCL-2 Ki 2.0 nM and BCL-xL Ki <1 nM.' }) });
  await decide(campaign, next, { targetCommitId:c6.commitId, disposition:'progressed',
    reasonCodes:['potency'], rationale:'The linking hypothesis produced the intended affinity jump.',
    actorId:'reported.bcl-authors', branch:'linked-series', sourceIds:['source.bcl-paper'], evidenceIds:[c6Data.eventId] });

  const variants = [
    { id:'7', length:9.9, bcl2:'<0.6 nM', bclxl:'<1 nM', cellular:'~2 µM', disposition:'progressed',
      canonicalSmiles:'ClC1=CC=C(C=C1)C=1C(=C(N(C1)CC[C@@H](CO)O)C(=O)NCCCN1CCN(CC1)C)C1=CC(=CC=C1)N1CCN(CC1)C1=CC=C(C=C1)NS(=O)(=O)C1=CC(=C(C=C1)N[C@@H](CSC1=CC=CC=C1)CCN(C)C)[N+](=O)[O-]',
      reasons:['potency','permeability'], rationale:'Selected as the lead for subsequent optimization because it combined subnanomolar binding with measurable cellular activity.' },
    { id:'8', length:9.0, bcl2:'<0.6 nM', bclxl:'<1 nM', cellular:'>10 µM', disposition:'not-progressed',
      reasons:['permeability'], rationale:'Excellent biochemical affinity did not translate to cellular activity.' },
    { id:'9', length:9.1, bcl2:'~0.6 nM', bclxl:'<1 nM', cellular:'>10 µM', disposition:'not-progressed',
      reasons:['permeability'], rationale:'The rigid ethynyl linker retained binding but not useful cellular activity.' },
    { id:'10', length:8.3, bcl2:'1.5 nM', bclxl:'1.7 nM', cellular:'>10 µM', disposition:'not-progressed',
      reasons:['potency','permeability'], rationale:'The shorter linker weakened affinity and retained poor cellular activity.' },
    { id:'11', length:null, bcl2:'15.4 nM', bclxl:'11.3 nM', cellular:'>10 µM', disposition:'not-progressed',
      reasons:['potency'], rationale:'Added linker flexibility cost at least an order of magnitude in affinity.' },
    { id:'12', length:null, bcl2:'8.5 nM', bclxl:'<1 nM', cellular:'2.5–3.3 µM', disposition:'not-progressed',
      reasons:['selectivity','potency'], rationale:'Changing attachment geometry reduced BCL-2 affinity relative to compound 7.' },
  ];
  const variantRecords = [];
  for (const variant of variants) {
    const actionScriptId = variant.id === '7'
      ? await structureStoryCueScript(campaign, 'compound-7-linker', 'compound 7') : null;
    const record = await addCommit(campaign, next, { label:`Compound ${variant.id} · linker variant`,
      canonicalSmiles:variant.canonicalSmiles||null,
      externalRefs:[{ sourceId:'source.bcl-paper', compound:variant.id, locator:'Figure 6 / Table 1' }],
      properties:reported({ linkerLengthAngstrom:variant.length, bcl2Ki:variant.bcl2,
        bclxlKi:variant.bclxl, cellularIC50:variant.cellular }), parents:[c6.commitId],
      branch:`linked-series.compound-${variant.id}`, message:`Test linker variant ${variant.id}.`,
      actorId:'reported.bcl-authors', sourceIds:['source.bcl-paper'], actionScriptId,
      tags:actionScriptId?['chemist-actions','reconstructed-pose']:[] });
    const measurement = await addObservation(campaign, next, { actorId:'reported.bcl-authors',
      branch:`linked-series.compound-${variant.id}`, subjectIds:[record.commitId],
      sourceIds:['source.bcl-paper'], kind:'measurement.recorded', payload:reported({
        endpoint:'binding and cell growth', bcl2Ki:variant.bcl2, bclxlKi:variant.bclxl,
        cellularIC50:variant.cellular }) });
    const decision = await decide(campaign, next, { targetCommitId:record.commitId,
      disposition:variant.disposition, reasonCodes:variant.reasons, rationale:variant.rationale,
      actorId:'reported.bcl-authors', branch:`linked-series.compound-${variant.id}`,
      sourceIds:['source.bcl-paper'], evidenceIds:[measurement.eventId] });
    variantRecords.push({ ...record, ...variant, decision });
  }
  const c7 = variantRecords.find((entry) => entry.id === '7');
  const c16Script = await structureStoryCueScript(campaign, 'compound-16-truncation', 'compound 16');
  const c16 = await addCommit(campaign, next, { label:'Compound 16 · side-chain truncation',
    canonicalSmiles:'ClC1=CC=C(C=C1)C=1C(=C(N(C1)C)C(=O)NCCCN1CCN(CC1)C)C1=CC(=CC=C1)N1CCN(CC1)C1=CC=C(C=C1)NS(=O)(=O)C1=CC(=C(C=C1)N[C@@H](CSC1=CC=CC=C1)CCN(C)C)[N+](=O)[O-]',
    externalRefs:[{ sourceId:'source.bcl-paper', compound:'16', locator:'Figure 7 / Table 2' }],
    properties:reported({ bcl2Ki:'<1 nM', bclxlKi:'<1 nM', cellularIC50:'0.43–0.65 µM',
      role:'non-interacting dihydroxybutyl side-chain truncated to methyl' }),
    parents:[c7.commitId], branch:'lead-optimization.compound-16',
    message:'Remove the non-interacting dihydroxybutyl side chain.', actorId:'reported.bcl-authors',
    sourceIds:['source.bcl-paper'], actionScriptId:c16Script,
    tags:['chemist-actions','reconstructed-pose'] });
  const c16Result = await addObservation(campaign, next, { actorId:'reported.bcl-authors',
    branch:'lead-optimization.compound-16', subjectIds:[c16.commitId], sourceIds:['source.bcl-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'binding and cellular potency',
      result:'BCL-2 and BCL-xL Ki <1 nM; H146/H1417 cell growth IC50 0.43/0.65 µM.' }) });
  const c16Decision = await decide(campaign, next, { targetCommitId:c16.commitId,
    disposition:'progressed', reasonCodes:['permeability'],
    rationale:'Truncating a non-interacting side chain preserved binding and improved cellular activity.',
    actorId:'reported.bcl-authors', branch:'lead-optimization.compound-16',
    sourceIds:['source.bcl-paper'], evidenceIds:[c16Result.eventId] });
  const c21Script = await structureStoryCueScript(campaign, 'compound-21-pocket-fill', 'compound 21');
  const c21 = await addCommit(campaign, next, { label:'Compound 21 · optimized inhibitor',
    canonicalSmiles:'ClC1=CC=C(C=C1)C=1C(=C(N(C1CC)C)C(=O)O)C1=CC(=CC=C1)N1CCN(CC1)C1=CC=C(C=C1)NS(=O)(=O)C1=CC(=C(C=C1)N[C@@H](CSC1=CC=CC=C1)CCN(C)C)[N+](=O)[O-]',
    externalRefs:[{ sourceId:'source.bcl-paper', compound:'21', locator:'Abstract / later optimization' }],
    properties:reported({ bcl2Ki:'<1 nM', bclxlKi:'<1 nM', cellularIC50:'60–90 nM' }),
    parents:[c16.commitId], branch:'lead-optimization',
    message:'Add the ethyl pocket-fill modification and advance the optimized inhibitor.', actorId:'reported.bcl-authors',
    sourceIds:['source.bcl-paper'], actionScriptId:c21Script,
    tags:['chemist-actions','reconstructed-pose'] });
  const c21Result = await addObservation(campaign, next, { actorId:'reported.bcl-authors',
    branch:'lead-optimization', subjectIds:[c21.commitId], sourceIds:['source.bcl-paper'],
    kind:'measurement.recorded', payload:reported({ endpoint:'binding and cellular potency',
      result:'BCL-2 and BCL-xL Ki <1 nM; H146/H1417 cell growth IC50 60–90 nM.' }) });
  const c21Decision = await decide(campaign, next, { targetCommitId:c21.commitId,
    disposition:'progressed', reasonCodes:['potency','permeability'],
    rationale:'Reported as the best compound after biochemical affinity translated to cellular activity.',
    actorId:'reported.bcl-authors', branch:'lead-optimization', sourceIds:['source.bcl-paper'],
    evidenceIds:[c21Result.eventId] });
  await finalizeCampaign(campaign, { finalizedAt:'2026-08-30T19:30:00.000Z', actorId:'curator.sol' });
  const movie = await buildMovieManifest({ campaign, title:'Two weak binders, one branching linker campaign',
    createdAt:'2026-08-30T19:31:00.000Z', width:1440, height:900, fps:30, cues:[
      { title:'A weak but useful crystal lead', durationMs:2500, commitId:c4.commitId, eventId:c4Data.eventId,
        narration:'Compound 4 is weak, but its tractable scaffold and crystal pose keep it alive.' },
      { title:'A complementary weak fragment', durationMs:2200, commitId:c5.commitId,
        narration:'Fragment 5 reaches the second pocket but is also weak in isolation.' },
      { title:'The linking hypothesis', durationMs:2200, eventId:linkHypothesis.eventId,
        narration:'Structural superposition suggests an 8.2 Å connection between the two site binders.' },
      { title:'More than ten thousand-fold', durationMs:2600, commitId:c6.commitId, eventId:c6Data.eventId,
        narration:'The first linked molecule converts two weak binders into nanomolar affinity.' },
      ...variantRecords.map((entry) => ({ title:`Linker branch ${entry.id}`,
        durationMs:entry.disposition === 'progressed' ? 2600 : 1800,
        commitId:entry.commitId, eventId:entry.decision.eventId,
        narration:entry.rationale })),
      { title:'Remove the non-interacting side chain', durationMs:2600, commitId:c16.commitId,
        eventId:c16Decision.eventId, narration:'Compound 16 preserves subnanomolar binding while improving cellular activity through deliberate truncation.' },
      { title:'Cellular activity catches up', durationMs:3000, commitId:c21.commitId,
        eventId:c21Decision.eventId, narration:'Compound 21 combines subnanomolar binding with 60–90 nM cellular activity.' },
    ] });
  return { campaign, movie };
}

function atomIdsFrom7kpa(pdbText) {
  const result = new Map();
  for (const line of pdbText.split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    const atomName = line.slice(12, 16).trim();
    const residueName = line.slice(17, 20).trim();
    const chain = line.slice(21, 22).trim();
    const residueIndex = line.slice(22, 26).trim();
    if (record !== 'HETATM' || residueName !== 'D84' || chain !== 'C' || residueIndex !== '201') continue;
    const serial = line.slice(6, 11).trim(), insertionCode = line.slice(26, 27).trim();
    result.set(atomName, ['chemist-7KPA',record,chain,residueName,residueIndex,
      insertionCode,atomName,serial].join(':'));
  }
  return result;
}

function compile7kpaScript(entry, ids) {
  const actions = [
    { action:'view.setMode', args:{ mode:'build' }, caption:'Open Design.' },
    { action:'build.setTool', args:{ tool:'select' }, caption:'Use the same Select tool as the chemist.' },
    { action:'pose.captureReference', args:{ mode:'propagate' }, caption:'Capture the crystallographic reference pose.' },
  ];
  const ref = (name) => ids.get(name) || { $binding:name };
  for (const operation of entry.operations) {
    if (operation.op === 'finish') {
      actions.push({ action:'chemistry.finish', args:{}, caption:'Finish and validate the complete chemical state.' });
    } else if (operation.op === 'addAtom') {
      actions.push({ action:'chemistry.addAtom',
        args:{ attachedToAtomId:ref(operation.attachedTo), element:operation.element },
        capture:{ [operation.as]:'addedAtomId' }, caption:`Add ${operation.element}.` });
    } else if (operation.op === 'createBond') {
      actions.push({ action:'chemistry.createBond',
        args:{ atomIds:operation.atoms.map(ref), order:operation.order }, caption:'Create the ring bond.' });
    } else {
      const atoms = operation.atoms || [operation.atom];
      actions.push({ action:'selection.replace', args:{ atomIds:atoms.map(ref) },
        caption:`Select ${atoms.join('–')}.` });
      const action = { setAtom:'chemistry.setAtom', setBond:'chemistry.setBond',
        deleteAtom:'chemistry.deleteAtom', deleteBond:'chemistry.deleteBond',
        addHydrogen:'chemistry.addHydrogen', removeHydrogen:'chemistry.removeHydrogen' }[operation.op];
      const target = atoms.map(ref);
      const args = operation.op === 'setAtom'
        ? { atomId:target[0], element:operation.element,
          formalCharge:operation.formalCharge ?? 0 }
        : operation.op === 'setBond' ? { atomIds:target, order:operation.order }
          : atoms.length === 1 ? { atomId:target[0] } : { atomIds:target };
      actions.push({ action, args, caption:`Apply ${operation.op}.` });
    }
  }
  actions.push({ action:'pose.refine', args:{ searchChains:8 },
    caption:'Start the visible reference-guided pose search.' });
  return actions;
}

async function rehearsalStory() {
  const next = clock('2026-08-23T00:00:00.000Z', '2026-08-30T20:00:00.000Z');
  const [pdbText, catalogue] = await Promise.all([
    readFile(path.join(root, 'test/fixtures/7kpa.pdb'), 'utf8'),
    readFile(path.join(root, 'enumerations/catalogue.v0.1.json'), 'utf8').then(JSON.parse),
  ]);
  const ids = atomIdsFrom7kpa(pdbText);
  if (ids.size < 30) throw new Error('Could not derive stable 7KPA D84 atom IDs');
  const campaign = createCampaign({ campaignId:'molarium-7kpa-rehearsal',
    title:'7KPA chemist-action rehearsal',
    description:'An executable infrastructure rehearsal that records high-disruption graph edits, restraint-guided pose generation, and negative physical screens.',
    createdAt:'2026-08-30T20:00:00.000Z', actors:[
      { id:'human.project-lead', type:'human', displayName:'Molarium project lead' },
      { id:'agent.sol', type:'agent', displayName:'Sol · implementation agent' },
      { id:'system.browser', type:'system', displayName:'Molarium browser runtime' },
    ], sources:[
      { id:'source.7kpa', type:'structure', title:'7KPA prepared reference structure',
        locator:'PDB:7KPA / CCD:D84', url:'https://www.rcsb.org/structure/7KPA' },
      { id:'source.enumeration-catalogue', type:'repository', title:'7KPA high-disruption enumeration catalogue v0.1',
        locator:'enumerations/catalogue.v0.1.json' },
      { id:'source.enumeration-results', type:'notebook', title:'7KPA high-disruption browser results v0.1',
        locator:'enumerations/RESULTS.v0.1.md', sha256:'80047f9ac6c12a09f37103b7b0e44e6a79cb7033a032044ae95a26f68fdc0f75' },
    ], application:{ version:'1.0.0', api:'molarium.chemist-actions/v1' } });
  await addObservation(campaign, next, { actorId:'agent.sol', kind:'campaign.started',
    sourceIds:['source.7kpa','source.enumeration-catalogue'], payload:reconstruction({
      objective:'Prove that an agent can enact difficult analogue edits only through operations available to a chemist.',
      caveat:'This is a pose-generation stress test, not an affinity or synthetic-feasibility study.' }) });
  const reference = await addCommit(campaign, next, { label:'7KPA D84 reference ligand',
    canonicalSmiles:'c1ccc(c(c1)Cn2c3cc(ccc3nc2COc4cccc(c4)N5CCCC5=O)C6=CNC(=O)C=C6)OC(F)F',
    externalRefs:[{ sourceId:'source.7kpa', pdbId:'7KPA', componentId:'D84', chain:'C', residueNumber:201 }],
    properties:{ claimStatus:'infrastructure-fixture', graphSha256:'3132f29caf07242906a1e9c3d495cacb84f0ff70c1cb841f0a6655d27c9c8a4f',
      requiredContacts:4 }, message:'Capture the prepared crystallographic starting pose.',
    actorId:'system.browser', sourceIds:['source.7kpa'], tags:['starting-point','browser-fixture'] });
  await decide(campaign, next, { targetCommitId:reference.commitId, disposition:'progressed',
    reasonCodes:['other'], rationale:'Registered as the immutable control and parent for every stress transformation.',
    actorId:'human.project-lead', sourceIds:['source.7kpa'] });
  const hypothesis = await addObservation(campaign, next, { actorId:'human.project-lead',
    kind:'hypothesis.proposed', subjectIds:[reference.commitId], sourceIds:['source.enumeration-catalogue'],
    payload:reconstruction({ statement:'Stress the method with acceptor replacements and a dual-scaffold change that disrupt the inherited graph to different degrees.',
      constraint:'Every edit must compile to the public Chemist Actions API.' }) });
  const resultById = {
    'pyrrolidone-to-pyrazole':{ feasible:'2/8', clashes:0, lennardJonesKcalMol:-66.79,
      relativeStrainKcalMol:-2.38, disposition:'progressed', reasonCodes:['other'],
      rationale:'Contact-feasible poses passed the registered absolute clash and interaction screen.' },
    'pyrrolidone-to-tetrahydropyran':{ feasible:'2/8', clashes:2, lennardJonesKcalMol:-37.35,
      relativeStrainKcalMol:3.83, disposition:'progressed', reasonCodes:['other'],
      rationale:'The ring-expanded case met the preregistered development boundary, with visual review retained.' },
    'phenyl-pyrrolidone-to-spiro-ketone':{ feasible:'8/8', clashes:11, lennardJonesKcalMol:1870.38,
      relativeStrainKcalMol:null, disposition:'not-progressed', reasonCodes:['strain'],
      rationale:'Contact satisfaction did not rescue 11 clashes and a strongly positive absolute receptor–ligand interaction energy.' },
  };
  const records = [];
  for (const entry of catalogue.transformations) {
    const productSnapshotId = await storeSnapshot(campaign, { label:entry.name,
      externalRefs:[{ sourceId:'source.enumeration-catalogue', transformationId:entry.id }],
      properties:{ claimStatus:'browser-stress-result', expectedProductGraphSha256:entry.expectedProductGraphSha256,
        family:entry.family, hypothesis:entry.hypothesis, risks:entry.risks } });
    const actionScriptId = await storeActionScript(campaign, { label:`Replay ${entry.name}`,
      actions:compile7kpaScript(entry, ids), expectedStartSnapshotId:reference.snapshotId,
      expectedEndSnapshotId:productSnapshotId,
      compiler:{ name:'enumerations/action-plan.mjs', catalogueId:catalogue.catalogueId,
        transformationId:entry.id, boundary:'molarium.chemist-actions/v1' } });
    const times = next();
    const commitId = await commitMolecule(campaign, { snapshotId:productSnapshotId,
      parents:[reference.commitId], branch:`enumeration.${entry.id}`, message:`Execute ${entry.name} through chemist-visible edits.`,
      actorId:'agent.sol', ...times, actionScriptId, hypothesisIds:[hypothesis.eventId],
      sourceIds:['source.enumeration-catalogue'], tags:['chemist-actions','stress-test'] });
    const result = resultById[entry.id];
    const measurement = await addObservation(campaign, next, { actorId:'system.browser',
      branch:`enumeration.${entry.id}`, subjectIds:[commitId], sourceIds:['source.enumeration-results'],
      kind:'calculation.completed', payload:{ claimStatus:'recorded-browser-result',
        protocol:'7kpa-high-disruption-public-chemist-actions v0.1', replayCount:2,
        searchChains:8, contactFeasibleChains:result.feasible, stericClashes:result.clashes,
        lennardJonesKcalMol:result.lennardJonesKcalMol,
        relativeLigandStrainKcalMol:result.relativeStrainKcalMol } });
    const decision = await decide(campaign, next, { targetCommitId:commitId,
      disposition:result.disposition, reasonCodes:result.reasonCodes, rationale:result.rationale,
      actorId:'human.project-lead', branch:`enumeration.${entry.id}`,
      sourceIds:['source.enumeration-results'], evidenceIds:[measurement.eventId] });
    records.push({ entry, snapshotId:productSnapshotId, commitId, actionScriptId, result,
      measurement, decision });
  }
  await finalizeCampaign(campaign, { finalizedAt:'2026-08-30T20:30:00.000Z', actorId:'agent.sol' });
  const movie = await buildMovieManifest({ campaign, title:'Agent actions remain chemist actions',
    createdAt:'2026-08-30T20:31:00.000Z', width:1440, height:900, fps:30, cues:[
      { title:'A prepared reference with four contacts', durationMs:2400,
        commitId:reference.commitId, snapshotId:reference.snapshotId,
        narration:'The rehearsal starts from one fixed, hash-identified 7KPA/D84 reference.' },
      ...records.map(({ entry, commitId, snapshotId, decision, result }) => ({
        title:entry.name, durationMs:result.disposition === 'not-progressed' ? 3200 : 2600,
        commitId, snapshotId, eventId:decision.eventId,
        narration:result.rationale,
      })),
    ] });
  return { campaign, movie };
}

const builders = [moonshotStory, bclStory, rehearsalStory];
await mkdir(output, { recursive:true });
const index = { schema:'molarium.design-story-index/v1', generatedAt:'2026-08-30T21:00:00.000Z', stories:[] };
for (const build of builders) {
  const { campaign, movie } = await build();
  const campaignAudit = await verifyCampaign(campaign), movieAudit = await verifyMovieManifest(movie, campaign);
  if (!campaignAudit.valid) throw new Error(`${campaign.campaignId}: ${campaignAudit.reason}`);
  if (!movieAudit.valid) throw new Error(`${campaign.campaignId} movie: ${movieAudit.reason}`);
  const campaignFile = `${campaign.campaignId}.campaign.json`;
  const movieFile = `${campaign.campaignId}.movie.json`;
  await writeFile(path.join(output, campaignFile), `${JSON.stringify(campaign, null, 2)}\n`);
  await writeFile(path.join(output, movieFile), `${JSON.stringify(movie, null, 2)}\n`);
  index.stories.push({ id:campaign.campaignId, title:campaign.title,
    description:campaign.description, campaign:`./${campaignFile}`, movie:`./${movieFile}`,
    summary:campaignSummary(campaign) });
}
await writeFile(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Built ${index.stories.length} design-history stories in ${path.relative(root, output)}`);
