import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { platform, arch, cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';
const root = fileURLToPath(new URL('../../',import.meta.url));
const arg = (name,fallback) => {const i=process.argv.indexOf(`--${name}`); return i<0?fallback:process.argv[i+1];};
const sha = b => createHash('sha256').update(b).digest('hex');
const packetPath=resolve(arg('packet',`${root}/benchmarks/simulation/generated/packet.json`));
const output=arg('output'); if(!output) throw new Error('--output is required');
if(await Bun.file(output).exists()) throw new Error('Output exists; use a new immutable attempt');
const packetBytes=await readFile(packetPath),packet=JSON.parse(packetBytes);
await mkdir(dirname(resolve(output)),{recursive:true});
const packetCopy=resolve(dirname(resolve(output)),`packet-${sha(packetBytes)}.json`);
if(!(await Bun.file(packetCopy).exists()))await writeFile(packetCopy,packetBytes,{flag:'wx'});
const repeats=Number(arg('repeats',packet.protocol.performance.repeats));
const seconds=Number(arg('seconds',packet.protocol.performance.minimumSampleSeconds));
if(!Number.isInteger(repeats)||repeats<1||!Number.isFinite(seconds)||seconds<=0) throw new Error('Invalid timing settings');
const selected=arg('cases','').split(',').filter(Boolean);
const cases=packet.cases.filter(c=>!selected.length||selected.includes(c.id));
if(!cases.length||selected.some(id=>!cases.some(c=>c.id===id))) throw new Error('Unknown/empty case selection');
const sourceFiles=['webgpu-worker.js','webgpu/molarium-webgpu.wgsl','openff/implicit-solvent.js',
  'openff/simulation-options.js','benchmarks/simulation/run-browser.mjs','benchmarks/simulation/runner-page.mjs',
  'benchmarks/simulation/runner.html','scripts/headless-chrome.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const git = args => {try{return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
const report={schema:'molarium.webgpu-simulation-benchmark/v1',timestamp:new Date().toISOString(),
  packetSha256:sha(packetBytes),protocolSha256:packet.protocolSha256,source:{commit:git(['rev-parse','HEAD']),sourceHashes},
  environment:{os:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,bun:Bun.version},
  command:process.argv.slice(2),performanceSettings:{repeats,minimumSampleSeconds:seconds},cases:[]};
try {
  report.environment.hardware = platform()==='darwin'
    ? execFileSync('system_profiler',['SPDisplaysDataType'],{encoding:'utf8'}).trim()
    : execFileSync('nvidia-smi',['--query-gpu=name,driver_version,memory.total,pci.bus_id','--format=csv'],{encoding:'utf8'}).trim();
} catch { report.environment.hardware = null; }
let browser;
try {
  browser=await startMolariumBrowser({root,appPath:'benchmarks/simulation/runner.html'});
  await waitFor(()=>browser.evaluate('Boolean(window.simulationBenchmark)'),20000,'benchmark module');
  for(let attempt=1;attempt<=10;attempt++){
    try{
      report.environment.browser=await browser.evaluate('window.simulationBenchmark.environment()');
      report.environment.adapterAcquisitionAttempts=attempt;break;
    }catch(error){
      if(attempt===10||!String(error).includes('No WebGPU adapter'))throw error;
      // Headless Linux can return null while its GPU process initializes.
      // This bounded startup retry happens before any scientific/timed work.
      await Bun.sleep(500);
    }
  }
  // One production energy job triggers compilation outside all reported speed samples.
  await browser.evaluate(`window.simulationBenchmark.accuracy(${JSON.stringify(cases[0])})`);
  for(const c of cases){
    const row={id:c.id,atomCount:c.molecule.atoms.length,classification:c.classification||'normal'};
    try{
      row.result=await browser.evaluate(`window.simulationBenchmark.accuracy(${JSON.stringify(c)})`);
      row.status='ok';
      if(process.argv.includes('--speed')&&c.performance)
        row.performance=await browser.evaluate(`window.simulationBenchmark.speed(${JSON.stringify(c)},${JSON.stringify(packet.protocol.performance)},${repeats},${seconds})`);
    }catch(error){row.status='error';row.error=String(error);}
    report.cases.push(row); console.log(`${c.id}: ${row.status}${row.error?' '+row.error:''}`);
  }
}catch(error){report.error=String(error);}
finally{
  await browser?.close(); await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
if(report.error||report.cases.some(c=>c.status!=='ok'))process.exitCode=1;
