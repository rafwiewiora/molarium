import { extname, join, normalize } from 'node:path';

const root = import.meta.dir;
const portFlag = Bun.argv.findIndex((argument) => argument === '--port');
const inlinePort = Bun.argv.find((argument) => argument.startsWith('--port='));
const requestedPort = portFlag >= 0 ? Bun.argv[portFlag + 1] : inlinePort?.slice('--port='.length);
const port = Number(requestedPort || Bun.env.PORT || 3000);
const localOnly = Bun.argv.includes('--local-only') || Bun.env.MOLARIUM_LOCAL_ONLY === '1';
const testApi = Bun.argv.includes('--test-api') || Bun.env.MOLARIUM_TEST_API === '1';

const LOCAL_LAB_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  // RDKit's Emscripten/Embind glue constructs small JavaScript functions at
  // runtime. This does not relax the independent egress directives below.
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join('; ');

function responseHeaders(contentType, cacheControl = 'no-cache') {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), serial=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Molarium-Network-Policy': localOnly ? 'local-only-v1' : 'connected-v1',
  };
  if (localOnly) headers['Content-Security-Policy'] = LOCAL_LAB_POLICY;
  return headers;
}

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wgsl': 'text/plain; charset=utf-8',
});

const server = Bun.serve({
  port,
  ...(localOnly ? { hostname:'127.0.0.1' } : {}),
  async fetch(request) {
    const url = new URL(request.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad request', { status:400,
      headers:responseHeaders('text/plain; charset=utf-8') }); }
    if (pathname === '/runtime-config.js') {
      const config = {
        mode: localOnly ? 'local-lab' : 'connected',
        localOnly,
        policy: localOnly ? 'local-only-v1' : 'connected-v1',
        allowedNetworkOrigins: localOnly ? [url.origin] : ['user-approved external services'],
        buildManifest: '/local-lab-manifest.json',
        assetBase: null,
        testApi,
      };
      return new Response(`globalThis.MOLARIUM_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(config)});\n`, {
        headers: responseHeaders('text/javascript; charset=utf-8', 'no-store'),
      });
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    const absolute = join(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}/`))
      return new Response('Forbidden', { status:403,
        headers:responseHeaders('text/plain; charset=utf-8') });

    const file = Bun.file(absolute);
    if (!(await file.exists())) return new Response('Not found', { status:404,
      headers:responseHeaders('text/plain; charset=utf-8') });
    return new Response(file, {
      headers: responseHeaders(relative === 'LICENSE'
        ? 'text/plain; charset=utf-8'
        : CONTENT_TYPES[extname(absolute).toLowerCase()] || 'application/octet-stream'),
    });
  },
});

console.log(`Molarium ${localOnly ? 'Local Lab' : 'connected mode'} ready at ${server.url}`);
