#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOS1_PREDICTION_DECLARATION } from
  './publish-sos1-frozen-browser-replays.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = async (path) => { try { await access(resolve(root, path)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

// Selection is explicit and fail-closed: a frozen-browser declaration, when
// present, must pass its own complete provenance verifier. It never falls back
// to or impersonates an accepted declaration.
if (await exists('design-history/publications/sos1/designer-intent-2026-09-04/release.json')) {
  const { verifySos1IntentRelease } = await import('./sos1-intent-release.mjs');
  const result = await verifySos1IntentRelease({ root });
  console.log(`SOS1 deployment preflight: verified designer intent · ${result.executableActions} actions · ${result.exactCheckpoints} exact checkpoints`);
  if (await exists('design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v1/movie.json')) {
    const { verifyCheckpointPopupMovie } = await import('./sos1-checkpoint-popups.mjs');
    const movie = await verifyCheckpointPopupMovie(root);
    console.log(`Checkpoint movie: ${movie.durationSeconds}s · ${movie.popups.length} recorded-calculation popups · 1s each`);
  }
} else if (await exists(SOS1_PREDICTION_DECLARATION)) {
  const { verifySos1FrozenBrowserPublication } = await import(
    './verify-sos1-frozen-browser-publication.mjs');
  const result = await verifySos1FrozenBrowserPublication({ root });
  console.log(`SOS1 deployment preflight: complete frozen prediction · ${result.runId}`);
} else {
  const { verifySos1Publication } = await import('./verify-sos1-publication.mjs');
  const result = await verifySos1Publication({ root });
  console.log(`SOS1 deployment preflight: accepted run · ${result.acceptedRunId}`);
}
