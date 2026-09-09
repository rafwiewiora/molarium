import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const browser = await startMolariumBrowser({
  root:resolve(import.meta.dirname, '../..'), appPath:'?blank=1', width:1280, height:800,
});

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, 'Molarium API');
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ action:'designerScript.load', args:{ script:{
      schema:'molarium.chemist-action-script/v1',
      label:'Two-step completed-review fixture',
      actions:[
        { action:'view.setMode', args:{ mode:'view' }, caption:'Enter View' },
        { action:'view.setMode', args:{ mode:'build' }, caption:'Return to Design' }
      ]
    } } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'completed'`),
  30000, 'completed two-step story');

  const completed = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    const inspected = await api.execute({ action:'designerScript.inspect', args:{} });
    return {
      index:inspected.result.designerScript.index,
      review:inspected.result.designerScript.review,
      previousDisabled:document.querySelector('#previous-designer-move').disabled,
      nextDisabled:document.querySelector('#next-designer-move').disabled,
      label:document.querySelector('#replay-designer-moves').textContent,
      cueCount:document.querySelectorAll('.designer-move-cue').length,
      pressCount:document.querySelectorAll('.designer-move-press').length,
      changeCount:document.querySelectorAll('.designer-move-change').length,
      demoActive:document.body.classList.contains('designer-move-demo-active'),
    };
  })()`);
  assert.equal(completed.index, 2);
  assert.equal(completed.review.completed, true);
  assert.equal(completed.review.checkpointCount, 3);
  assert.equal(completed.previousDisabled, false);
  assert.equal(completed.nextDisabled, true);
  assert.equal(completed.cueCount, 0);
  assert.equal(completed.pressCount, 0);
  assert.equal(completed.changeCount, 0);
  assert.equal(completed.demoActive, false);
  assert.match(completed.label, /Replay story/);

  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '1 / 2'`),
  10000, 'completed-story previous checkpoint');
  assert.match(await browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent`), /Return to final/);

  const actionsBeforeReturn = await browser.evaluate(
    `window.MolariumChemistActions.history().map(record => record.action)`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '2 / 2'`),
  10000, 'return to final checkpoint');
  const afterReturn = await browser.evaluate(`({
    label:document.querySelector('#replay-designer-moves').textContent,
    actions:window.MolariumChemistActions.history().map(record => record.action),
    cueCount:document.querySelectorAll('.designer-move-cue').length,
    pressCount:document.querySelectorAll('.designer-move-press').length,
    changeCount:document.querySelectorAll('.designer-move-change').length,
    demoActive:document.body.classList.contains('designer-move-demo-active'),
  })`);
  assert.match(afterReturn.label, /Replay story/);
  assert.equal(afterReturn.cueCount, 0,
    'returning to the terminal checkpoint must not resurrect the final cue');
  assert.equal(afterReturn.pressCount, 0,
    'returning to the terminal checkpoint must not resurrect a pressed-control cue');
  assert.equal(afterReturn.changeCount, 0,
    'returning to the terminal checkpoint must not resurrect red change controls');
  assert.equal(afterReturn.demoActive, false,
    'returning to the terminal checkpoint must restore the cleared layout');
  assert.deepEqual(afterReturn.actions.slice(actionsBeforeReturn.length), ['designerScript.step']);
  assert.equal(afterReturn.actions.filter(action => action === 'view.setMode').length,
    actionsBeforeReturn.filter(action => action === 'view.setMode').length,
    'review navigation must restore checkpoints without rerunning constituent actions');

  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({action:'designerScript.load',args:{script:{
      schema:'molarium.chemist-action-script/v1',label:'Failure-caption regression',actions:[
        {action:'view.setMode',args:{mode:'build'},caption:'Successful setup'},
        {action:'pose.setContact',args:{contactId:'nonexistent',required:true},caption:'Actual failed contact declaration'},
        {action:'view.setMode',args:{mode:'view'},caption:'Unexecuted following step'}
      ]}}});
    await api.execute({action:'designerScript.play',args:{playing:true}});
  })()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'failed'`),
    30000, 'failed story caption');
  assert.equal(await browser.evaluate(`document.querySelector('#designer-move-caption').textContent`),
    'Actual failed contact declaration', 'failure must not display the following unexecuted action');
  assert.match(await browser.evaluate(`document.querySelector('#designer-move-detail').textContent`), /Stopped at move 2/);
  // Presentation-only probe: no candidate or energy execution is mocked.
  // The presenter must cue the same native button used by a manual operator.
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({action:'designerScript.load',args:{script:{
      schema:'molarium.chemist-action-script/v1',label:'Candidate presentation fixture',actions:[
        {action:'pose.applySidechainRotamer',args:{chiDegrees:[60,90]},
          expect:{'sidechainRotamer.residue.residueName':'PHE',
            'sidechainRotamer.residue.residueIndex':890},caption:'Apply trial orientation'},
        {action:'session.inspect',args:{scope:'ligand'},caption:'Record ligand coordinates'},
        {action:'calculation.run',args:{job:'energy',method:'openmm'},caption:'Measure candidate energy'},
        {action:'history.undo',args:{},caption:'Restore baseline'},
        {action:'pose.applySidechainRotamer',args:{chiDegrees:[-180,90]},caption:'Apply selected orientation'}
      ]}}});
    await api.execute({action:'interface.presentDesignerStep',args:{index:0,phase:'before'}});
  })()`);
  assert.equal(await browser.evaluate(`document.querySelector('#designer-move-caption').textContent`),
    'Compare Phe890 orientations · candidate 1 of 1');
  assert.equal(await browser.evaluate(`document.querySelector('#apply-sidechain-rotamer').classList.contains('designer-move-cue')`), true);
  assert.equal(await browser.evaluate(`document.querySelector('#designer-move-detail').textContent`), 'Apply trial orientation');
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({action:'interface.presentDesignerStep',args:{index:0,phase:'clear'}});
    await api.execute({action:'interface.presentDesignerStep',args:{index:1,phase:'before'}});
  })()`);
  assert.equal(await browser.evaluate(`document.querySelectorAll('.designer-move-cue').length`), 0,
    'an audit snapshot must not act out a manual button press');
  assert.equal(await browser.evaluate(`document.querySelector('#designer-move-caption').textContent`),
    'Compare Phe890 orientations · candidate 1 of 1');
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({action:'interface.presentDesignerStep',args:{index:4,phase:'before'}});
  })()`);
  assert.equal(await browser.evaluate(`document.querySelector('#designer-move-caption').textContent`),
    'Apply selected orientation');

  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({action:'designerScript.load',args:{script:{
      schema:'molarium.chemist-action-script/v1',label:'Replay input ownership',actions:[
        {action:'session.loadStructure',args:{content:'C',format:'smiles',polish:false}},
        {action:'view.setMode',args:{mode:'build'}},
        {action:'session.inspect',args:{}},
        {action:'session.inspect',args:{}}
      ]}}});
    await api.execute({action:'build.setTool',args:{tool:'add'}});
    await api.execute({action:'designerScript.play',args:{playing:true}});
  })()`);
  await waitFor(async () => browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    const r = await api.execute({action:'designerScript.inspect',args:{}});
    return r.result.designerScript.frontier >= 2;
  })()`), 30000, 'molecule ready in running replay');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return (await api.execute({action:'designerScript.inspect',args:{}})).result.designerScript.review.live;
  })()`), 10000, 'paused replay input lock');
  const countBeforeClick = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return (await api.execute({action:'session.inspect',args:{}})).result.molecule.atoms;
  })()`);
  assert(Number.isInteger(countBeforeClick) && countBeforeClick > 0);
  const coordinatesBeforeInput = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return (await api.execute({action:'session.inspect',args:{scope:'all',includeCoordinates:true}})).result.atoms;
  })()`);
  await browser.evaluate(`(() => {
    const canvas = document.querySelector('#molecule-canvas');
    const rect = canvas.getBoundingClientRect();
    for (const type of ['pointerdown','pointerup']) canvas.dispatchEvent(new PointerEvent(type,
      {clientX:rect.left+12,clientY:rect.top+12,button:0,pointerId:71,bubbles:true}));
    for (const [type,dx] of [['pointerdown',0],['pointermove',80],['pointerup',80]])
      canvas.dispatchEvent(new PointerEvent(type,
        {clientX:rect.left+100+dx,clientY:rect.top+100,button:0,pointerId:73,bubbles:true}));
    document.querySelector('#clear-button').click();
  })()`);
  await waitFor(async () => browser.evaluate(`document.querySelector('#notice').textContent.includes('Replay controls the molecular state')`),
    5000, 'manual clear refused');
  const protectedState = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return {atoms:(await api.execute({action:'session.inspect',args:{}})).result.molecule.atoms,
      hint:document.querySelector('#build-status').textContent,
      additions:api.history().filter(entry => entry.action === 'chemistry.addAtom').length};
  })()`);
  assert.equal(protectedState.atoms, countBeforeClick);
  assert.equal(protectedState.additions, 0, 'a replay canvas click must not enqueue a methane addition');
  assert.match(protectedState.hint, /Replay controls molecular edits/);
  assert.deepEqual(await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return (await api.execute({action:'session.inspect',args:{scope:'all',includeCoordinates:true}})).result.atoms;
  })()`), coordinatesBeforeInput, 'camera gestures cannot move molecular coordinates during replay');
  assert(await browser.evaluate(`window.MolariumChemistActions.history().some(entry => entry.action === 'view.setCamera' && entry.status === 'completed')`),
    'camera rotation must remain usable');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(`document.querySelector('#designer-move-tools').dataset.replayStatus === 'completed'`),
    15000, 'protected replay can still complete');
  await browser.evaluate(`(() => {
    const canvas = document.querySelector('#molecule-canvas');
    const rect = canvas.getBoundingClientRect();
    for (const type of ['pointerdown','pointerup']) canvas.dispatchEvent(new PointerEvent(type,
      {clientX:rect.left+12,clientY:rect.top+12,button:0,pointerId:72,bubbles:true}));
  })()`);
  await waitFor(async () => browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return api.history().some(entry => entry.action === 'chemistry.addAtom' && entry.status === 'completed');
  })()`), 15000, 'ordinary manual addition available after replay');
  assert.equal(await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    return (await api.execute({action:'session.inspect',args:{}})).result.molecule.atoms;
  })()`), countBeforeClick + 5, 'one ordinary empty-space carbon click adds C plus four H');
  console.log('Completed Designer Moves review and failed-step caption browser tests: PASS');
} finally {
  await browser.close();
}
