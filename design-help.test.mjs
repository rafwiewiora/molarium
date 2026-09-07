import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DESIGN_HELP, DESIGN_HELP_DYNAMIC} from './design-help.mjs';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function panelMarkup(id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf(`id="${nextId}"`, start + 1);
  assert.ok(start >= 0 && end > start, `${id} boundaries`);
  return html.slice(start, end);
}

test('all static Design controls have authored help; only file inputs and disclosure chrome are excluded', () => {
  const fragments = [panelMarkup('build-left-panel', 'run-left-panel'),
    panelMarkup('design-history-panel', 'run-right-panel'),
    panelMarkup('structure-2d-panel', 'structure-2d-drawing'),
    panelMarkup('preparation-settings', 'prepare-pdb')];
  const inspected = [];
  for (const fragment of fragments) {
    for (const [,tag,attrs] of fragment.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
      if (/type="file"|data-tool=|data-element=|data-2d-tool=/.test(attrs)) continue;
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (!id || ['structure-2d-toggle'].includes(id)) continue;
      assert.ok(DESIGN_HELP[id], `${tag}#${id} needs authored help`);
      inspected.push(id);
    }
  }
  assert.ok(inspected.length >= 65, `non-vacuous coverage: ${inspected.length}`);
});

test('every authored catalogue key names a real static control', () => {
  for (const [id,entry] of Object.entries(DESIGN_HELP)) {
    assert.match(html, new RegExp(`\\bid="${id}"`), id);
    assert.ok(entry.title.length >= 6 && entry.text.length >= 35, id);
    assert.ok(entry.text.length < 550, `${id} description should stay concise`);
  }
});

test('shared workspace parameter and action controls also have help; navigation chrome is explicit', () => {
  const navigationChrome = new Set(['network-policy-button', 'menu-button', 'load-toggle',
    'protein-fold-toggle', 'residue-follow-chip', 'changed-region-chip', 'structure-2d-toggle',
    'scene-toggle', 'components-toggle', 'preparation-inspector-toggle', 'close-project-info']);
  let controls = 0;
  for (const [,tag,attrs] of html.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (!id || /type="file"/.test(attrs) || navigationChrome.has(id)) continue;
    assert.ok(DESIGN_HELP[id], `${tag}#${id} needs shared help or an explicit reviewed exception`);
    controls++;
  }
  assert.ok(controls >= 140, `non-vacuous shared coverage: ${controls}`);
});

test('every static selector choice has a concise description, or explicitly dynamic candidate help', () => {
  const dynamic = new Set(['sidechain-rotamer-select', 'campaign-branch', 'campaign-merge-source',
    'ligand-protonation-state', 'result-replica-select', 'result-conformer-cv', 'result-conformer-y', 'result-conformer-select']);
  for (const [id,entry] of Object.entries(DESIGN_HELP)) {
    const match = html.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
    if (!match) continue;
    if (dynamic.has(id)) { assert.ok(entry.text.length); continue; }
    assert.ok(entry.choices, id);
    for (const [,attrs,text] of match[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)) {
      const value = /value="([^"]+)"/.exec(attrs)?.[1] || text;
      assert.ok(entry.choices[value]?.length, `${id}: ${value}`);
    }
  }
});

test('motion and contact policies stay distinct and visible', () => {
  const methods = DESIGN_HELP['build-optimizer-select'].choices;
  assert.match(DESIGN_HELP['docking-mode'].text, /protein fixed/);
  assert.match(DESIGN_HELP['docking-mode'].choices.propagate, /affected inherited atoms can move/);
  assert.match(methods['pocket-webgpu'], /5 Å.*entire ligand.*side chains/);
  assert.match(methods['pocket-webgpu'], /backbone.*stay fixed/);
  assert.match(methods['induced-fit-webgpu'], /6 Å.*backbone/);
  assert.match(methods['induced-fit-webgpu'], /retention islands.*stay fixed/);
  for (const name of ['pocket-webgpu','induced-fit-webgpu']) assert.match(methods[name], /H-bonds are NOT enforced/);
  assert.match(DESIGN_HELP['enumerate-sidechain-rotamers'].text, /not minimization/);
  assert.match(DESIGN_HELP['designer-ligand-pose-lock'].text, /stronger than propagation/);
  assert.match(html, /Protein fixed · required H-bonds enforced in this search/);
  assert.doesNotMatch(html, /Keeps unchanged ligand atoms fixed/);
  assert.doesNotMatch(app, /unchanged atoms fixed/);
  assert.match(app, /protected atoms fixed/);
});

test('dynamic options are covered and production initializes accessible help', () => {
  for (const selector of ['#element-grid [data-element]', '#fragment-grid .fragment-card',
    '#docking-hbond-list input[type="checkbox"]', '#docking-hbond-list .docking-contact-remap-select',
    '#docking-hbond-list .forget-docking-contact', '#docking-pose-list button'])
    assert.ok(DESIGN_HELP_DYNAMIC.some((entry) => entry.selector === selector));
  assert.match(app, /installDesignHelp\(document\)/);
  assert.match(app, /from '\.\/design-help\.mjs'/);
});
