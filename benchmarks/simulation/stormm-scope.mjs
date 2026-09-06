// This reviewed subset is fixed independently of the measured results. Keep
// every case in the full packet and expose unsupported cases explicitly.
export const STORMM_CASES=Object.freeze([
  ...['bonds','angles','torsions','lj','coulomb','nonbonded','improper','total','obc2']
    .map(term=>`analytic-${term}`),'zero-forces',
  ...['bonds','angles','torsions','lj','coulomb'].map(term=>`trpcage-${term}`),
  ...['original','perturbed','translated-500A'].flatMap(snapshot=>
    ['vacuum','obc2'].map(solvent=>`trpcage-${snapshot}-${solvent}`)),
  'trpcage-hbonds-obc2',
]);
export function stormmUnsupportedReason(c) {
  const reasons=[];
  if(c.molecule.atoms.length>512)reasons.push('Current production kernel is capped at 512 atoms per replica');
  if(Number(c.options.nonbondedCutoffNm||c.options.cutoffNm||0)!==0)
    reasons.push('Nonzero cutoff is unsupported by the nonperiodic all-pairs kernel');
  return reasons.length?reasons.join('; '):null;
}
