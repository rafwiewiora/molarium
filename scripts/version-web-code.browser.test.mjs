import assert from 'node:assert/strict';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { versionWebCode, webCodeVersion } from './version-web-code.mjs';

// Two releases at the same origin, with browser caching deliberately enabled.
// This uses a fresh isolated test profile, never the user's browser profile.
const files=new Set(['app.js','leaf.mjs','worker.js']);
let release='old';
const seen=[];
const server=Bun.serve({port:0,fetch(request) {
  const url=new URL(request.url);
  const sources=new Map([
    ['app.js',`import {value} from './leaf.mjs'; document.body.dataset.module=value;
      const worker=new Worker(new URL('./worker.js',import.meta.url));
      worker.onmessage=e=>document.body.dataset.worker=e.data;`],
    ['leaf.mjs',`export const value=${JSON.stringify(release)};`],
    ['worker.js',`postMessage(${JSON.stringify(release)});`],
  ]);
  const version=webCodeVersion(sources);
  if(url.pathname==='/') return new Response(versionWebCode(
    '<body><script type="module" src="./app.js"></script></body>',
    'index.html',files,version),{headers:{'Content-Type':'text/html','Cache-Control':'no-cache'}});
  const path=url.pathname.slice(1);
  if(!sources.has(path)) return new Response('Not found',{status:404});
  seen.push({path,version:url.searchParams.get('v'),release});
  return new Response(versionWebCode(sources.get(path),path,files,version),{
    headers:{'Content-Type':'text/javascript','Cache-Control':'public,max-age=14400'}});
}});
let browser;
try {
  browser=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
  for(const expected of ['old','new']) {
    if(expected==='new') {
      release='new';
      await browser.client.call('Page.reload',{ignoreCache:false});
    }
    await waitFor(()=>browser.evaluate(`document.body.dataset.module===${JSON.stringify(expected)}
      && document.body.dataset.worker===${JSON.stringify(expected)}`),15000,`${expected} code`);
  }
  for(const path of files) {
    const old=seen.find(x=>x.path===path&&x.release==='old');
    const fresh=seen.find(x=>x.path===path&&x.release==='new');
    assert.ok(old?.version&&fresh?.version,`${path}: both releases requested`);
    assert.notEqual(old.version,fresh.version,`${path}: changed release URL`);
  }
  console.log('Warm-cache normal reload loads new entry, transitive module and worker: PASS');
} finally {await browser?.close();server.stop(true);}
