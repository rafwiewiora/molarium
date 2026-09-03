import { canonicalJson } from './integrity.mjs';
import { CAMPAIGN_SCHEMA, verifyCampaign } from './ledger.mjs';

export const LIVE_CAMPAIGN_DB_NAME = 'molarium-design-history';
export const LIVE_CAMPAIGN_STORE_NAME = 'campaigns';
export const LIVE_CAMPAIGN_WORKSPACE_STORE_NAME = 'workspace';
export const LIVE_CAMPAIGN_DB_VERSION = 2;

export function serializeCampaign(campaign) {
  if (campaign?.schema !== CAMPAIGN_SCHEMA) throw new Error(`Expected ${CAMPAIGN_SCHEMA}`);
  return `${canonicalJson(campaign)}\n`;
}

export function deserializeCampaign(text) {
  let campaign;
  try { campaign = JSON.parse(String(text)); }
  catch { throw new Error('Campaign JSON is invalid'); }
  if (campaign?.schema !== CAMPAIGN_SCHEMA) throw new Error(`Expected ${CAMPAIGN_SCHEMA}`);
  return campaign;
}

export function campaignStorageRecord(campaign, { activeBranch = 'main',
  updatedAt = new Date().toISOString() } = {}) {
  if (!Object.hasOwn(campaign?.branches || {}, activeBranch))
    throw new Error(`Unknown active campaign branch: ${activeBranch}`);
  return { campaignId:String(campaign.campaignId), activeBranch:String(activeBranch),
    updatedAt:String(updatedAt),
    campaignJson:serializeCampaign(campaign) };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once:true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB request failed')),
      { once:true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once:true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted')),
      { once:true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed')),
      { once:true });
  });
}

export function createLiveCampaignStore({ indexedDB = globalThis.indexedDB,
  dbName = LIVE_CAMPAIGN_DB_NAME, storeName = LIVE_CAMPAIGN_STORE_NAME,
  workspaceStoreName = LIVE_CAMPAIGN_WORKSPACE_STORE_NAME } = {}) {
  if (!indexedDB?.open) throw new Error('IndexedDB is unavailable');
  let databasePromise = null;
  const open = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, LIVE_CAMPAIGN_DB_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath:'campaignId' });
          store.createIndex('updatedAt', 'updatedAt', { unique:false });
        }
        if (!database.objectStoreNames.contains(workspaceStoreName))
          database.createObjectStore(workspaceStoreName, { keyPath:'key' });
      });
      request.addEventListener('success', () => resolve(request.result), { once:true });
      request.addEventListener('error', () => reject(request.error || new Error('IndexedDB open failed')),
        { once:true });
      request.addEventListener('blocked', () => reject(new Error('IndexedDB upgrade is blocked')),
        { once:true });
    });
    return databasePromise;
  };
  return Object.freeze({
    async save(campaign, { activeBranch = 'main' } = {}) {
      const verification = await verifyCampaign(campaign);
      if (!verification.valid) throw new Error(`Campaign is invalid: ${verification.reason}`);
      const database = await open();
      const transaction = database.transaction([storeName, workspaceStoreName], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).put(campaignStorageRecord(campaign, { activeBranch }));
      transaction.objectStore(workspaceStoreName).put({ key:'active-campaign',
        campaignId:campaign.campaignId, activeBranch });
      await done;
      return { campaignId:campaign.campaignId, activeBranch };
    },
    async load(campaignId) {
      const database = await open(), transaction = database.transaction(storeName, 'readonly');
      const done = transactionDone(transaction);
      const record = await requestResult(transaction.objectStore(storeName).get(String(campaignId)));
      await done;
      if (!record) return null;
      const campaign = deserializeCampaign(record.campaignJson);
      const verification = await verifyCampaign(campaign);
      if (!verification.valid) throw new Error(`Stored campaign is invalid: ${verification.reason}`);
      return { campaign, activeBranch:Object.hasOwn(campaign.branches || {}, record.activeBranch)
        ? record.activeBranch : 'main' };
    },
    async loadActive() {
      const database = await open();
      const transaction = database.transaction(workspaceStoreName, 'readonly');
      const done = transactionDone(transaction);
      const workspace = await requestResult(transaction.objectStore(workspaceStoreName)
        .get('active-campaign'));
      await done;
      return workspace?.campaignId ? this.load(workspace.campaignId) : null;
    },
    async list() {
      const database = await open(), transaction = database.transaction(storeName, 'readonly');
      const done = transactionDone(transaction);
      const records = await requestResult(transaction.objectStore(storeName).getAll());
      await done;
      return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((record) => ({ campaignId:record.campaignId,
          activeBranch:record.activeBranch || 'main', updatedAt:record.updatedAt }));
    },
    async delete(campaignId) {
      const database = await open(), transaction = database.transaction(storeName, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).delete(String(campaignId));
      await done;
    },
    async closeActive() {
      const database = await open();
      const transaction = database.transaction(workspaceStoreName, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(workspaceStoreName).delete('active-campaign');
      await done;
    },
    async close() {
      const database = await databasePromise;
      database?.close(); databasePromise = null;
    },
  });
}
