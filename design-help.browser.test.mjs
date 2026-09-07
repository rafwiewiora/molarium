import assert from 'node:assert/strict';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESIGN_HELP} from './design-help.mjs';
import {startMolariumBrowser,waitFor} from './scripts/headless-chrome.mjs';

// Isolated CI browser, separate from the hands-on browser-control evidence.
const root = dirname(fileURLToPath(import.meta.url));
const browser = await startMolariumBrowser({root, appPath:'index.html'});
const checks = [];
function check(condition, description, detail = '') {
  assert.ok(condition, `${description}${detail ? `: ${detail}` : ''}`);
  checks.push(description);
}
try {
  await waitFor(() => browser.evaluate(`Boolean(document.querySelector('#design-option-help')
    && document.querySelector('#info-smiles').textContent.length > 10)`), 60000, 'workspace/help ready');
  await browser.evaluate(`(async () => {
    const actions=await window.MolariumChemistActionsReady;
    await actions.execute({action:'view.setMode',args:{mode:'build'}});
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  })()`);
  const coverage = await browser.evaluate(`(() => {
    const ids=${JSON.stringify(Object.keys(DESIGN_HELP))};
    return {missing:ids.filter(id=>{
      const control=document.getElementById(id);
      const help=control?.closest('.design-help-control')?.querySelector(':scope > .design-info-button');
      return !help || help.getAttribute('aria-controls')!=='design-option-help'
        || help.getAttribute('aria-haspopup')!=='dialog' || help.disabled;
    }), count:document.querySelectorAll('.design-info-button').length,
    labelSafe:!document.querySelector('#chemistry-element').labels[0].textContent.includes('About')};
  })()`);
  check(coverage.missing.length===0, `all ${Object.keys(DESIGN_HELP).length} static controls have enabled, associated help`, coverage.missing.join(', '));
  check(coverage.labelSafe, 'help does not pollute chemical field labels');
  const layout = await browser.evaluate(`(() => {
    const code=document.querySelector('#info-smiles').getBoundingClientRect();
    const panel=document.querySelector('#structure-2d-panel').getBoundingClientRect();
    const toolbar=document.querySelector('.viewer-toolbar').getBoundingClientRect();
    const tools=[...document.querySelectorAll('#build-tool-tabs [data-tool]')].map(b=>({
      height:b.getBoundingClientRect().height,nowrap:getComputedStyle(b).whiteSpace==='nowrap'}));
    return {smilesWidth:code.width,toolbarClear:panel.bottom<=toolbar.top
      ||panel.right<=toolbar.left||panel.left>=toolbar.right,
      toolsAligned:tools.every(t=>t.nowrap&&t.height===tools[0].height)};
  })()`);
  check(layout.smilesWidth>60&&layout.toolbarClear&&layout.toolsAligned,
    'help keeps SMILES readable, tool labels unwrapped, and the 2D panel clear of toolbar actions', JSON.stringify(layout));
  const before = await browser.evaluate(`JSON.stringify({
    smiles:document.querySelector('#info-smiles').textContent,
    atoms:document.querySelector('#info-atoms').textContent,
    optimizer:document.querySelector('#build-optimizer-select').value,
    checkbox:document.querySelector('#move-connected').checked,
    tool:document.querySelector('#build-tool-tabs [data-tool].selected').dataset.tool})`);
  const keyboardTarget = await browser.evaluate(`(() => {const b=document.querySelector('[data-design-help-trigger="build-optimizer-select"]'); b.focus();return {focused:document.activeElement===b, visible:b.checkVisibility(),mode:document.querySelector('[data-mode].active')?.dataset.mode};})()`);
  await browser.client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await browser.client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const method = await browser.evaluate(`(() => {const d=document.querySelector('#design-option-help');return {
    open:d.open,text:d.innerText,terms:d.querySelectorAll('dt').length,
    top:d.scrollTop,focusInside:d.contains(document.activeElement)};})()`);
  check(method.open&&method.focusInside&&method.top===0, 'keyboard Enter opens help at its beginning with focus inside', JSON.stringify({method,keyboardTarget}));
  check(method.terms===6&&method.text.includes('unavailable here')
    &&method.text.includes('5 Å pocket')&&method.text.includes('6 Å pocket')
    &&method.text.includes('H-bonds are NOT enforced'), 'all six optimizer choices include truthful differences and availability');
  await browser.client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await browser.client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(() => browser.evaluate(`!document.querySelector('#design-option-help').open
    && document.activeElement.dataset.designHelpTrigger==='build-optimizer-select'
    && document.activeElement.getAttribute('aria-expanded')==='false'`), 20000, 'dialog close event and focus restoration');
  check(true, 'Escape closes help and restores trigger focus');
  await browser.evaluate(`document.querySelector('[data-design-help-trigger="designer-ligand-pose-lock"]').click()`);
  check(await browser.evaluate(`document.querySelector('#design-option-help').innerText.includes('currently unavailable')`), 'disabled actions retain accessible prerequisite help');
  await browser.evaluate(`document.querySelector('#design-option-help .soft-button').click();
    document.querySelector('[data-design-help-trigger="move-connected"]').click();
    document.querySelector('#design-option-help .soft-button').click();`);
  const after = await browser.evaluate(`JSON.stringify({
    smiles:document.querySelector('#info-smiles').textContent,
    atoms:document.querySelector('#info-atoms').textContent,
    optimizer:document.querySelector('#build-optimizer-select').value,
    checkbox:document.querySelector('#move-connected').checked,
    tool:document.querySelector('#build-tool-tabs [data-tool].selected').dataset.tool})`);
  check(before===after,'help does not change chemistry, selected optimizer/tool or checkbox');
  await browser.evaluate(`const input=document.querySelector('#fragment-search');input.value='phenyl';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await waitFor(() => browser.evaluate(`document.querySelectorAll('#fragment-grid .fragment-card').length===1
    &&document.querySelectorAll('#fragment-grid .design-info-button').length===1`));
  check(true,'dynamic fragment rerender retains exactly one help button per template');
  await browser.client.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.evaluate(`document.querySelector('[data-design-help-trigger="build-optimizer-select"]').click()`);
  const mobile = await browser.evaluate(`(() => {
    const d=document.querySelector('#design-option-help'),r=d.getBoundingClientRect();
    return {within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
      titleVisible:d.querySelector('h2').getBoundingClientRect().top>=r.top,
      closeVisible:d.querySelector('button').getBoundingClientRect().top>=r.top};})()`);
  check(mobile.within&&mobile.titleVisible&&mobile.closeVisible,'mobile help fits the viewport with heading and close control initially visible');
  console.log(JSON.stringify({schema:'molarium.option-help-ui-test/v1',passed:checks.length,
    staticControls:Object.keys(DESIGN_HELP).length,renderedHelpButtons:coverage.count,checks},null,2));
} finally { await browser.close(); }
