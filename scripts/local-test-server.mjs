// Let the OS allocate an unused port; report startup failures rather than
// polling an unrelated process that happens to own a randomly selected port.
export async function startLocalTestServer({root, args = [], port = 0, timeoutMs = 20000} = {}) {
  const child = Bun.spawn([process.execPath, 'server.js', ...args, '--port', String(port)], {
    cwd:root, stdout:'pipe', stderr:'inherit',
  });
  let timer;
  const reader = child.stdout.getReader();
  const ready = (async () => {
    const decoder = new TextDecoder();
    let output = '';
    for (;;) {
      const {value,done} = await reader.read();
      if (done) throw new Error(`Molarium server exited before readiness (exit ${await child.exited})`);
      output += decoder.decode(value, {stream:true});
      const match = output.match(/Molarium [^\n]+ ready at (http:\/\/[^\s]+)/);
      if (match) return match[1];
      if (output.length > 16384) throw new Error('Unexpected Molarium server startup output');
    }
  })();
  try {
    const baseUrl = await Promise.race([ready, new Promise((_,reject) => {
      timer = setTimeout(() => reject(new Error('Molarium server startup timed out')),timeoutMs);
    })]);
    return {process:child, baseUrl};
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}
