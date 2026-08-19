import { extname, join, normalize } from 'node:path';

const root = import.meta.dir;
const portFlag = Bun.argv.findIndex((argument) => argument === '--port');
const inlinePort = Bun.argv.find((argument) => argument.startsWith('--port='));
const requestedPort = portFlag >= 0 ? Bun.argv[portFlag + 1] : inlinePort?.slice('--port='.length);
const port = Number(requestedPort || 3010);

const contentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wgsl': 'text/plain; charset=utf-8',
});

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad request', { status: 400 }); }

    if (pathname === '/' || pathname === '/index.html') {
      const source = await Bun.file(join(root, 'index.html')).text();
      const html = source
        .replace('<title>Molarium — 3D Molecular Viewer &amp; Builder</title>',
          '<title>Molarium · Independent workspace study</title>')
        .replace('</head>', '    <link rel="stylesheet" href="./independent-layout-study.css" />\n  </head>')
        .replace('<body class="molarium-workspace">',
          '<body class="molarium-workspace independent-layout-study">');
      return new Response(html, { headers:{
        'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
      } });
    }

    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    const absolute = join(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}/`))
      return new Response('Forbidden', { status: 403 });
    const file = Bun.file(absolute);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file, { headers:{
      'Content-Type':contentTypes[extname(absolute).toLowerCase()] || 'application/octet-stream',
      'Cache-Control':'no-cache',
    } });
  },
});

console.log(`Molarium independent-layout study ready at ${server.url}`);
