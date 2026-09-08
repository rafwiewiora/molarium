import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const fn = source.split('function update2DHighlightOverlay() {')[1].split('\nfunction update2DEditorUi()')[0];

test('depiction retains attached hydrogens and heavy-atom order without editing the source graph', () => {
  const body = source.split('function depictionInputWithHydrogens(molecule, heavyIndices) {')[1]
    .split('\nfunction depictionTarget(')[0];
  const molecule = { name:'N-H fixture', atoms:[
    {element:'H',x:1},{element:'N',x:2},{element:'C',x:3},
    {element:'O',x:4},{element:'H',x:5}],
    bonds:[{a:0,b:1,order:1},{a:1,b:2,order:1.5},{a:3,b:4,order:1}] };
  const before = JSON.stringify(molecule);
  const context = vm.createContext({molecule});
  vm.runInContext('function depictionInputWithHydrogens(molecule, heavyIndices) {'+body,context);
  const output = vm.runInContext('depictionInputWithHydrogens(molecule, [2,1])',context);
  assert.deepEqual(Array.from(output.atoms, a => a.element), ['C','N','H']);
  assert.deepEqual(JSON.parse(JSON.stringify(output.bonds)), [{a:2,b:1,order:1},{a:1,b:0,order:1.5}]);
  output.atoms[0].x = 900; output.bonds[0].order = 3;
  assert.equal(JSON.stringify(molecule), before);
});

test('2D highlights use persistent IDs, include only depicted heavy atoms, and clear cleanly', () => {
  class Node {
    children = []; attributes = {}; hidden = false;
    classList = { add:() => { this.hidden = true; }, remove:() => { this.hidden = false; } };
    setAttribute(k, v) { this.attributes[k] = v; }
    appendChild(n) { this.children.push(n); }
    querySelectorAll() { return this.children.map(n => ({ remove:() => { this.children = this.children.filter(c => c !== n); } })); }
  }
  const svg = new Node(), legend = new Node();
  const state = { emphasizedAtomIds:['b','c','hydrogen','receptor'],
    depictionGlobalAtomIndices:[0,1,2,3], depictionGlobalBondPairs:[[0,1],[1,2],[2,3]],
    molecule:{atoms:[{designAtomId:'a',element:'C'}, {designAtomId:'b',element:'C'},
      {designAtomId:'c',element:'O'}, {designAtomId:'hydrogen',element:'H'},
      {designAtomId:'receptor',element:'C'}]} };
  const context = vm.createContext({ state, document:{
    querySelector:s => s.includes('legend') ? legend : svg,
    createElementNS:() => new Node(),
  }, depictionAtomPoint:(_, i) => ({x:i*10,y:20}) });
  vm.runInContext('function update2DHighlightOverlay() {'+fn, context);
  const before = JSON.stringify(state);
  vm.runInContext('update2DHighlightOverlay()', context);
  assert.equal(JSON.stringify(state), before, 'highlighting cannot mutate molecular state');
  assert.equal(legend.textContent, 'Orange: highlighted region (2 atoms)');
  assert.equal(svg.children.length, 1);
  const nodes = svg.children[0].children;
  assert.equal(nodes.length, 3, 'two circles and the bond joining highlighted atoms');
  assert.deepEqual(nodes.slice(1).map(n => n.attributes['data-highlight-atom-id']), ['b','c']);
  state.emphasizedAtomIds = [];
  vm.runInContext('update2DHighlightOverlay()', context);
  assert.equal(svg.children.length, 1, 'old overlays are removed, not accumulated');
  assert.equal(svg.children[0].children.length, 0);
  assert.equal(legend.hidden, true);
});

test('highlight refresh follows RDKit alignment and public highlight clearing; enlarge is a real control', () => {
  assert.match(source, /: alignDepictionToPrevious\(svg, target\);\s+update2DHighlightOverlay\(\);/);
  assert.match(source, /function updateChangedRegionChip\(\) \{\s+update2DHighlightOverlay\(\);/);
  assert.match(source, /#structure-2d-enlarge.*addEventListener\('click'/);
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /id="structure-2d-enlarge"[^>]*aria-pressed="false"/);
});

test('atom-1 does not borrow bond endpoints from atom-10 or atom-11', () => {
  const body = source.split('function depictionAtomPoint(svg, atomIndex) {')[1]
    .split('\nfunction selectDepictionAtom(')[0];
  class Geometry {
    constructor(classes, x) { this.classList=classes; this.x=x; }
    getTotalLength() { return 10; }
    getPointAtLength(t) { return {x:this.x+t,y:15}; }
  }
  const svg={ querySelectorAll:() => [new Geometry(['bond-0','atom-1','atom-2'],5),
    new Geometry(['bond-9','atom-10','atom-11'],1000)] };
  const context=vm.createContext({svg, SVGGeometryElement:Geometry, SVGGraphicsElement:class {},
    state:{depictionGlobalAtomIndices:[0,1],molecule:{atoms:[{element:'C'},{element:'C'}]}},
    depictionGraphicsPointInRoot:(_svg,_node,point)=>point});
  vm.runInContext('function depictionAtomPoint(svg, atomIndex) {'+body,context);
  const point=vm.runInContext('depictionAtomPoint(svg, 1)',context);
  assert.equal(point.x,5);
  assert.equal(point.y,15);
});

test('changing a panel while reviewing keeps the completed move caption, not the next move', () => {
  const body=source.split('function designerMoveCaption(index = state.designerMoveReplayIndex) {')[1]
    .split('\nfunction resetDesignerMovePlayback()')[0];
  const context=vm.createContext({state:{designerMoveReplayIndex:1,
    designerMoveScript:{actions:[{caption:'Current chemistry'},{caption:'Next chemistry'}]}},
    currentDesignerReplayReviewState:()=>({available:true}),
    sos1StoryCaption:(_,step)=>step.caption});
  vm.runInContext('function designerMoveCaption(index = state.designerMoveReplayIndex) {'+body,context);
  assert.equal(vm.runInContext('designerMoveCaption()',context),'Current chemistry');
  assert.equal(vm.runInContext('designerMoveCaption(2)',context),'Next chemistry');
});
