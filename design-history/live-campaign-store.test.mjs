import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLiveCampaignStore} from './live-campaign-store.mjs';

function fixture() {
  const requests=[];
  const indexedDB={open(){const r=new EventTarget();requests.push(r);return r;}};
  function database() {
    const db=new EventTarget();db.closed=0;db.close=()=>db.closed++;
    db.transaction=()=>{
      const tx=new EventTarget();
      tx.objectStore=()=>({get(){const request=new EventTarget();request.result=null;
        queueMicrotask(()=>{request.dispatchEvent(new Event('success'));
          queueMicrotask(()=>tx.dispatchEvent(new Event('complete')));});return request;}});
      return tx;
    };
    return db;
  }
  return {requests,indexedDB,database};
}
test('a never-settling database open fails explicitly and can retry without deleting anything',async()=>{
  const f=fixture(),store=createLiveCampaignStore({indexedDB:f.indexedDB,openTimeoutMs:20});
  await assert.rejects(store.loadActive(),/did not open/);
  const next=store.loadActive();assert.equal(f.requests.length,2);
  const db=f.database();f.requests[1].result=db;f.requests[1].dispatchEvent(new Event('success'));
  assert.equal(await next,null);store.close();assert.equal(db.closed,1);
  // A late result from the timed-out first request must not replace/leak a connection.
  const late=f.database();f.requests[0].result=late;f.requests[0].dispatchEvent(new Event('success'));
  assert.equal(late.closed,1);
});
test('navigation closes pending upgrades promptly and version changes release live connections',async()=>{
  const f=fixture(),store=createLiveCampaignStore({indexedDB:f.indexedDB});
  const pending=store.loadActive(),rejected=assert.rejects(pending,/cancelled/);
  let aborted=0;f.requests[0].transaction={abort(){aborted++;}};
  store.close();await rejected;assert.equal(aborted,1);
  const late=f.database();f.requests[0].result=late;f.requests[0].dispatchEvent(new Event('success'));
  assert.equal(late.closed,1);
  const next=store.loadActive(),db=f.database();f.requests[1].result=db;
  f.requests[1].dispatchEvent(new Event('success'));assert.equal(await next,null);
  db.dispatchEvent(new Event('versionchange'));assert.equal(db.closed,1);
  const reopened=store.loadActive();assert.equal(f.requests.length,3);
  f.requests[2].result=f.database();f.requests[2].dispatchEvent(new Event('success'));
  assert.equal(await reopened,null);store.close();
});
