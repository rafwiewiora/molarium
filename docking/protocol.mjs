export const MOLARIUM_CONSTRAINT_DOCK_PROTOCOL = Object.freeze({
  schema: 'molarium.docking.protocol/v1',
  id: 'molarium-constraint-dock-1',
  version: '0.3.0',
  name: 'Molarium ConstraintDock-1',
  title: 'Reference-core and required H-bond constrained docking',
  status: 'experimental-browser-implementation',
  summary: 'Deterministic fixed-core ligand torsion search with explicit hydrogen-bond geometry and transparent rigid-receptor scoring.',
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
      role: 'open-source method inspiration',
      method: 'Rowan openconf analogue pose generation',
      citation: 'Rowan Scientific. openconf: Modular conformer generation for docking and ensemble workflows. 2026.',
      url: 'https://github.com/rowansci/openconf',
      adopted: Object.freeze([
        'only sample free terminal rotors outside a constrained analogue core',
        'snap constrained atoms back to exact reference coordinates after search',
      ]),
      excluded: Object.freeze([
        'openconf source code', 'CrystalFF torsion library', 'MMFF94s minimizer',
        'ring flips', 'macrocycle moves', 'openconf clustering and selection',
      ]),
    }),
    Object.freeze({
      role: 'related congeneric-pose method considered, not reproduced',
      method: 'AutoPose R-group decomposition posing for RBFE',
      citation: 'Ponzoni L, York F, Kelley B. ChemRxiv. 2026.',
      doi: '10.26434/chemrxiv.15004703/v1',
      url: 'https://doi.org/10.26434/chemrxiv.15004703/v1',
      adopted: Object.freeze(['edit-lineage core identity serves the same congeneric-design use case']),
      excluded: Object.freeze(['RDKit R-group decomposition', 'Free-Wilson modeling', 'TMD RBFE workflow']),
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
    requestedConformers: 16,
    torsionMonteCarloSteps: 96,
    receptor: 'rigid',
    ligand: 'rigid-body and rotatable-bond degrees of freedom',
    stages: Object.freeze([
      'ETKDGv3 ligand conformers',
      'reference-core alignment and exact coordinate snap',
      'fixed-core receptor-aware torsion Monte Carlo',
      'explicit required H-bond search and audit',
      'transparent rigid-receptor cross-term scoring with relative OpenFF Sage ligand strain',
      'constraint audit and transparent reranking',
    ]),
  }),
  scoring: Object.freeze({
    identity: 'Molarium transparent physical score plus explicit restraint penalties',
    receptorSiteRadiusAngstrom: 8,
    relativeDielectric: 4,
    ligandStrain: 'relative vacuum OpenFF Sage 2.1 intramolecular energy from the lowest fixed-core starting seed',
    interpretation: 'pose-ranking score; not a binding free energy',
    feasiblePosesRankFirst: true,
    notEquivalentTo: Object.freeze(['GlideScore', 'ICM Score']),
  }),
  implementation: Object.freeze({
    constraintGeometry: 'implemented',
    deterministicRanking: 'implemented',
    tamperEvidentLabbook: 'implemented',
    browserPoseGeneration: 'implemented-etkdgv3-plus-fixed-core-torsion-mc',
    browserLigandRefinement: 'implemented-rigid-receptor-fixed-core-torsion-mc',
    browserPocketRefinement: 'not-included-in-v0.3',
  }),
});

export const MOLARIUM_POSE_PROPAGATION_PROTOCOL = Object.freeze({
  ...structuredClone(MOLARIUM_CONSTRAINT_DOCK_PROTOCOL),
  id:'molarium-pose-propagation-1',
  version:'0.1.0',
  name:'Molarium Pose Propagation-1',
  title:'Edit-lineage reference-pose propagation and constrained refinement',
  summary:'All surviving reference heavy atoms remain exact while new graph branches undergo receptor-aware torsion search and fixed-scaffold OpenFF Sage relaxation.',
  lineage:Object.freeze([
    Object.freeze({
      role:'RBFE pose-preparation practice',
      method:'MCS alignment with modified-substituent sampling',
      citation:'Cournia Z et al. J Chem Inf Model. 2017;57:2911-2937.',
      doi:'10.1021/acs.jcim.7b00564',
      url:'https://doi.org/10.1021/acs.jcim.7b00564',
      adopted:Object.freeze([
        'inherit a reference pose for a congeneric common region',
        'sample modified substituents and resolve clashes while maintaining the inherited pose',
      ]),
      excluded:Object.freeze(['binding free-energy estimation', 'unrestrained receptor equilibration']),
    }),
    Object.freeze({
      role:'FEP input-pose evidence',
      method:'Input Pose is Key to Performance of Free Energy Perturbation',
      citation:'Ohadi D et al. J Chem Inf Model. 2024;64:8859-8869.',
      doi:'10.1021/acs.jcim.4c01223',
      url:'https://pubmed.ncbi.nlm.nih.gov/39560439/',
      adopted:Object.freeze([
        'preserve ligand-based reference information',
        'treat explicit H-bond constraints as pose-generation evidence',
      ]),
      excluded:Object.freeze(['FEP+', 'study-specific water choices', 'reported affinity model']),
    }),
    Object.freeze({
      role:'template-pose baseline',
      method:'TEMPL constrained reference embedding',
      citation:'Pinheiro JP et al. J Chem Inf Model. 2025.',
      doi:'10.1021/acs.jcim.5c01985',
      url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12570141/',
      adopted:Object.freeze(['hard reference coordinates for the mapped common substructure']),
      excluded:Object.freeze(['TEMPL source code', 'reference-database search', 'shape-only ranking']),
    }),
    ...MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.lineage,
  ]),
  sampling:Object.freeze({
    ...structuredClone(MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.sampling),
    ligand:'recorded graph edits outside an exact surviving-heavy-atom scaffold',
    stages:Object.freeze([
      'stable edit-lineage mapping of every surviving heavy atom',
      'exact reference-coordinate propagation',
      'receptor-aware torsion Monte Carlo on new graph branches',
      'fixed-scaffold OpenFF Sage local relaxation',
      'explicit required H-bond audit',
      'constraint-feasible transparent ranking',
    ]),
  }),
  implementation:Object.freeze({
    ...structuredClone(MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.implementation),
    browserPoseGeneration:'implemented-recorded-edit-lineage-propagation',
    browserLigandRefinement:'implemented-torsion-mc-plus-fixed-scaffold-sage-relaxation',
  }),
});

export function protocolSnapshot(overrides = {}) {
  return {
    ...structuredClone(MOLARIUM_CONSTRAINT_DOCK_PROTOCOL),
    coreConstraint: {
      ...MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint,
      ...(overrides.coreConstraint || {}),
    },
    hydrogenBondConstraint: {
      ...MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint,
      ...(overrides.hydrogenBondConstraint || {}),
    },
    sampling: {
      ...MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.sampling,
      ...(overrides.sampling || {}),
      stages: [...(overrides.sampling?.stages || MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.sampling.stages)],
    },
  };
}

export function posePropagationProtocolSnapshot(overrides = {}) {
  const base = MOLARIUM_POSE_PROPAGATION_PROTOCOL;
  return {
    ...structuredClone(base),
    coreConstraint:{ ...base.coreConstraint, ...(overrides.coreConstraint || {}) },
    hydrogenBondConstraint:{
      ...base.hydrogenBondConstraint, ...(overrides.hydrogenBondConstraint || {}),
    },
    sampling:{
      ...base.sampling, ...(overrides.sampling || {}),
      stages:[...(overrides.sampling?.stages || base.sampling.stages)],
    },
  };
}
