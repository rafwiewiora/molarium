import {readFile,writeFile} from 'node:fs/promises';
import {DevToolsClient} from '/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/scripts/headless-chrome.mjs';
export async function warmNvidiaBrowser(){
 const root=process.env.MOLARIUM_PROBE_ROOT;if(!root)throw Error('Probe directory required');
 const text=await readFile(root+'/chrome-stderr.log','utf8');
 const endpoint=text.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
 if(!endpoint)throw Error('Actual browser-target endpoint missing');
 const client=new DevToolsClient(endpoint);await client.open();
 try{
  const info=await client.call('SystemInfo.getInfo',{},120000),version=await client.call('Browser.getVersion');
  await writeFile(root+'/browser-gpu-info.json',JSON.stringify({info,version},null,2)+'\n',{flag:'wx'});
  if(!/nvidia/i.test(JSON.stringify(info.gpu?.devices)))throw Error('Actual NVIDIA GPU information required');
 }finally{client.close();}
}
