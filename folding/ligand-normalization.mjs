// Normalize chemical representation before LocalFold generates atom features or
// reference conformers. Charge/stereo are preserved; no bound coordinates enter.
export function createSmilesNormalizer({WorkerClass=globalThis.Worker,
  url=new URL('../rdkit-worker.js',import.meta.url)}={}){
  let worker=null,sequence=0;const pending=new Map(),cache=new Map();
  function start(){
    if(worker)return;
    worker=new WorkerClass(url);
    worker.addEventListener('message',event=>{
      const m=event.data,p=pending.get(m.id);if(!p)return;
      if(m.type==='progress'){p.onProgress({stage:'ligand-chemistry',message:m.phase});return;}
      pending.delete(m.id);p.cleanup();
      if(m.type==='error')p.reject(new Error(m.message||m.error||'RDKit ligand normalization failed'));
      else if(m.type==='result'&&m.canonicalSmiles){const result={canonicalSmiles:m.canonicalSmiles,rdkitVersion:m.rdkitVersion,backend:'RDKit WebAssembly'};cache.set(p.smiles,result);p.resolve(result);}
      else p.reject(new Error('Invalid RDKit ligand normalization result'));
    });
    worker.addEventListener('error',event=>{for(const p of pending.values()){p.cleanup();p.reject(new Error(event.message||'RDKit worker failed'));}pending.clear();worker?.terminate();worker=null;});
  }
  return function normalize(smiles,{signal,onProgress=()=>{}}={}){
    if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
    if(cache.has(smiles))return Promise.resolve(cache.get(smiles));
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const abort=()=>{pending.delete(id);cleanup();reject(signal.reason??new DOMException('Aborted','AbortError'));};
      const timer=setTimeout(()=>{pending.delete(id);cleanup();reject(new Error('RDKit ligand normalization timed out'));},60000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      pending.set(id,{resolve,reject,cleanup,onProgress,smiles});signal?.addEventListener('abort',abort,{once:true});
      try{start();worker.postMessage({type:'run',id,job:'smiles-canonical',options:{smiles}});}catch(e){pending.delete(id);cleanup();reject(e);}
    });
  };
}
let shared;
export const normalizeLigandSmiles=(smiles,options)=>(shared??=createSmilesNormalizer())(smiles,options);
