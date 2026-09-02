import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCampaign, verifyCampaign } from '../ledger.mjs';
import { REGISTERED_DESIGN_ROUTE_SCHEMA,
  validateRegisteredDesignRoute } from './design-route.mjs';
import { verifyFrozenDesignRouteInput } from './design-route-provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const route = JSON.parse(await readFile(
  join(here, 'generated', 'sos1-prospective-campaign.json'), 'utf8'));

assert.equal(route.schema, REGISTERED_DESIGN_ROUTE_SCHEMA);
assert.equal(validateRegisteredDesignRoute(route, { expectedId:'sos1-hit-only' }), route);
assert.throws(() => validateRegisteredDesignRoute(
  { ...route, schema:'molarium.design-campaign/v1' }), /registered-design-route\/v1/);
assert.throws(() => validateRegisteredDesignRoute(
  { ...route, campaignId:'not-a-route-field' }), /must not contain ledger field campaignId/);

const ledger = createCampaign({ campaignId:'schema-separation-test', title:'Schema separation',
  createdAt:'2026-09-02T00:00:00.000Z' });
assert.throws(() => validateRegisteredDesignRoute(ledger), /registered-design-route\/v1/);
assert.deepEqual(await verifyCampaign(route), { valid:false, reason:'schema mismatch' });

const routeBytes = await readFile(join(here, 'generated', 'sos1-prospective-campaign.json'));
const currentSha256 = createHash('sha256').update(routeBytes).digest('hex');
assert.deepEqual(verifyFrozenDesignRouteInput(routeBytes, currentSha256),
  { currentSha256, schemaMigration:null });
const migrated = verifyFrozenDesignRouteInput(routeBytes,
  'e3706e4910dde647d68fe7ea1506177b18d47b662acc374630bbac8976d419bc');
assert.equal(migrated.schemaMigration.kind, 'schema-identifier-only');
assert.equal(migrated.schemaMigration.currentSha256, currentSha256);
assert.throws(() => verifyFrozenDesignRouteInput(
  Buffer.from(routeBytes.toString().replace('SOS1 five-state', 'SOS1 altered')),
  'e3706e4910dde647d68fe7ea1506177b18d47b662acc374630bbac8976d419bc'),
  /changed beyond/);

console.log('registered design route and campaign ledger schemas are distinct');
