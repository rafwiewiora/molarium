import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
for(const dir of ['',...(process.argv.includes('--dist')?['dist/']:[])]) {
  const html=await readFile(new URL(dir+'index.html',root),'utf8');
  const head=html.split('</head>')[0];
  const tags=[...head.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)];
  const meta=new Map(tags.map(m=>[m[1],m[2]]));
  assert.equal(tags.length,meta.size,'no duplicated metadata');
  assert.equal(meta.get('og:type'),'website');
  assert.equal(meta.get('og:site_name'),'Molarium');
  assert.equal(meta.get('og:url'),'https://molarium.org/');
  assert.match(head,/<link rel="canonical" href="https:\/\/molarium.org\/"/);
  assert.equal(meta.get('og:title'),head.match(/<title>(.*?)<\/title>/)[1]);
  assert.equal(meta.get('twitter:title'),meta.get('og:title'));
  assert.equal(meta.get('description'),meta.get('og:description'));
  assert.equal(meta.get('twitter:description'),meta.get('description'));
  assert.match(meta.get('description'),/Build, edit and simulate/);
  assert.equal(meta.get('twitter:card'),'summary_large_image');
  assert.equal(meta.get('twitter:image'),meta.get('og:image'));
  assert.equal(meta.get('twitter:image:alt'),meta.get('og:image:alt'));
  assert.ok(meta.get('og:image:alt').length>30);
  const url=new URL(meta.get('og:image'));
  assert.equal(url.origin,'https://molarium.org');
  const png=await readFile(new URL(dir+url.pathname.slice(1),root));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1200);
  assert.equal(png.readUInt32BE(20),630);
  assert.equal(meta.get('og:image:width'),'1200');
  assert.equal(meta.get('og:image:height'),'630');
  assert.equal(meta.get('og:image:type'),'image/png');
  assert.ok(png.length<1_000_000,'preview image stays compact');
  if(dir) {
    const manifest=JSON.parse(await readFile(new URL(dir+'local-lab-manifest.json',root),'utf8'));
    assert.ok(manifest.files.some(file=>file.path===url.pathname.slice(1)));
  }
}
console.log('Static crawler-readable metadata and deployed 1200 × 630 PNG: PASS');
