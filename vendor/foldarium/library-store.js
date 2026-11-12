import {LIBRARY_SCHEMA, validateLibrary,ligandConfidence} from './library-format.js';
export function poseSummary(p) {
  const {result,...meta}=p;
  return {...meta,...(result?{inferenceMs:result.elapsedMs,ligandPlddt:ligandConfidence(result),iptm:result.iptm}:{} )};
}
const request = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const finished = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Local storage transaction aborted.'));
});
export class LibraryStore {
  async database() {
    if (!this.opened) this.opened = new Promise((resolve, reject) => {
      const r = indexedDB.open('foldarium-local-libraries', 2);
      r.onupgradeneeded = () => {
        if(!r.result.objectStoreNames.contains('runs'))r.result.createObjectStore('runs', {keyPath:'id'});
        for (const name of ['poses','decisions']) {
          if(!r.result.objectStoreNames.contains(name)){
            const s = r.result.createObjectStore(name, {keyPath:['runId','id']});s.createIndex('runId', 'runId');
          }
        }
        const poses=r.transaction.objectStore('poses');
        if(!poses.indexNames.contains('compound'))poses.createIndex('compound',['runId','compoundId']);
        if(!r.result.objectStoreNames.contains('poseIndex')){
          const index=r.result.createObjectStore('poseIndex',{keyPath:['runId','id']});index.createIndex('runId','runId');
          const cursor=poses.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){index.put(poseSummary(c.value));c.continue();}};
        }
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Close older library tabs to update local storage.'));
    });
    return this.opened;
  }
  async getRun(id) { const db = await this.database(); return request(db.transaction('runs').objectStore('runs').get(id)); }
  async listRuns() { const db = await this.database(); return request(db.transaction('runs').objectStore('runs').getAll()); }
  async records(name, id) { const db = await this.database(); return request(db.transaction(name).objectStore(name).index('runId').getAll(id)); }
  async pose(runId,id) {const db=await this.database();return request(db.transaction('poses').objectStore('poses').get([runId,id]));}
  async compoundPoses(runId,compoundId) {const db=await this.database();return request(db.transaction('poses').objectStore('poses').index('compound').getAll([runId,compoundId]));}
  async overview(id) {const [run,poses,decisions]=await Promise.all([this.getRun(id),this.records('poseIndex',id),this.records('decisions',id)]);
    if(!run)throw new Error('Saved library not found.');return {schema:LIBRARY_SCHEMA,run,poses,decisions};}
  async saveRun(run) {
    const db = await this.database(), tx = db.transaction('runs','readwrite'), done = finished(tx);
    tx.objectStore('runs').put(run); await done;
  }
  async checkpoint(run, pose) {
    const db = await this.database(), tx = db.transaction(['runs','poses','poseIndex'],'readwrite'), done = finished(tx);
    tx.objectStore('runs').put(run); tx.objectStore('poses').put({...pose,runId:run.id});
    tx.objectStore('poseIndex').put({...poseSummary(pose),runId:run.id});await done;
  }
  async decide(runId, decision) {
    const db = await this.database(), tx = db.transaction('decisions','readwrite'), done = finished(tx);
    const s=tx.objectStore('decisions'), records=s.index('runId').getAll(runId);
    records.onsuccess=()=>{
      for(const d of records.result)if(d.compoundId===decision.compoundId){
        if(decision.value==='none'&&d.value==='preferred')s.put({...d,value:'unreviewed'});
        if(decision.value==='preferred'&&!d.poseId)s.delete([runId,d.id]);
        if(decision.poseId&&d.poseId===decision.poseId&&d.id!==decision.id)s.delete([runId,d.id]);
        if(!decision.poseId&&!d.poseId&&d.id!==decision.id)s.delete([runId,d.id]);
      }
      s.put({...decision,runId,at:new Date().toISOString()});
    };await done;
  }
  async bundle(id) {
    const [run, poses, decisions] = await Promise.all([this.getRun(id),this.records('poses',id),this.records('decisions',id)]);
    return validateLibrary({schema:LIBRARY_SCHEMA,run,poses,decisions});
  }
  async import(bundle) {
    validateLibrary(bundle);
    // Import creates a new local identity; it cannot overwrite a running library.
    const run = {...bundle.run, id:crypto.randomUUID(), importedFrom:bundle.run.id, status:'imported'};
    const db = await this.database(), tx = db.transaction(['runs','poses','decisions','poseIndex'],'readwrite'), done = finished(tx);
    tx.objectStore('runs').add(run);
    for (const name of ['poses','decisions']) for (const record of bundle[name] ?? [])
      tx.objectStore(name).put({...record,runId:run.id});
    for(const record of bundle.poses)tx.objectStore('poseIndex').put({...poseSummary(record),runId:run.id});
    await done; return run;
  }
  async remove(id) {
    const bundle = await this.overview(id), db = await this.database();
    const tx = db.transaction(['runs','poses','decisions','poseIndex'],'readwrite'), done = finished(tx);
    tx.objectStore('runs').delete(id);
    for (const name of ['poses','decisions']) for (const record of bundle[name]) tx.objectStore(name).delete([id,record.id]);
    for(const record of bundle.poses)tx.objectStore('poseIndex').delete([id,record.id]);
    await done;
  }
}
