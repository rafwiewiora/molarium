const DEFAULT_ENDPOINT = 'https://api.colabfold.com';
const terminalErrors = new Set(['ERROR', 'MAINTENANCE']);
const pendingStatuses = new Set(['UNKNOWN', 'RUNNING', 'PENDING']);
const submissionRetries = new Set(['UNKNOWN', 'RATELIMIT']);

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function normalizedEndpoint(endpoint) {
  const url = new URL(endpoint || DEFAULT_ENDPOINT);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The MSA endpoint must use HTTP or HTTPS.');
  return url.href.replace(/\/$/, '');
}

async function jsonResponse(response, context) {
  if (!response.ok) throw new Error(`${context} failed with HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error(`${context} returned an invalid response.`); }
}

function readTarString(bytes, start, length) {
  const zero = bytes.indexOf(0, start);
  const end = zero >= start && zero < start + length ? zero : start + length;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

export function extractTarFiles(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    if (bytes.subarray(offset, offset + 512).every((value) => value === 0)) break;
    const name = readTarString(bytes, offset, 100);
    const prefix = readTarString(bytes, offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const rawSize = readTarString(bytes, offset + 124, 12).trim().replace(/\0.*$/, '');
    const size = Number.parseInt(rawSize || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error('The MSA result contains an invalid tar entry.');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error('The MSA result archive is truncated.');
    const type = String.fromCharCode(bytes[offset + 156] || 48);
    if (type === '0' || type === '\0') files.set(path, bytes.slice(dataStart, dataEnd));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function gunzip(buffer) {
  if (typeof DecompressionStream !== 'function')
    throw new Error('This browser cannot decompress the MSA result (DecompressionStream is unavailable).');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeColabFoldArchive(buffer, useEnvironment = true) {
  const files = extractTarFiles(await gunzip(buffer));
  const decoder = new TextDecoder();
  const pick = (suffix) => [...files].find(([name]) => name.endsWith(suffix))?.[1];
  const uniref = pick('uniref.a3m');
  const environment = pick('bfd.mgnify30.metaeuk30.smag30.a3m');
  if (!uniref) throw new Error('The MSA archive did not contain uniref.a3m.');
  const documents = [decoder.decode(uniref)];
  if (useEnvironment && environment) documents.push(decoder.decode(environment));
  return { documents, files: [...files.keys()] };
}

export class ColabFoldMsaProvider {
  constructor({ endpoint = DEFAULT_ENDPOINT, useEnvironment = true, useFilter = true,
    fetchImplementation = globalThis.fetch, pollIntervalMs = 6000, jitterMs = 2000,
    maxWaitMs = 20 * 60 * 1000 } = {}) {
    this.endpoint = normalizedEndpoint(endpoint);
    this.useEnvironment = useEnvironment;
    this.useFilter = useFilter;
    // Window.fetch is receiver-sensitive in some browsers. Calling a stored
    // reference as `this.fetch(...)` otherwise binds `this` to the provider
    // instance and throws "Illegal invocation" before the request is sent.
    this.fetch = fetchImplementation.bind(globalThis);
    this.pollIntervalMs = pollIntervalMs;
    this.jitterMs = jitterMs;
    this.maxWaitMs = maxWaitMs;
    this.cache = new Map();
  }

  get mode() {
    if (this.useFilter) return this.useEnvironment ? 'env' : 'all';
    return this.useEnvironment ? 'env-nofilter' : 'nofilter';
  }

  async submit(sequence, signal) {
    const body = new URLSearchParams({ q: `>101\n${sequence}\n`, mode: this.mode });
    const response = await this.fetch(`${this.endpoint}/ticket/msa`, { method: 'POST', body, signal });
    return jsonResponse(response, 'MSA submission');
  }

  async status(id, signal) {
    const response = await this.fetch(`${this.endpoint}/ticket/${encodeURIComponent(id)}`, { signal });
    return jsonResponse(response, 'MSA status check');
  }

  async search(request, { signal, onProgress = () => {} } = {}) {
    const proteins = request?.entities?.filter((entity) => entity.type === 'protein') || [];
    if (proteins.length !== 1 || request.entities.length !== 1)
      throw new Error('The current OpenFold model supports one protein entity; the request shape is OpenFold3-ready.');
    const sequence = proteins[0].sequence;
    const cacheKey = `${this.endpoint}|${this.mode}|${sequence}`;
    if (this.cache.has(cacheKey)) {
      onProgress({ stage: 'complete', message: 'Using cached MSA', cached: true });
      return this.cache.get(cacheKey);
    }

    let ticket;
    for (let attempt = 0; attempt < 8; attempt++) {
      onProgress({ stage: 'submitting', message: attempt ? 'MSA service busy; resubmitting…' : 'Submitting sequence to MSA service…' });
      ticket = await this.submit(sequence, signal);
      if (!submissionRetries.has(ticket.status)) break;
      await delay(this.pollIntervalMs + Math.floor(Math.random() * this.jitterMs), signal);
    }
    if (!ticket || submissionRetries.has(ticket.status)) throw new Error('The MSA service remained rate-limited. Try again later.');
    if (terminalErrors.has(ticket.status))
      throw new Error(ticket.status === 'MAINTENANCE' ? 'The MSA service is under maintenance.' : 'The MSA service rejected this sequence.');
    if (!ticket.id) throw new Error('The MSA service did not return a ticket ID.');

    const started = Date.now();
    let state = ticket;
    while (pendingStatuses.has(state.status)) {
      if (Date.now() - started > this.maxWaitMs) throw new Error('The MSA search timed out.');
      onProgress({ stage: 'searching', message: `Searching sequence databases… ${state.status.toLowerCase()}`, status: state.status, id: ticket.id });
      await delay(this.pollIntervalMs + Math.floor(Math.random() * this.jitterMs), signal);
      state = await this.status(ticket.id, signal);
    }
    if (state.status !== 'COMPLETE')
      throw new Error(state.status === 'MAINTENANCE' ? 'The MSA service entered maintenance.' : `MSA search ended with status ${state.status}.`);

    onProgress({ stage: 'downloading', message: 'Downloading MSA result…', id: ticket.id });
    const response = await this.fetch(`${this.endpoint}/result/download/${encodeURIComponent(ticket.id)}`, { signal });
    if (!response.ok) throw new Error(`MSA result download failed with HTTP ${response.status}.`);
    const decoded = await decodeColabFoldArchive(await response.arrayBuffer(), this.useEnvironment);
    const result = { provider: 'colabfold-mmseqs2', endpoint: this.endpoint, mode: this.mode,
      ticketId: ticket.id, documents: decoded.documents, archiveFiles: decoded.files, elapsedMs: Date.now() - started };
    this.cache.set(cacheKey, result);
    onProgress({ stage: 'complete', message: 'MSA ready', id: ticket.id });
    return result;
  }
}

export class ProvidedMsaProvider {
  constructor(documents) { this.documents = documents; }
  async search(_request, { onProgress = () => {} } = {}) {
    onProgress({ stage: 'complete', message: 'Using provided MSA' });
    return { provider: 'provided-a3m', documents: this.documents, elapsedMs: 0 };
  }
}
