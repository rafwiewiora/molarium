/** A conservative development screen layered on top of contact feasibility. */
export function assessEnumeratedPose(refinement, {
  maximumAbsoluteStericClashes = 2,
  maximumAbsoluteLennardJonesKcalMol = 100,
} = {}) {
  const clashes = Number(refinement?.selectedPhysicalComponents?.stericClashes);
  const lennardJones = Number(refinement?.selectedPhysicalComponents?.lennardJonesKcalMol);
  const contactFeasible = Boolean(refinement?.selectedFeasible);
  const flags = [];
  if (!Number.isFinite(clashes)) flags.push('missing-steric-clash-count');
  else if (clashes > maximumAbsoluteStericClashes) flags.push('absolute-steric-clashes');
  if (!Number.isFinite(lennardJones)) flags.push('missing-lennard-jones-energy');
  else if (lennardJones > maximumAbsoluteLennardJonesKcalMol)
    flags.push('absolute-lennard-jones-clash');
  if (!contactFeasible) flags.push('required-contact-infeasible');
  return {
    schema:'molarium.enumeration-pose-screen/v1',
    verdict:!contactFeasible ? 'contact-infeasible'
      : flags.length ? 'contact-feasible-review-required' : 'development-screen-pass',
    contactFeasible, reviewRequired:flags.length > 0, flags,
    observed:{ absoluteStericClashes:Number.isFinite(clashes) ? clashes : null,
      absoluteLennardJonesKcalMol:Number.isFinite(lennardJones) ? lennardJones : null },
    thresholds:{ maximumAbsoluteStericClashes, maximumAbsoluteLennardJonesKcalMol },
    caveat:'This conservative development screen is not an affinity, binding, or clinical-quality criterion.',
  };
}
