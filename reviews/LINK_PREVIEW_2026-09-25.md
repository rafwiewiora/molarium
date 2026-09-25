# LP-01 — homepage link preview used interface text

## Finding

The user supplied a shared molarium.org card titled **Display Options**, with
constraint-control text as its description. The homepage had a normal title and
description but no Open Graph or Twitter Card metadata. The screenshot documents
the bad preview; it does not identify that platform's precise extraction heuristic.

## Fix

[index.html](../index.html) now includes static, crawler-readable Open Graph and
Twitter large-image-card metadata, a canonical homepage URL, a descriptive title,
and consistent descriptions. No application JavaScript or molecular session is
needed to obtain them. Title: **Molarium — Molecular design in your browser**.

The [1200 × 630 PNG](../assets/molarium-social-v1.png) reuses the existing Molarium
flask logo with browser-based molecular design/simulation wording. It is a brand
card, not a scientific visualization or a screenshot of simulated results. The
[editable HTML/CSS artwork](../scripts/social-preview.html) and
[isolated rendering script](../scripts/render-social-preview.mjs) preserve its
source. Regenerate with `bun scripts/render-social-preview.mjs` using Chrome;
font rendering can vary with the host platform. The committed PNG is the exact
deployed artifact. Its versioned filename allows later image revisions to use a
new URL instead of overwriting cached artwork.

Both deployment and integrity manifests include the PNG. The
[regression](../scripts/social-preview.test.mjs) checks metadata in raw source and
built HTML, consistent titles/descriptions, absolute image URL, PNG dimensions,
image size, alt text and inclusion in the emitted manifest. The production-build
CI step runs it with `--dist`. The independent-layout development server now
replaces the title without depending on the old wording.

Scope: homepage metadata/artwork only; no computation, simulation defaults,
telemetry, permissions, paper or frozen SOS1 evidence changes. Individual story
query URLs retain this generic homepage card; this does not introduce per-story
unfurls. Previously cached third-party cards may remain unchanged until their
provider fetches the page again; deployment cannot rewrite existing messages.

Metadata follows the [Open Graph protocol](https://ogp.me/), including the four
basic properties and image type, dimensions and alternative text.
