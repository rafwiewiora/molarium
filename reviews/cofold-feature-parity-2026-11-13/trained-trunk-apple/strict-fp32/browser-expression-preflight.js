(()=>{
    window.trunkControl={status:'running',progress:'loading weights'};
    (async()=>{
      const digest=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
      const json=async path=>(await fetch('/fixture/'+path)).json();
      const receipt=await json('receipt.json'),wm=await json('weights.json');
      const wb=await(await fetch('/fixture/weights.bin')).arrayBuffer();
      if(wb.byteLength!==wm.blob.bytes||await digest(wb)!==wm.blob.sha256)throw Error('Weight blob changed');
      for(const d of Object.values(wm.tensors))if(await digest(wb.slice(d.byteOffset,d.byteOffset+d.bytes))!==d.sha256)throw Error('Weight slice changed');
      const store={manifest:wm,shape:name=>{if(!wm.tensors[name])throw Error('Missing tensor '+name);return wm.tensors[name].shape;},
        tensor:async name=>{const d=wm.tensors[name];if(!d)throw Error('Missing tensor '+name);return new Float32Array(wb,d.byteOffset,d.bytes/4);},
        tensorRangeSync:(name,from,count)=>{const d=wm.tensors[name];if(!d||from<0||from+count>d.bytes/4)throw Error('Weight bounds');return new Float32Array(wb,d.byteOffset+4*from,count);}};
      const snapshot=async path=>{
        const m=await json(path+'/features.json'),b=await(await fetch('/fixture/'+path+'/features.bin')).arrayBuffer();
        if(await digest(b)!==m.blob.sha256)throw Error('Input blob changed');
        const classes={'<f4':Float32Array,'<f8':Float64Array,'<i4':Int32Array,'<u4':Uint32Array,'|u1':Uint8Array,'|i1':Int8Array,'|b1':Uint8Array,'<i8':BigInt64Array,'<u8':BigUint64Array};
        const arrays={};for(const[k,d]of Object.entries(m.arrays)){
          const cls=classes[d.dtype];if(!cls||await digest(b.slice(d.byteOffset,d.byteOffset+d.bytes))!==d.sha256)throw Error('Input slice changed');
          arrays[k]=new cls(b,d.byteOffset,d.bytes/cls.BYTES_PER_ELEMENT);
        }
        const decode=n=>{'use strict';if('array'in n)return arrays[n.array];if('value'in n)return n.value;
          if('dict'in n)return Object.fromEntries(n.dict.map(([k,v])=>[decode(k),decode(v)]));
          if('list'in n)return n.list.map(decode);if('tuple'in n)return n.tuple.map(decode);throw Error('Unsupported control input');};
        return decode(m.tree);
      };
      const base=await snapshot('base'),tb=await(await fetch('/fixture/target.bin')).arrayBuffer();
      if(await digest(tb)!==receipt.targetSha256)throw Error('Target changed');
      const {getDevice}=await import('/vendor/localfold/web/model.js');
      const {trunkWeights}=await import('/vendor/localfold/shared/af3/weights/weights.js');
      const {Af3TrunkGpu}=await import('/vendor/localfold/webgpu/af3/trunk/trunk.js');
      const {af3ContactClasses}=await import('/vendor/localfold/shared/af3/featurise/contact-classes.js');
      const device=await getDevice(),adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      const info=adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):{};
      if(/swiftshader|llvmpipe|software/i.test(JSON.stringify(info)))throw Error('Physical GPU required');
      if(!/apple/i.test(JSON.stringify(info))||adapter.info.isFallbackAdapter)throw Error('This independent control requires a physical Apple adapter');
      if(false&&!/nvidia|10de/i.test(JSON.stringify(info)))throw Error('This allocation requires a physical NVIDIA adapter');
      const shaderAudit=[];
      const originalCreateShaderModule=device.createShaderModule.bind(device);
      device.createShaderModule=descriptor=>{
        const code=String(descriptor.code),withoutComments=code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
        const usesF16=/\bf16\b/.test(withoutComments);
        shaderAudit.push({label:descriptor.label??null,usesF16,code});
        if(usesF16)throw Error('Strict FP32 control encountered an f16 shader');
        return originalCreateShaderModule(descriptor);
      };
      const weights=await trunkWeights(store),trunk=new Af3TrunkGpu(device,{
        stagedPrecision:'f32',weightPrecision:'f32',accumulatePrecision:'f32',pairWeightPrecision:'f32',pairMatrixKernels:false});
      const records=[],contactClasses=af3ContactClasses(base,base.tokens),targetFeat=new Float32Array(tb);
      let previousPair,previousSingle;
      for(let cycle=0;cycle<receipt.cycles;cycle++){
        window.trunkControl.progress='cycle '+cycle;
        const msa=await snapshot('msa-'+cycle),transfers=[],seen=new Set();
        const capture=(name,actual)=>{
          const key='cycle-'+cycle+'.'+name,expected=receipt.expectedSeams[key];if(!expected)return;
          if(seen.has(key)||actual.byteLength!==expected.bytes)throw Error('Wrong/duplicate seam '+key);seen.add(key);
          transfers.push((async()=>{const response=await fetch('/output/'+key,{method:'POST',headers:{authorization:"validation-token"},body:actual});if(!response.ok)throw Error('Seam transfer failed '+key);})());
        };
        const started=performance.now(),out=await trunk.run({...base,...msa,targetFeat,contactClasses,previousPair,previousSingle},weights,weights.dialect,{
          readback:{pair:true,single:true,logits:false},onSeam:capture,
          onStageStart:stage=>{window.trunkControl.progress='cycle '+cycle+': '+stage;},
        });
        capture('trunk-output-single',out.single);
        await Promise.all(transfers);
        const wanted=Object.keys(receipt.expectedSeams).filter(k=>k.startsWith('cycle-'+cycle+'.'));
        if(wanted.some(k=>!seen.has(k)))throw Error('Missing observed seams');
        records.push({cycle,instrumentedMilliseconds:performance.now()-started,timings:out.timings});
        previousPair=out.pair;previousSingle=out.single;
      }
      window.trunkControl={status:'complete',records,adapter:info,userAgent:navigator.userAgent,features:[...device.features],precisionControl:{pairMatrixKernels:false,requireNoF16Shaders:true},shaderAudit:await Promise.all(shaderAudit.map(async({code,...m})=>({...m,sha256:await digest(new TextEncoder().encode(code))})))};
    })().catch(e=>{window.trunkControl.status='failed';window.trunkControl.error=String(e.stack??e);});
    return true;
  })()