// Freeze authoritative release metadata before selecting or predicting structures.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [from,to,directory,...flags]=process.argv.slice(2),out=resolve(directory??'.');
if(!/^\d{4}-\d{2}-\d{2}$/.test(from??'')||!/^\d{4}-\d{2}-\d{2}$/.test(to??'')||!directory)throw Error('Usage: from-date to-date NEW-output [--resume]');
const resume=flags.includes('--resume'),sha=b=>createHash('sha256').update(b).digest('hex');
if(!resume)await mkdir(out);
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
const query={query:{type:'group',logical_operator:'and',nodes:[
 {type:'terminal',service:'text',parameters:{attribute:'rcsb_accession_info.initial_release_date',operator:'range',value:{from,to}}},
 {type:'terminal',service:'text',parameters:{attribute:'exptl.method',operator:'exact_match',value:'X-RAY DIFFRACTION'}},
 {type:'terminal',service:'text',parameters:{attribute:'rcsb_entry_info.nonpolymer_entity_count',operator:'greater',value:0}}
]},return_type:'entry',request_options:{return_all_hits:true,sort:[{sort_by:'rcsb_accession_info.initial_release_date',direction:'desc'}]}};
async function request(url,body){
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Molarium-recent-PDB-validation/1.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error(url+' HTTP '+r.status);
 const d=await r.json();if(d.errors?.length)throw Error(JSON.stringify(d.errors));return d;
}
if(!resume){await save('search-query.json',query);await save('search-response.json',await request('https://search.rcsb.org/rcsbsearch/v2/query',query));}
const frozenQuery=JSON.parse(await readFile(join(out,'search-query.json')));
if(JSON.stringify(query)!==JSON.stringify(frozenQuery))throw Error('Resume query differs from frozen window');
const search=JSON.parse(await readFile(join(out,'search-response.json'))),ids=search.result_set.map(x=>x.identifier);
if(new Set(ids).size!==ids.length||ids.length!==search.total_count)throw Error('Search response is truncated or has duplicate IDs');
const metadataQuery=`query RecentComplexes($ids:[String!]!) { entries(entry_ids:$ids) {
 rcsb_id rcsb_accession_info { initial_release_date deposit_date } struct { title }
 rcsb_entry_info { resolution_combined polymer_entity_count nonpolymer_entity_count }
 polymer_entities { rcsb_id entity_poly { pdbx_seq_one_letter_code_can rcsb_sample_sequence_length type }
  rcsb_polymer_entity { pdbx_description } rcsb_polymer_entity_container_identifiers { asym_ids auth_asym_ids } }
 nonpolymer_entities { rcsb_id pdbx_entity_nonpoly { comp_id name }
  rcsb_nonpolymer_entity_container_identifiers { asym_ids auth_asym_ids }
  nonpolymer_comp { chem_comp { id name formula_weight type } rcsb_chem_comp_descriptor { SMILES SMILES_stereo } rcsb_chem_comp_info { atom_count_heavy } } }
} }`;
await writeFile(join(out,'metadata-query.graphql'),metadataQuery+'\n');
const batches=[];for(let i=0;i<ids.length;i+=75)batches.push(ids.slice(i,i+75));
let cursor=0;const entries=[];
await Promise.all(Array.from({length:3},async()=>{
 while(cursor<batches.length){const index=cursor++,batch=batches[index],name=`metadata-${String(index).padStart(3,'0')}.json`;let response;
  try{response=JSON.parse(await readFile(join(out,name)));}catch(e){if(e.code!=='ENOENT')throw e;
   response=await request('https://data.rcsb.org/graphql',{query:metadataQuery,variables:{ids:batch}});await save(name,response);}
  const actual=response.data?.entries;
  if(!actual||actual.length!==batch.length||actual.some(e=>!e)||new Set(actual.map(e=>e.rcsb_id)).size!==batch.length||actual.some(e=>!batch.includes(e.rcsb_id)))throw Error('Incomplete metadata batch '+index);
  entries.push(...actual);console.log(JSON.stringify({batch:index,entries:actual.length,total:batches.length}));
 }
}));
entries.sort((a,b)=>a.rcsb_id.localeCompare(b.rcsb_id));await save('entries.json',entries);
await save('harvest.json',{schema:'molarium.recent-pdb-harvest.v1',retrievedAt:new Date().toISOString(),from,to,
 source:'RCSB initial_release_date; X-ray diffraction; at least one nonpolymer entity',entries:entries.length,
 searchQuerySha256:sha(await readFile(join(out,'search-query.json'))),entriesSha256:sha(await readFile(join(out,'entries.json'))),
 scriptSha256:sha(await readFile(new URL(import.meta.url))),metadataQuerySha256:sha(metadataQuery+'\n')});
console.log(JSON.stringify({complete:true,entries:entries.length,out}));
