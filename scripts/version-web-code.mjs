import { createHash } from 'node:crypto';
import { dirname, posix } from 'node:path';

export function webCodeVersion(entries) {
  const hash=createHash('sha256');
  for(const [path,bytes] of [...entries].sort(([a],[b])=>a.localeCompare(b)))
    hash.update(path+'\0').update(createHash('sha256').update(bytes).digest()).update('\0');
  return hash.digest('hex');
}

export function versionWebCode(source,path,files,version) {
  const versionUrl=url=>{
    if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || /[$\\{}]/.test(url)) return url;
    const [pathname]=url.split(/[?#]/);
    if(!/\.(?:js|mjs|css)$/.test(pathname)) return url;
    const resolved=pathname.startsWith('/') ? pathname.slice(1)
      : posix.normalize(posix.join(dirname(path),pathname));
    if(!files.has(resolved)) return url;
    const parsed=new URL(url,'https://build.invalid/');
    parsed.searchParams.set('v',version);
    return pathname+parsed.search+parsed.hash;
  };
  if(path.endsWith('.html')) return source.replace(/\b(src|href)=(['"])([^'"\n]+)\2/g,
    (_,attr,quote,url)=>`${attr}=${quote}${versionUrl(url)}${quote}`);
  if(!/\.(?:mjs|js)$/.test(path)) return source;
  // Rewrite module/worker dependencies, not arbitrary strings, model assets,
  // recorded scientific inputs or external immutable asset URLs.
  return source.replace(/(\b(?:from\s+|import\s*\(\s*|import\s+|importScripts\s*\(\s*|new\s+(?:URL|Worker)\(\s*))(['"])([^'"\n]+)\2/g,
    (_,prefix,quote,url)=>`${prefix}${quote}${versionUrl(url)}${quote}`);
}
