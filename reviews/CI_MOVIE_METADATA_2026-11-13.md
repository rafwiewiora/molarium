# Final-source movie metadata in the browser release gate

The first CI run for PR 46 failed the SOS1 movie-duration assertion after the
scientific/build checks and earlier browser checks passed. This was not a cofold
kernel or molecular-state failure. The failing job was
[131860423122](https://github.com/rafwiewiora/molarium/actions/runs/43417932714/job/131860423122).

The test waited for `video.readyState >= 1` before reading duration. The
[movie loader](../sos1-movie.mjs) first has a streaming source, then replaces it
with a fully downloaded Blob to support reliable seeking. The original test
predicate permitted a metadata read during that source handoff. The CI failure
did not capture the duration value, so it is not evidence that the MP4's encoded
duration changed.

The [release test](../scripts/sos1-frozen-routes.browser.test.mjs) now waits for
the final Blob's `seekReady` flag, metadata-ready state and finite duration before
capturing metadata. It retains the same 62.75-second duration tolerance,
1600×1000 dimensions, forward seek and decoded-frame rewind comparison. Failure
diagnostics now include the video readiness, duration, dimensions and error.
No assertion was dropped or tolerance widened, and movie/runtime bytes are
unchanged. No molecular calculations or movie frames were regenerated.
