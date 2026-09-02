import { createHash } from 'node:crypto';
import { REGISTERED_DESIGN_ROUTE_SCHEMA,
  validateRegisteredDesignRoute } from './design-route.mjs';

export const LEGACY_MISLABELLED_ROUTE_SCHEMA = 'molarium.design-campaign/v1';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Accept a frozen pre-migration hash only when replacing the schema identifier
 * in the current bytes reconstructs that exact historical file. Any scientific
 * or structural change therefore still fails provenance verification.
 */
export function verifyFrozenDesignRouteInput(bytes, frozenSha256) {
  if (typeof frozenSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(frozenSha256))
    throw new Error('Frozen design-route input requires a SHA-256 digest');
  const currentSha256 = digest(bytes);
  const route = JSON.parse(Buffer.from(bytes).toString('utf8'));
  validateRegisteredDesignRoute(route);
  if (currentSha256 === frozenSha256)
    return { currentSha256, schemaMigration:null };

  const currentToken = `"schema": "${REGISTERED_DESIGN_ROUTE_SCHEMA}"`;
  const legacyToken = `"schema": "${LEGACY_MISLABELLED_ROUTE_SCHEMA}"`;
  const text = Buffer.from(bytes).toString('utf8');
  if (text.split(currentToken).length !== 2)
    throw new Error('Registered design route does not contain one canonical schema field');
  const reconstructedLegacyBytes = Buffer.from(text.replace(currentToken, legacyToken));
  const reconstructedLegacySha256 = digest(reconstructedLegacyBytes);
  if (reconstructedLegacySha256 !== frozenSha256)
    throw new Error('Registered design route changed beyond the approved schema identifier migration');

  return { currentSha256, schemaMigration:{
    kind:'schema-identifier-only',
    fromSchema:LEGACY_MISLABELLED_ROUTE_SCHEMA,
    toSchema:REGISTERED_DESIGN_ROUTE_SCHEMA,
    frozenInputSha256:frozenSha256,
    currentSha256,
  } };
}
