const SHA256 = /^[a-f0-9]{64}$/;
export const MAX_CAMPAIGN_ASSET_BYTES = 32 * 1024 * 1024;

/** Lossless transport only: callers must still hash the decoded canonical bytes
 * and verify the campaign ledger before changing application state. Bound both
 * encoded and decoded streams, including adversarial compression ratios. */
export async function readCampaignAssetResponse(response, sourceEncoding) {
  if (sourceEncoding != null && sourceEncoding !== 'gzip')
    throw new Error('sourceEncoding must be gzip when supplied');
  if (!response.body) throw new Error('Campaign asset response has no body');
  let encodedBytes = 0;
  let stream = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    encodedBytes += chunk.byteLength;
    if (encodedBytes > MAX_CAMPAIGN_ASSET_BYTES)
      throw new Error('Campaign asset exceeds the 32 MiB transport limit');
    controller.enqueue(chunk);
  } }));
  if (sourceEncoding === 'gzip') stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_CAMPAIGN_ASSET_BYTES)
        throw new Error('Decoded campaign asset exceeds the 32 MiB limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

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
