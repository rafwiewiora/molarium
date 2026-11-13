// Durable Molarium adapter over the unchanged pinned Foldarium format/store.
// Retry a closed connection once; quota, permission and data errors still stop.
import {LibraryStore as UpstreamLibraryStore,poseSummary} from '../vendor/foldarium/library-store.js';
async function validatedWrite(run,pose,expected){
  const db=await this.database(),tx=db.transaction(['runs','poses','poseIndex'],'readwrite');
  let loss=null;
  const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(loss??tx.error??new Error('Library checkpoint transaction aborted'));});
  const request=tx.objectStore('poseIndex').index('runId').getAll(run.id);
  request.onsuccess=()=>{
    const index=new Map(request.result.map(p=>[p.id,p]));
    const missing=expected.filter(p=>{const q=index.get(p.id);return ['complete','failed'].includes(p.status)
      &&(!q||q.status!==p.status||(p.outputPdbSha256&&q.outputPdbSha256!==p.outputPdbSha256));});
    if(missing.length){loss=new Error('Browser storage lost previously saved checkpoints');loss.name='CheckpointLossError';loss.missing=missing;tx.abort();return;}
    tx.objectStore('runs').put(run);
    if(pose){tx.objectStore('poses').put({...pose,runId:run.id});tx.objectStore('poseIndex').put({...poseSummary(pose),runId:run.id});}
  };
  await done;
}
export class LibraryStore extends UpstreamLibraryStore {
  async database(){
    const request=super.database(),opening=this.opened;
    try{
      const db=await request;
      if(!this.watched)this.watched=new WeakSet();
      if(!this.watched.has(db)){
        this.watched.add(db);
        const clear=()=>{if(this.opened===opening){this.opened=null;this.connectionEpoch=(this.connectionEpoch??0)+1;}};
        db.addEventListener('close',clear);
        db.addEventListener('versionchange',()=>{db.close();clear();});
      }
      return db;
    }catch(e){if(this.opened===opening){this.opened=null;this.connectionEpoch=(this.connectionEpoch??0)+1;}throw e;}
  }
  async withConnectionRetry(method,args){
    const epoch=this.connectionEpoch??0;
    const execute=()=>typeof method==='function'?method.apply(this,args):UpstreamLibraryStore.prototype[method].apply(this,args);
    try{return await execute();}
    catch(e){
      if(e?.name!=='InvalidStateError'||!/(?:connection|database).*(?:clos|closing)|(?:clos|closing).*(?:connection|database)/i.test(e.message))throw e;
      if((this.connectionEpoch??0)===epoch){
        const old=this.opened;this.opened=null;this.connectionEpoch=epoch+1;
        await old?.then(db=>db.close()).catch(()=>{});
      }
      return execute();
    }
  }
  getRun(...args){return this.withConnectionRetry('getRun',args);}
  listRuns(...args){return this.withConnectionRetry('listRuns',args);}
  records(...args){return this.withConnectionRetry('records',args);}
  pose(...args){return this.withConnectionRetry('pose',args);}
  compoundPoses(...args){return this.withConnectionRetry('compoundPoses',args);}
  saveRun(run,expected){return expected?this.withConnectionRetry(validatedWrite,[run,null,expected]):this.withConnectionRetry('saveRun',[run]);}
  checkpoint(run,pose,expected){return expected?this.withConnectionRetry(validatedWrite,[run,pose,expected]):this.withConnectionRetry('checkpoint',[run,pose]);}
  decide(...args){return this.withConnectionRetry('decide',args);}
  import(...args){return this.withConnectionRetry('import',args);}
  remove(...args){return this.withConnectionRetry('remove',args);}
}
