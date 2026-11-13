// Molarium-owned launcher: vendored Foldarium stays pinned and unchanged.
import {LibraryStore} from '../library-store.mjs';
import {validateLibrary} from '../../vendor/foldarium/library-format.js';

export function checkedBundleUrl(entry,base){
  if(!/^[a-f0-9]{64}$/.test(entry?.sha256??'')
    ||!/^[-a-z0-9_./]+\.library\.json$/.test(entry?.file??''))throw Error('Invalid review bundle descriptor');
  const directory=new URL('./',base),url=new URL(entry.file,directory);
  if(url.origin!==directory.origin||!url.pathname.startsWith(directory.pathname))throw Error('Review bundle must stay in this publication directory');
  return url;
}

async function boundedBytes(response,limit=24*1024*1024){
  if(!response.ok)throw Error(`Review download failed (${response.status})`);
  if(Number(response.headers.get('content-length'))>limit)throw Error('Review bundle exceeds size limit');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>limit)throw Error('Review bundle exceeds size limit');chunks.push(value);}}
  catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

export async function importPublicBundle(entry,{base,store=new LibraryStore(),fetcher=fetch}={}){
  const url=checkedBundleUrl(entry,base);
  const bytes=await boundedBytes(await fetcher(url));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw Error('Review bundle hash mismatch');
  const bundle=validateLibrary(JSON.parse(new TextDecoder().decode(bytes)));
  if(bundle.decisions.length)throw Error('Public review bundles must contain no preferences');
  const references=bundle.poses.filter(p=>p.role==='experimental-reference'||p.result?.kind==='experimental').length;
  if(references!==(entry.reference?1:0))throw Error('Unexpected experimental reference count');
  const load=async()=>{
    const existing=(await store.listRuns()).find(r=>r.provenance?.publicReviewBundleSha256===hash);
    if(existing)return {run:existing,reused:true};
    const run=await store.import(bundle);
    run.provenance={...run.provenance,publicReviewBundleSha256:hash,publicReviewBundleUrl:url.href};
    await store.saveRun(run);return {run,reused:false};
  };
  return globalThis.navigator?.locks
    ?navigator.locks.request(`molarium-public-review-${hash}`,load):load();
}

export async function startPublicReview(){
  const response=await fetch('./review-index.json');if(!response.ok)throw Error('Review index unavailable');
  const index=await response.json(),cards=document.querySelector('#cases'),store=new LibraryStore();
  for(const c of index.cases){
    const card=document.createElement('article'),heading=document.createElement('h2'),meta=document.createElement('p');
    heading.textContent=c.name;meta.textContent=`${c.pdbId} · released ${c.releaseDate} · ${c.residues} residues · ${c.heavyAtoms} ligand heavy atoms · QED ${c.qed.toFixed(2)}`;
    card.append(heading,meta);
    for(const [label,entry]of [['Review predictions',c.predictions],['Show experimental reference',c.withReference]]){
      const button=document.createElement('button');button.textContent=label;
      button.addEventListener('click',async()=>{button.disabled=true;document.querySelector('#status').textContent='Opening saved poses…';
        try{const {run}=await importPublicBundle(entry,{base:location.href,store});
          location.href=`../../vendor/foldarium/library-review.html?run=${encodeURIComponent(run.id)}`;
        }catch(e){document.querySelector('#status').textContent=e.message;button.disabled=false;}});
      card.append(button);
    }
    cards.append(card);
  }
  document.querySelector('#status').textContent=`${index.cases.length} systems · ${index.predictions} saved predictions · no inference required`;
}
