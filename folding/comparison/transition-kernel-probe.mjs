// Diagnostic harness over pinned production generators/packer/GPU decoder.
// Shader translation is local to this probe; no production/vendor code changes.
import {createTransitionShader,createTransitionSplitShaders,packTransitionWeights,
 transitionRowTile,splitTransitionConfig,pairTransitionArithmetic}from'../../vendor/localfold/webgpu/af3/trunk/transition.js';
import {planBlockUpload,runBlockUpload}from'../../vendor/localfold/webgpu/weights/quantised-upload.js';

const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function materializeScalarPacking(code){
 const marker='  // ...LANES rows of one channel per slot';
 const start=code.indexOf(marker);if(start<0)return code;
 const finish=code.indexOf('  workgroupBarrier();',start);if(finish<0)throw Error('Missing normalization pack barrier');
 const channels=Number(code.match(/const CHANNELS: u32 = (\d+)u;/)?.[1]);
 const width=Number(code.match(/const WORKGROUP: u32 = (\d+)u;/)?.[1]);
 const type=code.match(/normalized: array<([^;\n]+), (\d+)>;/);
 if(!channels||!width||!type)throw Error('Unknown scalar normalization layout');
 const stored=type[1],vector=stored.replace('f16','f32'),lanes=Number(vector.match(/vec(\d)/)?.[1]??1),groups=Number(type[2])/channels;
 if(!Number.isInteger(groups)||!groups)throw Error('Unknown scalar normalization groups');
 const component=i=>lanes===1?'':'.'+'xyzw'[i];
 const mean=vector+'('+Array.from({length:lanes},(_,i)=>'row_mean[g * '+lanes+'u + '+i+'u]').join(',')+')';
 const inverse=vector+'('+Array.from({length:lanes},(_,i)=>'row_inverse_std[g * '+lanes+'u + '+i+'u]').join(',')+')';
 // Materialize the row translation in existing f32 workgroup scratch before
 // subtracting the shifted mean. The direct chained-read expression failed
 // the MSA stress gate on the tested driver despite the vector branch passing.
 const replacement=`  for (var step = 0u; step < ${Math.ceil(channels/width)}u; step += 1u) {
    let c = local + step * WORKGROUP;
    let bounded_c = min(c, CHANNELS - 1u);
    let scale = f32(weights[W_SCALE + bounded_c]);
    let offset = f32(weights[W_OFFSET + bounded_c]);
    for (var g = 0u; g < ${groups}u; g += 1u) {
      var centered: ${vector};
      ${Array.from({length:lanes},(_,i)=>`let row${i} = min(base_row + g * ${lanes}u + ${i}u, ROWS - 1u);
      centered${component(i)} = input[row${i} * CHANNELS + bounded_c] - input[row${i} * CHANNELS];`).join('\n      ')}
      reduce_a[local] = centered;
      workgroupBarrier();
      let packed = (reduce_a[local] - ${mean}) * ${inverse} * ${vector}(scale) + ${vector}(offset);
      if (c < CHANNELS) { normalized[g * CHANNELS + c] = ${stored}(packed); }
      workgroupBarrier();
    }
  }
  workgroupBarrier();`;
 return code.slice(0,start)+replacement+code.slice(finish+'  workgroupBarrier();'.length);
}
export function translatedNormalization(source,kind){
 let replacements=0;
 const pattern=kind==='fused'?/input\[(base_\d+(?:_\d+)?|row\d+ \* CHANNELS) \+ (c(?:_ln_\d+)?)\](?!\s*\+=)/g:/input\[base_idx \+ index\]/g;
 let code=source.replace(pattern,(all,base)=>{replacements++;return kind==='fused'
  ?'('+all+' - input['+base+'])':'('+all+' - input[(base_row + index / CHANNELS) * CHANNELS])';});
 if(!replacements)throw Error('Pinned '+kind+' normalization source no longer matches this diagnostic');
 if(kind==='fused')code=materializeScalarPacking(code);
 return {code,replacements};
}

export async function probeTransition(device,c,input,weights,encoded,style,shifted){
 const half=c.precision!=='f32',precision=half?'f16':'f32',shape=c.shape,{rows,channels,factor}=shape;
 if(half&&!device.features.has('shader-f16'))throw Error('This production precision needs shader-f16');
 const packed=packTransitionWeights(weights,precision),held=[],release=[];let scope=true;
 const create=(size,usage,label)=>{const b=device.createBuffer({size:Math.ceil(size/4)*4,usage,label});held.push(b);return b;};
 const upload=(data,usage,label)=>{const b=create(data.byteLength,usage|GPUBufferUsage.COPY_DST,label);
  device.queue.writeBuffer(b,0,data.buffer,data.byteOffset,data.byteLength);return b;};
 const storage=GPUBufferUsage.STORAGE,readable=storage|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const shaders=[],startUpload=performance.now();device.pushErrorScope('validation');
 try{
  const expectedPacked=new Uint8Array(packed.data.buffer,packed.data.byteOffset,packed.data.byteLength);
  const sourcePacked=expectedPacked.slice();
  if(c.precision==='int5-f16')for(const key of ['transition1','transition2'])
   sourcePacked.fill(0,packed.offsets[key]*2,(packed.offsets[key]+weights[key].length)*2);
  const weightBuffer=upload(sourcePacked,readable,'matched resident transition weights');
  let decoder=null;
  if(c.precision==='int5-f16'){
   const entries=['transition1','transition2'].map(key=>{const {record,data}=encoded[key],store={tensorSource:()=>({record,buffer:data.buffer,byteOffset:data.byteOffset})};
    return {thunk:{store,tensorName:key,first:0,count:weights[key].length},offset:packed.offsets[key],length:weights[key].length};});
   const plan=planBlockUpload(entries,'f16');
   if(!plan||plan.host.length||plan.gpu.params.length!==2)throw Error('Production int5 planner refused matrix sources');
   release.push(await runBlockUpload(device,plan.gpu,weightBuffer));
   const readback=create(expectedPacked.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST,'decoded weight readback');
   const e=device.createCommandEncoder();e.copyBufferToBuffer(weightBuffer,0,readback,0,expectedPacked.byteLength);device.queue.submit([e.finish()]);
   await readback.mapAsync(GPUMapMode.READ);const actual=new Uint8Array(readback.getMappedRange().slice(0));readback.unmap();
   let differingBytes=0;for(let i=0;i<actual.length;i++)if(actual[i]!==expectedPacked[i])differingBytes++;
   decoder={parameters:plan.gpu.params.length,differingBytes,expectedSha256:await digest(expectedPacked),actualSha256:await digest(actual)};
   if(differingBytes)throw Error('Production int5 decoded resident weights differ from independent CPU values: '+differingBytes+' bytes');
  }
  const weightUploadAndVerificationMs=performance.now()-startUpload;
  const inputBuffer=upload(input,readable,'transition input'),out=create(input.byteLength,readable,'transition output');
  const readback=create(input.byteLength,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'transition readback');
  const bind=(pipeline,buffers)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((v,binding)=>({binding,resource:v.buffer?v:{buffer:v}}))});
  const compile=async(source,label,kind)=>{
   const edit=shifted?translatedNormalization(source,kind):{code:source,replacements:0};
   shaders.push({label,replacements:edit.replacements,originalSha256:await digest(new TextEncoder().encode(source)),executedSha256:await digest(new TextEncoder().encode(edit.code))});
   const module=device.createShaderModule({code:edit.code,label}),info=await module.getCompilationInfo();
   const errors=info.messages.filter(m=>m.type==='error');
   if(errors.length)throw Error('Shader compile '+label+': '+errors.map(m=>'line '+m.lineNum+': '+m.message+' ['+edit.code.split('\n').slice(Math.max(0,m.lineNum-2),m.lineNum+1).join(' | ')+']').join('; '));
   return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  };
  const startCompile=performance.now();let run,normalizedReadback=null,normalizedType=null,chunkRows=null,actualMatrix=null;
  if(style.startsWith('fused')){
   const residual=style==='fused-residual',tile=transitionRowTile(rows,channels);
   const pipeline=await compile(createTransitionShader({...shape,stagePrecision:precision,weightPrecision:precision,residual,rowRange:residual},packed.offsets,c.epsilon,'fast'),'fused transition','fused');
   chunkRows=residual?Math.min(256,rows):rows;
   const ranges=[];for(let from=0;from<rows;from+=chunkRows)ranges.push({from,count:Math.min(chunkRows,rows-from),uniform:residual?upload(new Uint32Array([from,Math.min(rows,from+chunkRows),0,0]),GPUBufferUsage.UNIFORM,'row range'):null});
   run=encoder=>{
    if(residual)encoder.copyBufferToBuffer(inputBuffer,0,out,0,input.byteLength);
    for(const r of ranges){const p=encoder.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind(pipeline,residual?[out,weightBuffer,r.uniform]:[inputBuffer,weightBuffer,out]));
     const groups=Math.ceil(r.count/tile);p.dispatchWorkgroups(Math.min(groups,32768),Math.ceil(groups/32768));p.end();}
   };
  }else{
   const selected=splitTransitionConfig(device,channels,{f32Only:!half,arithmetic:half?pairTransitionArithmetic():'f32'});
   // Force a vector control only where the production chooser declines splitting.
   const matrix=selected||{vector:true,storage:precision,arithmetic:half?'f16':'f32',block:{rows:64,columns:64,inner:16}};
   actualMatrix={...matrix,selectedByProduction:!!selected};
   const split=createTransitionSplitShaders(shape,packed.offsets,c.epsilon,'fast',{weightPrecision:precision,matrix});
   const np=await compile(split.normalize,'split normalization','split');
   const wp=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:split.wide}),entryPoint:'main'}});
   const dp=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:split.down}),entryPoint:'main'}});
   shaders.push({label:'split wide',executedSha256:await digest(new TextEncoder().encode(split.wide))},
    {label:'split down',executedSha256:await digest(new TextEncoder().encode(split.down))});
   chunkRows=Math.min(256,rows);normalizedType=split.storage;const element=split.storage==='f16'?2:4;
   const normalized=create(chunkRows*channels*element,readable,'normalized chunk'),wide=create(chunkRows*channels*factor*2*element,storage,'wide chunk');
   const normalizedAll=create(rows*channels*element,GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,'captured normalization');
   normalizedReadback=create(rows*channels*element,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'normalization readback');
   const ranges=[];for(let from=0;from<rows;from+=chunkRows){const count=Math.min(chunkRows,rows-from);
    ranges.push({from,count,np:upload(new Uint32Array([count,channels,0,0]),GPUBufferUsage.UNIFORM,'norm params'),
     wp:upload(new Uint32Array([count,channels,channels*factor*2,packed.offsets.transition1,0,0,0,0]),GPUBufferUsage.UNIFORM,'wide params'),
     dp:upload(new Uint32Array([count,channels*factor,channels,packed.offsets.transition2,0,0,0,0]),GPUBufferUsage.UNIFORM,'down params')});}
   run=encoder=>{
    encoder.copyBufferToBuffer(inputBuffer,0,out,0,input.byteLength);
    const pass=(pipeline,buffers,x,y)=>{const p=encoder.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind(pipeline,buffers));p.dispatchWorkgroups(x,y);p.end();};
    for(const r of ranges){const at=b=>({buffer:b,offset:r.from*channels*4,size:r.count*channels*4});
     pass(np,[at(inputBuffer),weightBuffer,normalized,r.np],Math.ceil(r.count/split.tiles.normalizeRows),1);
     encoder.copyBufferToBuffer(normalized,0,normalizedAll,r.from*channels*element,r.count*channels*element);
     pass(wp,[normalized,weightBuffer,r.wp,wide],Math.ceil(channels*factor*2/split.tiles.blockColumns),Math.ceil(r.count/split.tiles.blockRows));
     pass(dp,[wide,weightBuffer,r.dp,at(out)],Math.ceil(channels/split.tiles.blockColumns),Math.ceil(r.count/split.tiles.blockRows));}
    encoder.copyBufferToBuffer(normalizedAll,0,normalizedReadback,0,rows*channels*element);
   };
  }
  const compileMs=performance.now()-startCompile,start=performance.now(),encoder=device.createCommandEncoder();run(encoder);
  encoder.copyBufferToBuffer(out,0,readback,0,input.byteLength);device.queue.submit([encoder.finish()]);
  const error=await device.popErrorScope();scope=false;if(error)throw Error('WebGPU validation: '+error.message);
  await readback.mapAsync(GPUMapMode.READ);const output=readback.getMappedRange().slice(0);readback.unmap();
  let normalized=null;if(normalizedReadback){await normalizedReadback.mapAsync(GPUMapMode.READ);normalized=normalizedReadback.getMappedRange().slice(0);normalizedReadback.unmap();}
  return {output,normalized,normalizedType,residual:style!=='fused',decoder,shaders,chunkRows,actualMatrix,
   weightUploadAndVerificationMs,compileMs,executionAndReadbackMs:performance.now()-start};
 }finally{
  if(scope)await device.popErrorScope().catch(()=>{});await device.queue.onSubmittedWorkDone().catch(()=>{});
  for(const f of release)f();for(const b of held)b.destroy();
 }
}
