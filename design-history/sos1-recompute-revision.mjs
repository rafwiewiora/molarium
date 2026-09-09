import { validateActionScript } from './replay.mjs';

export const SOS1_SOURCE_SHA256 = '7eed2dff0bf3fa127f87b2322aaea4b615d458ad6d8ef3af3c5b5886dc8fe9c3';
export const SOS1_CONTACT_RELEASE = Object.freeze({
  action:'pose.setContact',
  args:Object.freeze({ contactLabel:'AWW A1104 OX3 → TYR A884 O', required:false,
    ifAbsent:'record-omission' }),
  caption:'Release the old OX3–Tyr884 contact: the final edit removes OX3; retain the registered spatial-feature constraint',
  expect:Object.freeze({ required:false }),
});

// This is an authored scientific revision, NOT a presentation transformation.
// Keep the immutable source, original requests and numerical gates intact.
export function reviseSos1Recomputation(source, sourceSha256) {
  if (sourceSha256 !== SOS1_SOURCE_SHA256) throw new Error('Unrecognized SOS1 source for contact revision');
  validateActionScript(source);
  const indices = source.actions.flatMap((step, index) => step.action === 'designRoute.applyStep'
    && step.args?.stepId === 'finish-bay-293' ? [index] : []);
  if (source.actions.length !== 159 || indices.length !== 1)
    throw new Error('SOS1 final contact revision requires the original 159-action source');
  const revised = structuredClone(source);
  revised.actions.splice(indices[0] + 1, 0, structuredClone(SOS1_CONTACT_RELEASE));
  revised.scientificRevision = {
    id:'sos1-explicit-final-contact-release/v1', authorApprovedOn:'2026-09-09',
    sourceSha256, originalActionCount:159, revisedActionCount:160,
    finding:'reviews/SOS1_RECOMPUTE_REVIEW_2026-09-08.md#sr-07--final-edit-exposes-a-historical-implicit-contact-omission',
    decision:'Explicitly release only the obsolete OX3–Tyr884 requirement, matching the historical experiment. No replacement-amine hypothesis is introduced.',
  };
  return validateActionScript(revised);
}
