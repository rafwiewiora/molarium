import {realpath,stat} from 'node:fs/promises';
import {join,sep} from 'node:path';

// Exact public paths, not a checkout-wide extension or directory allowlist.
// A declared public filename must not resolve through a symlink outside root.
export async function resolvePublicFile(root, pathname, allowedPaths) {
  let decoded;
  try { decoded=decodeURIComponent(pathname); } catch { return null; }
  if (/[\\\0]/.test(decoded) || decoded.split('/').some(part=>part.startsWith('.')))
    return null;
  let relative=decoded.replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) relative+='index.html';
  if (!allowedPaths.has(relative)) return null;
  try {
    const canonicalRoot=await realpath(root);
    const absolute=await realpath(join(root,relative));
    if (!absolute.startsWith(canonicalRoot+sep) || !(await stat(absolute)).isFile()) return null;
    return {absolute,relative};
  } catch (error) {
    if (['ENOENT','ENOTDIR','EACCES','ELOOP'].includes(error.code)) return null;
    throw error;
  }
}
