const SHA256 = /^[a-f0-9]{64}$/;

/** Resolve a hash-pinned campaign asset without granting the action API an
 * arbitrary network fetch primitive. Only explicit, traversal-free, same-origin
 * repository paths are accepted. */
export function resolveCampaignAssetSource(sourcePath, sourceSha256, baseUrl) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim())
    throw new Error('sourcePath must be a non-empty relative campaign asset path');
  if (!SHA256.test(String(sourceSha256 || '')))
    throw new Error('sourceSha256 must be a lowercase SHA-256 digest');
  const raw = sourcePath.trim();
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')
    || raw.split('/').includes('..') || raw.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(raw))
    throw new Error('sourcePath must be traversal-free and relative');
  const base = new URL(baseUrl);
  const url = new URL(raw, base);
  if (url.origin !== base.origin)
    throw new Error('sourcePath must resolve on the Molarium origin');
  return Object.freeze({ url:url.href, sourcePath:raw, sourceSha256 });
}
