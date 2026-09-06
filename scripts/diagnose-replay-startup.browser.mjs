// Isolated diagnostic for the intermittent first-checkpoint navigation hang.
// No scientific coordinates or hashes are changed; capture only operation state.
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..');
const browser=await startMolariumBrowser({root,appPath:'?blank'});
try {
  await browser.client.call('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
    const trace=[];window.__replayStartupTrace=trace;
    let sequence=0;
    const start=(kind,detail)=>{const item={id:++sequence,kind,detail,start:performance.now()};
      trace.push(item);return item;};
    const wrapPromise=(promise,item)=>promise.then(value=>{item.end=performance.now();return value;},
      error=>{item.error=String(error);item.end=performance.now();throw error;});
    const fetchOriginal=window.fetch;
    window.fetch=function(...args){return wrapPromise(fetchOriginal.apply(this,args),start('fetch',String(args[0])));};
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest=(...args)=>wrapPromise(digest(...args),start('digest',args[1]?.byteLength));
    const readerRead=ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read=function(...args){
      return wrapPromise(readerRead.apply(this,args),start('stream.read',null));};
    const trackRequest=(request,item)=>{
      for(const event of ['success','error','blocked','upgradeneeded'])request.addEventListener(event,()=>{
        item[event]=performance.now();if(event==='error')item.error=String(request.error);});return request;};
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(...args)=>{
      const request=trackRequest(open(...args),start('idb.open',args));
      if (${process.env.MOLARIUM_REPLAY_UPGRADE_RACE === '1'}
          && new URLSearchParams(location.search).get('story')==='sos1-hit-to-bay293')
        request.addEventListener('upgradeneeded',()=>{
          location.href='/?story=sos1-hit-to-bay293-review';
        },{once:true});
      return request;
    };
    for(const method of ['get','put']){
      const original=IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method]=function(...args){
        return trackRequest(original.apply(this,args),start('idb.'+method,this.name));};
    }
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){
      const item=start('idb.transaction',args),tx=transaction.apply(this,args);
      for(const event of ['complete','error','abort'])tx.addEventListener(event,()=>{item[event]=performance.now();});
      return tx;};
  })();`});
  const origin=new URL(browser.appUrl).origin;
  const snapshots=[];
  for(let attempt=1;attempt<=3;attempt++) {
    await browser.client.call('Page.navigate',{url:`${origin}/sos1-hit-to-bay293`});
    await waitFor(()=>browser.evaluate(`window.MolariumChemistActions?.history()
      .some(e=>e.action==='designerScript.loadRegistered'&&e.status==='completed'
        &&e.result?.registeredDesignerScript?.storyId==='sos1-hit-to-bay293')`),30000,'recomputable story');
    if(process.env.MOLARIUM_REPLAY_UPGRADE_RACE!=='1')
      await browser.client.call('Page.navigate',{url:`${origin}/sos1-hit-to-bay293/review`});
    await waitFor(()=>browser.evaluate(`window.MolariumChemistActions?.history()
      .some(e=>e.action==='designerScript.loadRegistered'&&e.status==='completed'
        &&e.result?.registeredDesignerScript?.storyId==='sos1-hit-to-bay293-review')`),30000,'review story');
    await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
    let completed=false;
    try { await waitFor(()=>browser.evaluate(`window.MolariumChemistActions?.history()
      .some(e=>e.action==='campaign.import'&&e.status==='completed')`),15000,'first import');completed=true; }
    catch { /* Preserve the stalled operation, not a fabricated pass. */ }
    const snapshot=await browser.evaluate(`({
      trace:window.__replayStartupTrace,
      campaignStatus:document.querySelector('#campaign-status')?.textContent,
      actionStates:window.MolariumChemistActions.history().map(e=>({action:e.action,status:e.status})),
    })`);
    snapshots.push({attempt,completed,...snapshot});
    if(!completed||process.env.MOLARIUM_REPLAY_UPGRADE_RACE==='1')break;
  }
  const report={snapshots};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(snapshots.map(s=>({...s,trace:s.trace.filter(t=>
    t.kind.startsWith('idb') || !t.end)})),null,2));
} finally { await browser.close(); }
