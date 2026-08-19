export const MOLARIUM_CCD_PROTOCOL = Object.freeze({
  schema: 'molarium.docking.protocol/v1',
  id: 'molarium-ccd-1',
  version: '0.1.0',
  name: 'Molarium CCD-1',
  title: 'Reference-core and required H-bond constrained docking',
  status: 'experimental-independent-implementation',
  summary: 'Deterministic ligand-pose evaluation with a reference-core restraint and explicit hydrogen-bond geometry.',
  lineage: Object.freeze([
    Object.freeze({
      role: 'published-method inspiration',
      method: 'Glide staged ligand docking',
      citation: 'Friesner RA et al. J Med Chem. 2004;47:1739-1749.',
      doi: '10.1021/jm0306430',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15027865/',
      adopted: Object.freeze([
        'separate pose generation, torsional optimization, and final refinement stages',
        'reference-ligand core and receptor interaction constraints',
      ]),
      excluded: Object.freeze(['Glide grids', 'OPLS potential grids', 'GlideScore', 'commercial product defaults']),
    }),
    Object.freeze({
      role: 'published-method inspiration',
      method: 'ICM flexible docking in internal coordinates',
      citation: 'Totrov M, Abagyan R. Proteins. 1997;Suppl 1:215-220.',
      doi: '10.1002/(SICI)1097-0134(1997)1+<215::AID-PROT29>3.3.CO;2-I',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9485515/',
      adopted: Object.freeze([
        'torsional sampling followed by local minimization',
        'soft flat-bottom positional and interaction restraints',
      ]),
      excluded: Object.freeze(['ICM receptor grids', 'ICM scoring function', 'Biased Probability Monte Carlo implementation']),
    }),
    Object.freeze({
      role: 'constraint definition reference',
      method: 'Glide receptor and core constraints',
      citation: 'Schrodinger public Glide constraints documentation.',
      url: 'https://learn.schrodinger.com/public/python_api/2025-3/api/schrodinger.application.glide.constraints.html',
      adopted: Object.freeze(['complementary ligand donor/acceptor typing for receptor H-bond constraints']),
      excluded: Object.freeze(['Schrodinger source code and proprietary constraint scoring']),
    }),
    Object.freeze({
      role: 'restraint definition reference',
      method: 'ICM interaction restraints and ligand tethers',
      citation: 'MolSoft ICM public user documentation.',
      url: 'https://www.molsoft.com/gui/interaction-restraints.html',
      adopted: Object.freeze(['flat-bottom harmonic penalty outside an allowed geometric range']),
      excluded: Object.freeze(['MolSoft source code and proprietary parameter values']),
    }),
  ]),
  coreConstraint: Object.freeze({
    kind: 'reference-core-flat-bottom-rmsd',
    minimumHeavyAtoms: 3,
    toleranceAngstrom: 0.5,
    weightKcalMolPerAngstrom2: 25,
  }),
  hydrogenBondConstraint: Object.freeze({
    kind: 'explicit-D-H-A-flat-bottom',
    donorAcceptorDistanceAngstrom: Object.freeze([2.4, 3.5]),
    hydrogenAcceptorDistanceAngstrom: Object.freeze([1.2, 2.7]),
    minimumDhaAngleDegrees: 120,
    weightKcalMol: 15,
    requiredByDefault: true,
  }),
  sampling: Object.freeze({
    seed: 20260819,
    requestedConformers: 64,
    receptor: 'rigid',
    ligand: 'rigid-body and rotatable-bond degrees of freedom',
    stages: Object.freeze([
      'ETKDGv3 ligand conformers',
      'reference-core alignment',
      'constraint-aware pose perturbation',
      'local ligand and optional pocket refinement',
      'constraint audit and transparent reranking',
    ]),
  }),
  scoring: Object.freeze({
    identity: 'Molarium transparent physical score plus explicit restraint penalties',
    feasiblePosesRankFirst: true,
    notEquivalentTo: Object.freeze(['GlideScore', 'ICM Score']),
  }),
  implementation: Object.freeze({
    constraintGeometry: 'implemented',
    deterministicRanking: 'implemented',
    tamperEvidentLabbook: 'implemented',
    browserPoseGeneration: 'not-yet-integrated',
    browserPocketRefinement: 'not-yet-integrated',
  }),
});

export function protocolSnapshot(overrides = {}) {
  return {
    ...structuredClone(MOLARIUM_CCD_PROTOCOL),
    coreConstraint: {
      ...MOLARIUM_CCD_PROTOCOL.coreConstraint,
      ...(overrides.coreConstraint || {}),
    },
    hydrogenBondConstraint: {
      ...MOLARIUM_CCD_PROTOCOL.hydrogenBondConstraint,
      ...(overrides.hydrogenBondConstraint || {}),
    },
    sampling: {
      ...MOLARIUM_CCD_PROTOCOL.sampling,
      ...(overrides.sampling || {}),
      stages: [...(overrides.sampling?.stages || MOLARIUM_CCD_PROTOCOL.sampling.stages)],
    },
  };
}
