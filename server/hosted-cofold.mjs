// Bounded, stateless NVIDIA relay. No shared credentials, storage, or request logs.
// Provider-owned jobs are never resubmitted here; each incoming POST is one call.
const PREFIX='/api/cofold/nvidia/';
const MODELS=Object.freeze({boltz2:'mit/boltz2',openfold3:'openfold/openfold3'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INPUT=4*1024*1024,MAX_OUTPUT=32*1024*1024;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});

async function boundedText(body,limit){
  if(!body)return '';
  const reader=body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>limit)throw Error('Response exceeds the transfer limit.');chunks.push(value);}
  }catch(e){await reader.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(length);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export async function relayHostedCofold(request,{fetchImplementation=fetch,localOnly=false}={}){
  if(localOnly)return json({error:'Server folding is unavailable in Local Lab mode.'},403);
  const url=new URL(request.url),path=url.pathname.slice(PREFIX.length);
  if(!url.pathname.startsWith(PREFIX)||url.search)return json({error:'Unknown folding endpoint.'},404);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)return json({error:'Cross-origin relay requests are not allowed.'},403);
  const credential=request.headers.get('Authorization')??'';
  if(!/^Bearer nvapi-[A-Za-z0-9_-]{20,512}$/.test(credential))
    return json({error:'Enter your NVIDIA API key. It is used for this request only.'},401);
  const key=credential.slice(7);
  let endpoint,body;
  if(path==='submit'&&request.method==='POST'){
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')??''))return json({error:'JSON input required.'},415);
    if(Number(request.headers.get('Content-Length')??0)>MAX_INPUT)return json({error:'Folding request exceeds 4 MiB.'},413);
    try{
      const data=JSON.parse(await boundedText(request.body,MAX_INPUT));
      if(!Object.hasOwn(MODELS,data.model)||!data.input||Array.isArray(data.input)||typeof data.input!=='object'
        ||Object.keys(data).some(k=>!['model','input'].includes(k)))return json({error:'Unknown model or invalid request.'},400);
      body=JSON.stringify(data.input);
      endpoint=`https://health.api.nvidia.com/v1/biology/${MODELS[data.model]}/predict`;
    }catch{return json({error:'Invalid or oversized JSON request.'},400);}
  }else if(path.startsWith('status/')&&request.method==='GET'&&UUID.test(path.slice(7))){
    // This is the poll host used by NVIDIA's official Boltz2Client.
    endpoint='https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/'+path.slice(7);
  }else return json({error:'Unknown folding operation.'},404);
  let acceptedId=null;
  try{
    const upstream=await fetchImplementation(endpoint,{method:body?'POST':'GET',redirect:'manual',
      headers:{Authorization:credential,'Content-Type':'application/json','Accept':'application/json','NVCF-POLL-SECONDS':'1'},
      ...(body?{body}:{}),signal:AbortSignal.timeout(25000)});
    const requestId=upstream.headers.get('nvcf-reqid');
    const id=requestId&&UUID.test(requestId)?requestId:null;
    acceptedId=id;
    if(upstream.status===202){
      await upstream.body?.cancel();
      if(!id&&path==='submit')return json({error:'NVIDIA accepted the request but returned no recoverable request ID. Check the NVIDIA console before submitting again.',submissionUnknown:true},502);
      return json({status:'queued',requestId:id??path.slice(7)},202);
    }
    // Never forward Authorization to a Location supplied by another service.
    if(upstream.status>=300&&upstream.status<400){
      await upstream.body?.cancel();
      return json({error:'NVIDIA returned an external result download. Use the provider console to retrieve this request.',requestId:id,
        resultRequiresProviderDownload:true},502);
    }
    const text=await boundedText(upstream.body,MAX_OUTPUT);
    let data;
    try{data=JSON.parse(text.split(key).join('[redacted]'));}
    catch{return json({error:'NVIDIA returned a non-JSON response.',requestId:id,submissionUnknown:!body?false:!id},502);}
    if(!upstream.ok)return json({error:`NVIDIA returned HTTP ${upstream.status}.`,providerStatus:upstream.status,
      requestId:id,detail:data},upstream.status>=400&&upstream.status<600?upstream.status:502);
    return json({status:'complete',requestId:id,data});
  }catch{
    return json({error:body?'Submission response was interrupted. Do not submit again until you check whether NVIDIA accepted it.':'Could not retrieve this NVIDIA request. Resume polling the saved request ID.',
      requestId:acceptedId,submissionUnknown:Boolean(body)},502);
  }
}
