import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser } from './headless-chrome.mjs';

const root = resolve(import.meta.dirname, '..');
const browser = await startMolariumBrowser({
  root,
  appPath:'sos1-hit-to-bay293',
  width:1400,
  height:900,
});

const compactRecordExpression = `((entry) => {
  const result = entry?.result || {};
  const refinement = result.refinement || null;
  const appliedPose = result.appliedPose || null;
  const rotamer = result.appliedSidechainRotamer || result.sidechainRotamer || null;
  const optimization = result.optimization || null;
  return {
    sequence:entry?.sequence,
    requestId:entry?.requestId,
    action:entry?.action,
    status:entry?.status,
    durationMs:entry?.durationMs,
    error:entry?.error || null,
    molecule:result.molecule ? {
      atoms:result.molecule.atoms,
      bonds:result.molecule.bonds,
      name:result.molecule.name,
    } : null,
    designStep:result.designStep ? {
      id:result.designStep.id,
      stateId:result.designStep.stateId,
      commonHitHeavyAtoms:result.designStep.commonHitHeavyAtoms,
      productHeavyAtoms:result.designStep.productHeavyAtoms,
    } : null,
    refinement:refinement ? {
      candidates:refinement.candidates,
      feasible:refinement.feasible,
      selectedRank:refinement.selectedRank,
      coverageComplete:refinement.coverageComplete,
      selectedFeasible:refinement.selectedFeasible,
      selectedCore:refinement.selectedCore,
      requiredSpatialFeatureCount:refinement.requiredSpatialFeatureCount,
      inputStateSha256:refinement.inputStateSha256,
      selectedStateSha256:refinement.selectedStateSha256,
      inputCoordinateSha256:refinement.inputCoordinateSha256,
      selectedCoordinateSha256:refinement.selectedCoordinateSha256,
    } : null,
    appliedPose:appliedPose ? {
      index:appliedPose.index,
      rank:appliedPose.rank,
      feasible:appliedPose.feasible,
      infeasibleOverride:appliedPose.infeasibleOverride,
      inputStateSha256:appliedPose.inputStateSha256,
      outputStateSha256:appliedPose.outputStateSha256,
      maximumDisplacementAngstrom:appliedPose.maximumDisplacementAngstrom,
    } : null,
    rotamer:rotamer ? {
      residueId:rotamer.residueId,
      residueName:rotamer.residueName,
      rank:rotamer.rank,
      chi1Degrees:rotamer.chi1Degrees,
      feasible:rotamer.feasible,
      inputStateSha256:rotamer.inputStateSha256,
      outputStateSha256:rotamer.outputStateSha256,
    } : null,
    optimization:optimization ? {
      method:optimization.method,
      accepted:optimization.accepted,
      initialEnergy:optimization.initialEnergy,
      finalEnergy:optimization.finalEnergy,
      inputStateSha256:optimization.inputStateSha256,
      outputStateSha256:optimization.outputStateSha256,
      valenceAccepted:optimization.valenceSafeguard?.accepted,
      valenceComplete:optimization.valenceSafeguard?.complete,
      retentionAccepted:optimization.registeredPoseRetention?.accepted,
      fixedMotionAccepted:optimization.fixedAtomMotion?.accepted,
    } : null,
  };
})`;

try {
  const readyStarted = Date.now();
  while (Date.now() - readyStarted < 90_000) {
    const ready = await browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
      && !document.querySelector('#replay-designer-moves')?.disabled`);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(await browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
    && !document.querySelector('#replay-designer-moves')?.disabled`),
  'SOS1 executable story did not become ready');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);

  const seen = new Set();
  const started = Date.now();
  let terminal = null;
  while (Date.now() - started < 1_200_000) {
    const snapshot = await browser.evaluate(`(() => {
      const compact = ${compactRecordExpression};
      const interesting = new Set([
        'designRoute.applyStep', 'pose.refine', 'pose.apply',
        'pose.applySidechainRotamer', 'pose.updateReceptorReference',
        'protein.parameterize', 'optimization.run', 'session.inspect',
      ]);
      const history = window.MolariumChemistActions.history();
      return {
        replayStatus:document.querySelector('#designer-move-tools')?.dataset.replayStatus,
        progress:document.querySelector('#designer-move-progress-label')?.textContent?.trim(),
        caption:document.querySelector('#designer-move-caption')?.textContent?.trim(),
        detail:document.querySelector('#designer-move-detail')?.textContent?.trim(),
        records:history.filter((entry) => interesting.has(entry.action)
          && ['completed','failed'].includes(entry.status)).map(compact),
        failure:compact(history.filter((entry) => entry.status === 'failed').at(-1)),
      };
    })()`);
    for (const record of snapshot.records) {
      const key = `${record.sequence}:${record.status}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`SOS1_EXECUTABLE_CHECKPOINT ${JSON.stringify(record)}`);
      }
    }
    if (snapshot.replayStatus === 'completed' || snapshot.replayStatus === 'failed') {
      terminal = snapshot;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert(terminal, 'timed out before the executable route reached a terminal state');
  console.log(`SOS1_EXECUTABLE_TERMINAL ${JSON.stringify(terminal)}`);
  assert.notEqual(terminal.replayStatus, 'failed',
    `full executable route failed: ${terminal.failure?.action}: ${terminal.failure?.error}`);
  assert.equal(terminal.replayStatus, 'completed');
  const [completed, total] = terminal.progress.split('/').map((part) => Number(part.trim()));
  assert.equal(completed, total);
  console.log('SOS1 executable full-route browser regression: PASS');
} finally {
  await browser.close();
}
