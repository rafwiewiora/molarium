import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startMolariumBrowser,waitFor} from '/Users/bb/repos/marco/tmp/molarium-chemrxiv-v1/scripts/headless-chrome.mjs';
const root='/Users/bb/repos/marco/tmp/molarium-chemrxiv-v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const helperSha256=sha(await readFile(`${root}/scripts/headless-chrome.mjs`));
if(helperSha256!=='b55a1197a5c2d2a112ea0b46d233b32a1e7aa7e1c5f7c06f32217ea9c9b19d13')throw Error('Shared helper changed');
const b=await startMolariumBrowser({root,appPath:'vendor/foldarium/library-review.html',url:'https://molarium.org/vendor/foldarium/library-review'});
try{
 const records=new Map();
 await b.client.call('Network.enable');
 b.client.socket.addEventListener('message',event=>{
  const m=JSON.parse(event.data),p=m.params;
  if(m.method==='Network.requestWillBeSent'){
   const u=new URL(p.request.url);if(!['https:','http:'].includes(u.protocol))return;
   records.set(p.requestId,{method:p.request.method,url:u.origin+u.pathname,type:p.type});
  }else if(m.method==='Network.responseReceived'){
   const r=records.get(p.requestId);if(r){r.responseStatus=p.response.status;if(r.type==='Document')r.contentSecurityPolicy=Object.entries(p.response.headers).find(([k])=>k.toLowerCase()==='content-security-policy')?.[1]??null;}
  }else if(m.method==='Network.loadingFailed'){
   const r=records.get(p.requestId);if(r){r.loadingFailed=true;r.blockedReason=p.blockedReason??null;r.errorText=p.errorText;}
  }
 });
 const startedAt=new Date().toISOString();
 await b.client.call('Page.reload',{ignoreCache:true});
 await waitFor(()=>b.evaluate(`document.readyState==='complete'&&Boolean(document.querySelector('#import')?.onchange)`),30000,'canonical reviewer reload');
 await new Promise(resolve=>setTimeout(resolve,1500));
 const scripts=await b.evaluate(`Array.from(document.scripts,s=>s.src).filter(Boolean).map(src=>{const u=new URL(src);return u.origin+u.pathname})`);
 const requests=[...records.values()];
 const result={schema:'molarium.canonical-beacon-diagnostic.v1',startedAt,finishedAt:new Date().toISOString(),helperSha256,scope:'One empty production reviewer-page reload. Records whether extra script requests were blocked by CSP; no library imported, model call, query values, request/response bodies or analytics payloads captured. Account setting state is unobserved.',scripts,requests,extraOriginRequests:requests.filter(r=>!['https://molarium.org','https://assets.molarium.org'].includes(new URL(r.url).origin)),newNeuralForwards:0};
 await writeFile(new URL('./result.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({scripts,extraOriginRequests:result.extraOriginRequests}));
}finally{await b.close();}
