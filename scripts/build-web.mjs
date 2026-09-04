import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const requestedAssetOrigin = String(process.env.MOLARIUM_ASSET_ORIGIN || 'https://assets.molarium.org');
const parsedAssetOrigin = new URL(requestedAssetOrigin);
if (!['https:', 'http:'].includes(parsedAssetOrigin.protocol))
  throw new Error(`Unsupported asset origin protocol: ${parsedAssetOrigin.protocol}`);
const assetOrigin = parsedAssetOrigin.origin;
const assetRelease = String(process.env.MOLARIUM_ASSET_RELEASE || `v${packageJson.version}`).replace(/^\/+|\/+$/g, '');
const assetBase = `${assetOrigin}/${assetRelease}/`;

const files = [
  'design-history/examples/sos1-prediction.action-script.json',
  'design-history/examples/sos1-prediction-checkpoint-review.action-script.json',
  'design-history/publications/sos1/browser-replay-declaration.json',
  'design-history/publications/sos1/checkpoints/scaffold-rewrite-campaign.json',
  'design-history/publications/sos1/checkpoints/fragment-merge-campaign.json',
  'design-history/publications/sos1/checkpoints/open-phe890-pocket-campaign.json',
  'design-history/publications/sos1/checkpoints/finish-bay-293-campaign.json',
  'LICENSE', 'NOTICE', 'README.md', 'CHEMIST-ACTIONS-API.md', 'DESIGNER-MOVES.md', 'THIRD_PARTY_NOTICES.md',
  'index.html', 'app.js', 'chemist-actions.mjs', 'styles.css', 'molarium-workspace.css', 'independent-layout-study.css',
  'molecular-state-hash.mjs',
  'protein-residue-templates.js', 'rdkit-worker.js', 'openmm-worker.js', 'webgpu-worker.js',
  'stormm-worker.js', 'mlip-worker.js', 'local-lab-test.js',
  'validation/README.md', 'validation/dashboard.mjs', 'validation/registry.v0.1.json',
  'validation/registry.v0.2.json',
  'docking/benchmark/manifest.v0.1.json', 'docking/benchmark/benchmark-results.v0.1.scored.json',
  'docking/benchmark/RESULTS.v0.1.md', 'docking/benchmark/7kpa-two-terminus-panel.v0.1.json',
  'docking/benchmark/7kpa-two-terminus-panel.mjs',
  'docking/benchmark/7kpa-manual-contact-panel.mjs',
  'docking/benchmark/7kpa-manual-contact-panel.README.md',
  'docking/benchmark/7kpa-manual-contact-smoke.v0.1.json',
  'docking/benchmark/7kpa-manual-contact-results.psiblue.v0.1.json',
  'docking/registered-pose-retention.mjs',
  'docking/registered-spatial-feature-restraint.mjs',
  'design-history/README.md', 'design-history/integrity.mjs', 'design-history/ledger.mjs',
  'design-history/movie.mjs', 'design-history/replay.mjs', 'design-history/interface-story.mjs',
  'design-history/designer-replay-review.mjs',
  'design-history/campaign-source.mjs',
  'scripts/verify-sos1-frozen-browser-publication.mjs',
  'scripts/verify-sos1-deployment.mjs',
  'design-history/live-campaign.mjs', 'design-history/live-campaign-store.mjs',
  'design-history/structures/design-route.mjs',
  'design-history/structures/registered-ligand-graph.mjs',
  'design-history/structures/ligands/bq5-rcsb-ccd.json',
  'design-history/stories/generated/index.json',
  'design-history/stories/generated/bclxl-fragment-linking.campaign.json',
  'design-history/stories/generated/bclxl-fragment-linking.movie.json',
  'design-history/stories/generated/molarium-7kpa-rehearsal.campaign.json',
  'design-history/stories/generated/molarium-7kpa-rehearsal.movie.json',
  'design-history/stories/generated/moonshot-dndi-6510.campaign.json',
  'design-history/stories/generated/moonshot-dndi-6510.movie.json',
  'design-history/viewer/index.html', 'design-history/viewer/model.mjs',
  'design-history/viewer/styles.css', 'design-history/viewer/viewer.mjs',
  'design-history/structure-viewer/index.html', 'design-history/structure-viewer/timeline.mjs',
  'design-history/structure-viewer/viewer.mjs',
  'design-history/structure-viewer/checkpoint-review.mjs',
  'design-history/structure-viewer/moonshot-dndi-6510.json',
  'design-history/structure-viewer/bclxl-fragment-linking.json',
  'design-history/structure-viewer/cdk2-hit-only-prospective.json',
  'design-history/structure-viewer/cdk2-designer-hit-to-lead.json',
  'design-history/structure-review/index.html',
  'design-history/structures/generated/manifest.json',
  'design-history/structures/generated/bclxl-trajectory-manifest.json',
  'design-history/structures/generated/bclxl-prospective-campaign.json',
  'design-history/structures/generated/cdk2-prospective-campaign.json',
  'design-history/structures/generated/cdk2-designer-campaign.json',
  'design-history/structures/generated/cdk2-1h1q-protein.pdb',
  'design-history/structures/generated/cdk2-1h1q-ligand.pdb',
  'design-history/structures/generated/cdk2-1h1q-pocket.pdb',
  'design-history/structures/generated/cdk2-6cp-frozen-prediction.pdb',
  'design-history/structures/generated/cdk2-1h1r-6cp-aligned-holdout.pdb',
  'design-history/structures/generated/cdk2-n76-frozen-prediction.pdb',
  'design-history/structures/generated/cdk2-1oiu-n76-aligned-holdout.pdb',
  'design-history/structures/generated/cdk2-prospective-movie-assets.json',
  'design-history/structures/generated/cdk2-designer-6cp-prediction.pdb',
  'design-history/structures/generated/cdk2-designer-n76-prediction.pdb',
  'design-history/structures/generated/cdk2-designer-movie-assets.json',
  'design-history/structures/generated/sos1-prospective-campaign.json',
  'design-history/structures/generated/sos1-5ove-protein.pdb',
  'design-history/structures/generated/sos1-5ove-ligand.pdb',
  'design-history/structures/generated/7gn8-protein.pdb',
  'design-history/structures/generated/7gn8-pocket.pdb',
  'design-history/structures/generated/7gn8-ligand.pdb',
  'design-history/structures/generated/7gn8-interactions.mol',
  'design-history/structures/generated/7gnr-aligned-protein.pdb',
  'design-history/structures/generated/7gnr-aligned-pocket.pdb',
  'design-history/structures/generated/7gnr-aligned-ligand.pdb',
  'design-history/structures/generated/7gnr-aligned-interactions.mol',
  'design-history/structures/generated/3spf-protein.pdb',
  'design-history/structures/generated/3spf-pocket.pdb',
  'design-history/structures/generated/3spf-ligand.pdb',
  'design-history/structures/generated/3sp7-aligned-protein.pdb',
  'design-history/structures/generated/3sp7-aligned-pocket.pdb',
  'design-history/structures/generated/3sp7-aligned-ligand.pdb',
  'design-history/structures/generated/bclxl-compound-6-reconstructed.mol',
  'design-history/structures/generated/bclxl-compound-7-reconstructed.mol',
  'design-history/structures/generated/bclxl-compound-16-reconstructed.mol',
  'design-history/structures/generated/bclxl-compound-21-reconstructed.mol',
  'docking/validation/pose-viewer/vendor/molstar-5.11.0.css',
  'docking/validation/pose-viewer/vendor/molstar-5.11.0.js',
  'docking/validation/cloud-panel/browser-sage-openmm-validation-2026-08-23.json',
  'docking/validation/cloud-panel/browser-sage-openmm-obc2-diagnostic-2026-08-23.json',
  'docking/validation/cloud-panel/openmm-wasm-native-validation-2026-08-23.json',
  'docking/validation/cloud-panel/RESULTS-2026-08-23.md',
  'assets/lsd-launch.mol', 'assets/molarium-logo.svg', 'assets/molarium-mark.svg',
  'assets/media/sos1-designer-moves-molarium-interface.mp4',
  'assets/media/sos1-designer-moves-molarium-interface.render-manifest.json',
  'licenses/APACHE-2.0-LICENSE.txt', 'licenses/DIMORPHITE-DL-NOTICE.txt', 'licenses/ONNXRUNTIME-1.27.0-THIRD-PARTY-NOTICES.txt',
  'licenses/ONNXRUNTIME-LICENSE.txt', 'licenses/OPENFOLD-LICENSE.txt', 'licenses/PDBFIXER-LICENSE.txt',
  'mlip/README.md', 'mlip/TORCHANI-LICENSE.txt', 'mlip/ani2x.js', 'mlip/ani2x-webgpu.js',
  'openff/OPENFF-FORCEFIELDS-LICENSE.txt', 'openff/README.md', 'openff/conformer-arena.js',
  'openff/conformer-protocol.js', 'openff/implicit-solvent.js', 'openff/rosemary-trp-cage.json',
  'openff/rosemary-ubiquitin.json', 'openff/sage-2.1.0.json', 'openff/sage-parameterizer.js',
  'openff/simulation-options.js', 'openff/ubiquitin-1ubq-prepared.pdb',
  'openfold/features.js', 'openfold/msa-client.js', 'openfold/predictor.js',
  'openfold-export-results/trained/MODEL-CARD.md',
  'openmm/OPENMM-LICENSE.txt', 'openmm/README.md', 'openmm/molarium-openmm.js', 'openmm/molarium-openmm.wasm',
  'rdkit/RDKIT-LICENSE.txt', 'rdkit/README.md', 'rdkit/dimorphite-sites.js',
  'rdkit/dist/RDKit_minimal.js', 'rdkit/dist/RDKit_minimal.wasm',
  'docking/browser-adapter.mjs', 'docking/constraints.mjs', 'docking/contact-remap.mjs',
  'docking/manual-hbond.mjs',
  'docking/feature-seeding.mjs', 'docking/restraint-biased-search.mjs',
  'docking/labbook.mjs', 'docking/protocol.mjs', 'docking/receptor-score.mjs',
  'docking/pose-propagation-scoring.mjs', 'docking/pose-search-ensemble.mjs',
  'docking/pose-search-worker.mjs',
  'docking/reference-core.mjs', 'docking/registered-graph-edit.mjs',
  'docking/sidechain-rotamers.mjs', 'docking/torsion-search.mjs',
  'docking/transformed-ring-region.mjs', 'docking/workflow.mjs',
  'stormm/LICENSE', 'stormm/README.md', 'stormm/core.mjs', 'stormm/engine.mjs',
  'webgpu/README.md', 'webgpu/molarium-webgpu.wgsl',
  'vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs',
];

// Fail during the build, rather than in the browser, when a top-level app
// module is omitted from the explicit Cloudflare bundle.
const deployedFiles = new Set(files);
const appSource = await readFile(join(root, 'app.js'), 'utf8');
for (const match of appSource.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
  const importedPath = match[1].replace(/^\.\//, '');
  if (!deployedFiles.has(importedPath))
    throw new Error(`app.js imports ${importedPath}, but the web bundle omits it`);
}

const headers = `/*
  Cache-Control: no-cache
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Origin-Agent-Cluster: ?1
  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), serial=(), usb=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Content-Security-Policy: default-src 'self'; base-uri 'none'; connect-src 'self' ${assetOrigin} https://files.rcsb.org https://api.colabfold.com; font-src 'self'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self' ${assetOrigin} blob: 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:
`;

await rm(output, { recursive: true, force: true });
for (const path of files) {
  const source = join(root, path);
  const destination = join(output, path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

await writeFile(join(output, 'runtime-config.js'),
  `globalThis.MOLARIUM_RUNTIME_CONFIG = Object.freeze(${JSON.stringify({
    mode:'connected', localOnly:false, policy:'connected-v1',
    allowedNetworkOrigins:[assetOrigin, 'https://files.rcsb.org', 'https://api.colabfold.com'],
    buildManifest:'./local-lab-manifest.json', assetBase,
  })});\n`);
await writeFile(join(output, '_headers'), headers);
await writeFile(join(output, '_redirects'), [
  '/sos1-hit-to-bay293/replay /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/replay/ /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/review /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/review/ /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293 /?story=sos1-hit-to-bay293 302',
  '/sos1-hit-to-bay293/ /?story=sos1-hit-to-bay293 302',
  '',
].join('\n'));

const manifestFiles = [];
// Cloudflare Pages consumes `_headers` as deployment configuration and does not
// guarantee that it remains fetchable as a public asset. Verify only files the
// deployed application can retrieve.
for (const path of [...files, 'runtime-config.js'].sort()) {
  const bytes = await readFile(join(output, path));
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error(`${path} is ${(bytes.length / 1024 / 1024).toFixed(2)} MiB; Cloudflare Pages permits at most 25 MiB`);
  manifestFiles.push({ path, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') });
}
const manifest = {
  schema:'molarium.web-release.v1', algorithm:'SHA-256', version:packageJson.version,
  assetBase, files:manifestFiles,
};
await writeFile(join(output, 'local-lab-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const totalBytes = manifestFiles.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`Built ${relative(root, output)}: ${manifestFiles.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`External assets: ${assetBase}`);
