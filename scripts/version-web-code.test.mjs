import assert from 'node:assert/strict';
import { webCodeVersion,versionWebCode } from './version-web-code.mjs';
const files=new Set(['app.js','runtime-config.js','style.css','nested/a.mjs','worker.js','leaf.js']);
const source=`import {x} from './nested/a.mjs'; import('./worker.js');
import './leaf.js'; self.importScripts('./leaf.js'); new Worker('./worker.js');
new URL('../app.js',import.meta.url); const text='./leaf.js';
import('https://external.test/leaf.js'); fetch('./model.json');`;
const revised=versionWebCode(source,'app.js',files,'abc');
assert.match(revised,/from '\.\/nested\/a.mjs\?v=abc'/);
assert.match(revised,/import\('\.\/worker.js\?v=abc'\)/);
assert.match(revised,/import '\.\/leaf.js\?v=abc'/);
assert.match(revised,/importScripts\('\.\/leaf.js\?v=abc'\)/);
assert.match(revised,/new Worker\('\.\/worker.js\?v=abc'\)/);
assert.match(revised,/const text='\.\/leaf.js'/);
assert.match(revised,/https:\/\/external.test\/leaf.js'/);
assert.match(revised,/fetch\('\.\/model.json'\)/);
assert.equal(versionWebCode(`import('../app.js?x=1#part')`,'nested/a.mjs',files,'abc'),
  `import('../app.js?x=1&v=abc#part')`);
assert.equal(versionWebCode('<script src="./app.js"></script><link href="style.css">','index.html',files,'abc'),
  '<script src="./app.js?v=abc"></script><link href="style.css?v=abc">');
const entries=[['app.js','import "./leaf.js"'],['leaf.js','old']];
assert.equal(webCodeVersion(entries),webCodeVersion([...entries].reverse()));
assert.notEqual(webCodeVersion(entries),webCodeVersion([entries[0],['leaf.js','new']]));
assert.equal(versionWebCode(source,'evidence.json',files,'abc'),source);
console.log('Release-versioned entry points, static/dynamic modules and worker references: PASS');
