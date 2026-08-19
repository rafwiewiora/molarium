// Static-hosting default. `bun server.js --local-only` replaces this response
// with the browser-enforced Local Lab policy before app.js is evaluated.
globalThis.MOLARIUM_RUNTIME_CONFIG = Object.freeze({
  mode: 'connected',
  localOnly: false,
  policy: 'connected-v1',
  allowedNetworkOrigins: ['user-approved external services'],
  buildManifest: './local-lab-manifest.json',
  assetBase: null,
});
