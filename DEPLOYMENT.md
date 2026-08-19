# Deploying Molarium

Molarium is a static browser application. Cloudflare Pages serves the application bundle and
Cloudflare R2 serves versioned model and ONNX Runtime assets that exceed the Pages file limit.

## Cloudflare resources

- Pages project: `molarium`
- Production domain: `molarium.org`
- R2 bucket: `molarium-assets`
- R2 custom domain: `assets.molarium.org`

The R2 bucket needs read-only CORS access from `https://molarium.org`,
`https://www.molarium.org`, and the local development origin. Do not commit Cloudflare tokens or
R2 credentials. Use a locally authenticated Wrangler session or narrowly scoped repository
secrets for asset uploads.

## Pages build

Use these settings in Cloudflare Pages:

```text
Production branch: main
Build command: bun run build:web
Build output directory: dist
Root directory: /
```

The default production asset base is `https://assets.molarium.org/v<package version>/`. Override
the release only when publishing a deliberately versioned asset set:

```sh
MOLARIUM_ASSET_RELEASE=v1.0.1 bun run build:web
```

`bun run build:web` refuses a Pages file over 25 MiB. It also emits `_headers` and a SHA-256
manifest. The separate curated-release exporter performs private-name and credential scans before
source is published.

## Model assets

From a complete maintainer checkout, generate the exact R2 object list and hashes:

```sh
bun install
bun run manifest:r2
```

Upload the keys recorded in `r2-assets-manifest.json` to `molarium-assets` without changing their
paths. Apply `Cache-Control: public, max-age=31536000, immutable` because every asset set lives
under a versioned prefix. Preserve each entry's `contentType`: JavaScript sidecars must be served as
`text/javascript`, WebAssembly as `application/wasm`, and JSON as `application/json`.

The bucket CORS policy must allow `GET` and `HEAD` from `https://molarium.org` and
`https://www.molarium.org`. It should allow the `Range` request header and expose `Content-Length`,
`Content-Range`, and `ETag`; ONNX external-data files can be read in ranges. After upload, verify the
deployed sizes, MIME types, cache headers, and hashes before promoting the matching Pages release.

Because two OpenFold external-data objects exceed Wrangler's upload limit, use AWS CLI v2 with an
R2 API token restricted to this bucket. Keep the endpoint and credentials in the shell environment,
never in a file in this repository:

```sh
export CLOUDFLARE_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export AWS_ACCESS_KEY_ID=<R2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<R2-secret-access-key>
bun run upload:r2 -- --dry-run
bun run upload:r2
bun run verify:r2 -- --full
```

The uploader uses multipart transfers through `aws s3 cp`, preserves the manifest's MIME and cache
metadata, and defaults to two concurrent objects (`MOLARIUM_UPLOAD_JOBS` may be 1–4). The full
verification streams every deployed object through SHA-256 before a Pages release is promoted.

Public checkouts can restore and verify those assets with:

```sh
bun run assets:download
```
