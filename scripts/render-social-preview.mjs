// Render native HTML/CSS with the existing logo, not a generated molecular image.
// Run: bun scripts/render-social-preview.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
const html=await readFile(new URL('./social-preview.html',import.meta.url));
const mark=await readFile(new URL('../assets/molarium-mark.svg',import.meta.url));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request) {
  const path=new URL(request.url).pathname;
  if(path==='/') return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(path==='/mark.svg') return new Response(mark,{headers:{'Content-Type':'image/svg+xml'}});
  return new Response('Not found',{status:404});
}});
let browser;
try {
  browser=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`,width:1200,height:630});
  await waitFor(()=>browser.evaluate(`document.readyState==='complete'
    && Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0)`),15000,'artwork');
  await browser.evaluate('document.fonts.ready.then(()=>true)');
  await writeFile(new URL('../assets/molarium-social-v1.png',import.meta.url),await browser.capturePng());
  console.log('Rendered assets/molarium-social-v1.png (1200 × 630)');
} finally {await browser?.close();server.stop(true);}
