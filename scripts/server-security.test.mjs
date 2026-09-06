import assert from 'node:assert/strict';
import {startLocalTestServer} from './local-test-server.mjs';

const root=new URL('../',import.meta.url).pathname;
for(const args of [[],['--local-only']]) {
  const {process:server,baseUrl}=await startLocalTestServer({root,args});
  try {
    assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
    for(const path of ['', 'reproductions','sos1','webgpu-worker.js',
      'openff/numeric-system.mjs','stormm/engine.mjs',
      'benchmarks/simulation/runner.html','local-lab-manifest.json',
      'design-history/publications/sos1/checkpoints/starting-hit-campaign.json']) {
      const response=await fetch(new URL(path,baseUrl));
      assert.equal(response.status,200,path);
      await response.arrayBuffer();
    }
    for(const path of ['.git/config','.env','%2eenv','TODO.md','package-lock.json',
      'benchmarks/simulation/generated/packet.json','arbitrary.json']) {
      const response=await fetch(new URL(path,baseUrl));
      assert.equal(response.status,404,path);
      if(args.length) assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
    }
    assert.equal((await fetch(baseUrl,{headers:{Host:'foreign.example'}})).status,400);
    assert.equal((await fetch(baseUrl,{method:'POST'})).status,405);
    assert.equal((await fetch(baseUrl,{method:'HEAD'})).status,200);
  } finally {server.kill();await server.exited;}
}
// A rejected startup returns the actual failure immediately, not a port timeout.
await assert.rejects(startLocalTestServer({root,args:['--local-only','--host','0.0.0.0']}),
  /exited before readiness/);
console.log('Server security: PASS (connected + Local Lab, exact public files and loopback Host)');
