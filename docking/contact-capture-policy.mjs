export const CONTACT_CAPTURE_POLICY = Object.freeze({
  schema:'molarium.docking.contact-capture-policy/v1',
  id:'ordinary-anchors-with-optional-covalent-fluorine/v1',
  organicFluorine:'weak-hypothesis-optional-by-default',
  sources:Object.freeze([
    'https://doi.org/10.1002/chem.19970030115',
    'https://github.com/rdkit/rdkit/blob/a31fcbf1abb323d56d2638c0e39d631fcb318aee/Data/BaseFeatures.fdef',
  ]),
});

// Keep feature signatures and explicit designer hypotheses intact. This is a
// capture/default-selection policy, not a new force field or acceptor typer.
export function capturedContactDefault(molecule, acceptorAtomIndex) {
  const acceptor = molecule.atoms[acceptorAtomIndex];
  const neighbors = (index) => molecule.bonds.flatMap((bond) =>
    bond.a === index ? [bond.b] : bond.b === index ? [bond.a] : []);
  const carbonIndex = acceptor?.element === 'F'
    ? neighbors(acceptorAtomIndex).find((index) => molecule.atoms[index]?.element === 'C')
    : undefined;
  if (!Number.isInteger(carbonIndex)) return { required:true,
    capturePolicy:CONTACT_CAPTURE_POLICY.id, evidenceClass:'ordinary-hydrogen-bond-hypothesis' };
  const otherHalogenNeighbors = neighbors(carbonIndex).filter((index) =>
    index !== acceptorAtomIndex && ['F','Cl','Br','I'].includes(molecule.atoms[index]?.element));
  return { required:false, capturePolicy:CONTACT_CAPTURE_POLICY.id,
    evidenceClass:'weak-covalent-fluorine-hypothesis',
    warning:'Covalent fluorine is not an ordinary strong H-bond anchor; require it only as an explicit design hypothesis.',
    conventionalAcceptorHeuristic:otherHalogenNeighbors.length
      ? 'outside-rdkit-carbon-with-no-other-halogen-neighbors'
      : 'within-rdkit-carbon-with-no-other-halogen-neighbors' };
}
