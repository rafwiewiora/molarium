import { readPanelManifest } from './7kpa-two-terminus-panel.mjs';

const allContactKeys = ['pyridoneDonor', 'pyrrolidoneAcceptor',
  'benzimidazoleAcceptor', 'pyridoneAcceptor'];

function policies(omitted = []) {
  return { requiredContacts:allContactKeys.filter((key) => !omitted.includes(key)),
    omittedContacts:[...omitted] };
}

export const manualContactCases = [
  {
    id:'pyridone-carbonyl-manual-recapture', locus:'pyridone',
    name:'Rebuilt pyridone carbonyl', intendedRoles:['acceptor','donor'],
    operations:[
      { op:'deleteAtom', atom:'O3' }, { op:'finish' },
      { op:'forgetContact', contact:'pyridoneAcceptor' },
      { op:'addAtom', attachedTo:'C28', element:'O', as:'pydCarbonylO' },
      { op:'setBond', atoms:['C28','pydCarbonylO'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyridoneAcceptor', ligandAtom:'pydCarbonylO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'bae89f37c54b7e81ab28c340d746c3150f4792ef64a4d78e900283350b5e1923',
    risks:['Stable atom identity is deliberately broken and must not silently preserve the old contact.'],
  },
  {
    id:'pyridone-thione-manual-recapture', locus:'pyridone',
    name:'Rebuilt 2-thiopyridone', intendedRoles:['acceptor','donor'],
    operations:[
      { op:'deleteAtom', atom:'O3' }, { op:'finish' },
      { op:'forgetContact', contact:'pyridoneAcceptor' },
      { op:'addAtom', attachedTo:'C28', element:'S', as:'pydThioneS' },
      { op:'setBond', atoms:['C28','pydThioneS'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyridoneAcceptor', ligandAtom:'pydThioneS',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'c9a04c6b07f7fbd5f4ae2c17ee75926219ef6e2b5ffe98df1370960b5b24de9e',
    risks:['Thione geometry and sulfur parameters may be less transferable than the parent carbonyl.'],
  },
  {
    id:'pyridone-cyclohexanone-manual-recapture', locus:'pyridone',
    name:'Cyclohexanone with rebuilt acceptor', intendedRoles:['acceptor'],
    operations:[
      { op:'setBond', atoms:['C26','C27'], order:1 },
      { op:'setBond', atoms:['C29','C30'], order:1 }, { op:'finish' },
      { op:'setAtom', atom:'N3', element:'C', formalCharge:0 }, { op:'finish' },
      { op:'deleteAtom', atom:'O3' }, { op:'finish' },
      { op:'forgetContact', contact:'pyridoneAcceptor' },
      { op:'addAtom', attachedTo:'C28', element:'O', as:'cyclohexanoneO' },
      { op:'setBond', atoms:['C28','cyclohexanoneO'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyridoneAcceptor', ligandAtom:'cyclohexanoneO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(['pyridoneDonor']), expectedProductGraphSha256:'3e7530fce7eab58c0382893c5e82f38e40cf4a23bc2d58ddfc11b73a99081eb6',
    risks:['Ring puckering is a large conformational change and may make the inherited pocket pose strained.'],
  },
  {
    id:'pyridone-sultam-manual-recapture', locus:'pyridone',
    name:'Cyclic sulfonamide (sultam)', intendedRoles:['acceptor','donor'],
    operations:[
      { op:'deleteAtom', atom:'O3' }, { op:'finish' },
      { op:'forgetContact', contact:'pyridoneAcceptor' },
      { op:'setAtom', atom:'C28', element:'S', formalCharge:0 },
      { op:'addAtom', attachedTo:'C28', element:'O', as:'sultamOa' },
      { op:'setBond', atoms:['C28','sultamOa'], order:2 },
      { op:'addAtom', attachedTo:'C28', element:'O', as:'sultamOb' },
      { op:'setBond', atoms:['C28','sultamOb'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyridoneAcceptor', ligandAtom:'sultamOa',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'d74cabb6f6206e913dbce2a2ec4e4690a1b825630623b9c45843d240ac92265d',
    risks:['S(VI) valence and two symmetry-related acceptors stress typing and alternative handling.'],
  },
  {
    id:'pyrrolidone-carbonyl-manual-recapture', locus:'pyrrolidone',
    name:'Rebuilt pyrrolidone carbonyl', intendedRoles:['acceptor'],
    operations:[
      { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'addAtom', attachedTo:'C19', element:'O', as:'proCarbonylO' },
      { op:'setBond', atoms:['C19','proCarbonylO'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'proCarbonylO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'e243f06cf78730ebef71063e0c4fd75459d320bc98a033229c85933210b6a272',
    risks:['Stable atom identity is deliberately broken and must be explicitly recaptured.'],
  },
  {
    id:'pyrrolidone-thione-manual-recapture', locus:'pyrrolidone',
    name:'Rebuilt 2-thiopyrrolidone', intendedRoles:['acceptor'],
    operations:[
      { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'addAtom', attachedTo:'C19', element:'S', as:'proThioneS' },
      { op:'setBond', atoms:['C19','proThioneS'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'proThioneS',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'a39539988db0aa36f6dd2dc24d4a4ec82e497c773c80fc18a887b02d2a7805a6',
    risks:['The larger sulfur acceptor may require a different donor distance than oxygen.'],
  },
  {
    id:'pyrrolidone-pyrazole-manual-recapture', locus:'pyrrolidone',
    name:'N-linked pyrazole recapture', intendedRoles:['acceptor'],
    operations:[
      { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'setAtom', atom:'C19', element:'N', formalCharge:0 },
      { op:'setBond', atoms:['C19','C18'], order:2 },
      { op:'setBond', atoms:['C17','C16'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'C19',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'5bbf0f9412c26c5b077e4ecf6309bdca2ac3d411c1f00ed17ed186befca803c0',
    risks:['A heteroaromatic replacement breaks more of the local MCS and changes ring electronics.'],
  },
  {
    id:'pyrrolidone-thp-manual-recapture', locus:'pyrrolidone',
    name:'Ring-expanded tetrahydropyran recapture', intendedRoles:['acceptor'],
    operations:[
      { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'setAtom', atom:'N1', element:'C', formalCharge:0 },
      { op:'setAtom', atom:'C19', element:'O', formalCharge:0 },
      { op:'deleteBond', atoms:['C18','C19'] },
      { op:'addAtom', attachedTo:'C18', element:'C', as:'thpBridge' },
      { op:'createBond', atoms:['thpBridge','C19'], order:1 }, { op:'finish' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'C19',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'9c04f1989866f3912847ba7ebe35b7211155503053434e4e8a7b27d77a3bafb0',
    risks:['Ring expansion changes topology, atom count, and preferred chair conformer.'],
  },
  {
    id:'pyrrolidone-imidazolidinone-manual-recapture', locus:'pyrrolidone',
    name:'Cyclic urea with rebuilt carbonyl', intendedRoles:['acceptor','donor'],
    operations:[
      { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'setAtom', atom:'C18', element:'N', formalCharge:0 }, { op:'finish' },
      { op:'addAtom', attachedTo:'C19', element:'O', as:'ureaCarbonylO' },
      { op:'setBond', atoms:['C19','ureaCarbonylO'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'ureaCarbonylO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'5f1d533a5ed30f9f51502eed704edc064c634f0c491bfe4889b35e3c047fd97d',
    risks:['The added ring nitrogen introduces a donor and changes the local tautomer landscape.'],
  },
  {
    id:'dual-carbonyl-manual-recapture', locus:'dual',
    name:'Both terminal carbonyls rebuilt', intendedRoles:['acceptor','donor'],
    operations:[
      { op:'deleteAtom', atom:'O3' }, { op:'deleteAtom', atom:'O2' }, { op:'finish' },
      { op:'forgetContact', contact:'pyridoneAcceptor' },
      { op:'forgetContact', contact:'pyrrolidoneAcceptor' },
      { op:'addAtom', attachedTo:'C28', element:'O', as:'dualPydO' },
      { op:'setBond', atoms:['C28','dualPydO'], order:2 },
      { op:'addAtom', attachedTo:'C19', element:'O', as:'dualProO' },
      { op:'setBond', atoms:['C19','dualProO'], order:2 }, { op:'finish' },
      { op:'addContact', contact:'pyridoneAcceptor', ligandAtom:'dualPydO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
      { op:'addContact', contact:'pyrrolidoneAcceptor', ligandAtom:'dualProO',
        ligandRole:'acceptor', receptorParticipant:'donor' },
    ], ...policies(), expectedProductGraphSha256:'d5c23a44413bd34a49065f7ed04c1cc9eb9a611bb9a6c193eabb65f5f7dd9ea1',
    risks:['Two simultaneous identity breaks stress independent contact amendments and replay ordering.'],
  },
];

export async function buildManualContactPanelManifest() {
  const { manifest:baseline } = await readPanelManifest();
  return {
    schemaVersion:1,
    panelId:'molarium-7kpa-d84-manual-contact-recapture',
    version:'0.1.0', status:'preregistered-development',
    profile:'manual-contact-recapture',
    purpose:'Delete captured 7KPA D84 pharmacophore features, explicitly forget their obsolete H-bond hypotheses, rebuild same- and cross-class replacements through public Chemist Actions, assert new contacts, and refine with feature-biased sampling.',
    reference:baseline.reference, referenceContacts:baseline.referenceContacts,
    protocol:{ id:'7kpa-manual-contact-recapture-public-chemist-actions', version:'0.1.0',
      searchChains:8, replays:2,
      determinism:'Every mutation, Finish, forgotten contact, added contact, and pose refinement uses the public audited Chemist Actions API.',
      requiredMeasurements:[...baseline.protocol.requiredMeasurements,
        'contact-amendment-history', 'manual-contact-origin', 'feature-biased-refinement'],
    },
    cases:structuredClone(manualContactCases),
  };
}
