import { canonicalValue, sha256Object } from '../design-history/integrity.mjs';

export const REFINEMENT_CAPTURE_SCHEMA = 'molarium.refined-pose-capture/v1';
export const REFINEMENT_CAPTURE_DB_NAME = 'molarium-refinement-captures';
export const REFINEMENT_CAPTURE_STORE_NAME = 'captures';
export const REFINEMENT_CAPTURE_WORKSPACE_STORE_NAME = 'workspace';
export const REFINEMENT_CAPTURE_DB_VERSION = 1;

function digest(value, label) {
  const text = String(value || '');
  if (!/^[0-9a-f]{64}$/.test(text))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return text;
}

function finitePositions(value, atomCount) {
  const positions = Array.from(value || [], Number);
  if (positions.length !== atomCount * 3 || !positions.every(Number.isFinite))
    throw new Error('Refined-pose capture coordinates do not match its atom IDs');
  return positions;
}

async function coordinateArraySha256(positions) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    Float64Array.from(positions, Number).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function refinementCaptureDescriptor(record) {
  return canonicalValue({
    schema:record.capture.schema,
    captureId:record.captureId,
    atomCount:record.capture.atomIds.length,
    selectedRank:record.capture.selectedRank,
    selectedFeasible:record.capture.selectedFeasible,
    promotable:false,
    selectedCoordinateSha256:record.capture.selectedCoordinateSha256,
    selectedStateSha256:record.capture.selectedStateSha256,
  });
}

export async function createRefinementCapture({ inputStateSha256,
  selectedStateSha256, selectedCoordinateSha256, atomIds, positions,
  selectedRank, selectedFeasible }) {
  const ids = Array.from(atomIds || [], (value) => String(value || ''));
  if (!ids.length || ids.some((value) => !value) || new Set(ids).size !== ids.length)
    throw new Error('Refined-pose capture requires unique persistent atom IDs');
  const coordinates = finitePositions(positions, ids.length);
  const coordinateSha256 = digest(selectedCoordinateSha256, 'selectedCoordinateSha256');
  if (await coordinateArraySha256(coordinates) !== coordinateSha256)
    throw new Error('Refined-pose capture coordinates do not match selectedCoordinateSha256');
  const rank = Number(selectedRank);
  if (!Number.isInteger(rank) || rank < 1)
    throw new Error('Refined-pose capture requires a positive selected rank');
  const capture = canonicalValue({
    schema:REFINEMENT_CAPTURE_SCHEMA,
    disposition:'unapplied-candidate',
    promotable:false,
    inputStateSha256:digest(inputStateSha256, 'inputStateSha256'),
    selectedStateSha256:digest(selectedStateSha256, 'selectedStateSha256'),
    selectedCoordinateSha256:coordinateSha256,
    selectedRank:rank,
    selectedFeasible:selectedFeasible === true,
    coordinates:{ unit:'angstrom', layout:'interleaved-xyz' },
    atomIds:ids,
    positions:coordinates,
  });
  return canonicalValue({ captureId:await sha256Object(capture), capture });
}

export async function verifyRefinementCapture(record) {
  if (record?.capture?.schema !== REFINEMENT_CAPTURE_SCHEMA)
    return { valid:false, reason:`Expected ${REFINEMENT_CAPTURE_SCHEMA}` };
  try {
    const rebuilt = await createRefinementCapture({
      ...record.capture,
      positions:record.capture.positions,
      atomIds:record.capture.atomIds,
    });
    if (rebuilt.captureId !== record.captureId)
      return { valid:false, reason:'Refined-pose capture content hash changed' };
    return { valid:true, captureId:record.captureId };
  } catch (error) {
    return { valid:false, reason:String(error?.message || error) };
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once:true });
    request.addEventListener('error', () => reject(
      request.error || new Error('Refined-pose capture request failed')), { once:true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once:true });
    transaction.addEventListener('abort', () => reject(
      transaction.error || new Error('Refined-pose capture transaction aborted')), { once:true });
    transaction.addEventListener('error', () => reject(
      transaction.error || new Error('Refined-pose capture transaction failed')), { once:true });
  });
}

export function createRefinementCaptureStore({ indexedDB = globalThis.indexedDB,
  dbName = REFINEMENT_CAPTURE_DB_NAME, storeName = REFINEMENT_CAPTURE_STORE_NAME,
  workspaceStoreName = REFINEMENT_CAPTURE_WORKSPACE_STORE_NAME,
  now = () => new Date().toISOString() } = {}) {
  if (!indexedDB?.open) throw new Error('IndexedDB is unavailable for refined-pose capture');
  let databasePromise = null;
  const open = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, REFINEMENT_CAPTURE_DB_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName))
          database.createObjectStore(storeName, { keyPath:'captureId' });
        if (!database.objectStoreNames.contains(workspaceStoreName))
          database.createObjectStore(workspaceStoreName, { keyPath:'key' });
      });
      request.addEventListener('success', () => resolve(request.result), { once:true });
      request.addEventListener('error', () => reject(
        request.error || new Error('Refined-pose capture database failed to open')), { once:true });
      request.addEventListener('blocked', () => reject(
        new Error('Refined-pose capture database upgrade is blocked')), { once:true });
    });
    return databasePromise;
  };
  const checked = async (record) => {
    const verification = await verifyRefinementCapture(record);
    if (!verification.valid) throw new Error(verification.reason);
    return canonicalValue(record);
  };
  return Object.freeze({
    async save(record) {
      const capture = await checked(record);
      const database = await open();
      const transaction = database.transaction([storeName, workspaceStoreName], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).put({ ...capture, savedAt:String(now()) });
      transaction.objectStore(workspaceStoreName).put({ key:'latest',
        captureId:capture.captureId });
      await done;
      return refinementCaptureDescriptor(capture);
    },
    async load(captureId) {
      const database = await open();
      const transaction = database.transaction(storeName, 'readonly');
      const done = transactionDone(transaction);
      const record = await requestResult(transaction.objectStore(storeName)
        .get(digest(captureId, 'captureId')));
      await done;
      if (!record) return null;
      const { savedAt:unused, ...capture } = record;
      void unused;
      return checked(capture);
    },
    async latest() {
      const database = await open();
      const transaction = database.transaction(workspaceStoreName, 'readonly');
      const done = transactionDone(transaction);
      const latest = await requestResult(transaction.objectStore(workspaceStoreName).get('latest'));
      await done;
      return latest?.captureId ? this.load(latest.captureId) : null;
    },
  });
}

export function createMemoryRefinementCaptureStore() {
  const records = new Map();
  let latestId = null;
  return Object.freeze({
    async save(record) {
      const verification = await verifyRefinementCapture(record);
      if (!verification.valid) throw new Error(verification.reason);
      const copy = canonicalValue(record);
      records.set(copy.captureId, copy); latestId = copy.captureId;
      return refinementCaptureDescriptor(copy);
    },
    async load(captureId) {
      const record = records.get(String(captureId));
      return record ? canonicalValue(record) : null;
    },
    async latest() {
      const record = latestId ? records.get(latestId) : null;
      return record ? canonicalValue(record) : null;
    },
  });
}
