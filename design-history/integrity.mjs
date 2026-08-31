const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function canonicalValue(value, seen = new Set()) {
  if (ArrayBuffer.isView(value)) return Array.from(value, (entry) => canonicalValue(entry, seen));
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Canonical records cannot contain cycles');
    seen.add(value);
    const result = value.map((entry) => canonicalValue(entry, seen));
    seen.delete(value);
    return result;
  }
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('Canonical records must contain only plain JSON objects');
    if (seen.has(value)) throw new TypeError('Canonical records cannot contain cycles');
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Canonical record key ${key} is forbidden`);
      if (value[key] !== undefined) result[key] = canonicalValue(value[key], seen);
    }
    seen.delete(value);
    return result;
  }
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError('Canonical records cannot contain non-finite numbers');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
    || typeof value === 'bigint')
    throw new TypeError(`Unsupported canonical record value: ${typeof value}`);
  return value;
}

export function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

export async function sha256Text(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Object(value) { return sha256Text(canonicalJson(value)); }

export function cloneRecord(value) { return canonicalValue(value); }
