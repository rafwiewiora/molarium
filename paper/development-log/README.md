# Development record

Molarium was built through a long sequence of observed failures, proposed fixes,
tests, and revisions. Those debugging exchanges are evidence for the paper, not
background noise. This directory records them without publishing credentials,
private paths, hidden instructions, or unreviewed model output.

## Three layers of evidence

1. **Private raw rollout.** Codex writes full session JSONL files under
   `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. They may contain credentials,
   local file names, tool output, system instructions, and other private data.
   Keep them immutable and private. Record a SHA-256 digest when archiving one;
   never add a raw rollout to Git.
2. **Private redacted transcript.** Run `scripts/export-codex-session.mjs` with an
   explicit rollout file. It retains timestamped user and visible assistant
   messages, omits system/developer messages, reasoning, and tool traffic, and
   applies conservative secret and path redaction. The output is forced into the
   ignored `paper/development-log/private/` directory. It still requires manual
   review before any quotation is published.
3. **Curated debugging episode.** A reviewed Markdown file in `episodes/` states
   the observed behavior, the user's request, the diagnosis, the code change,
   the exact test, and the result. These files may be committed. They are the
   paper-facing index into the private evidence.

Git history answers *what code changed*. The raw rollout answers *what was said
and when*. An episode connects the two. None is a substitute for the others.

## Export a session safely

```sh
bun scripts/export-codex-session.mjs \
  ~/.codex/sessions/2026/08/20/rollout-....jsonl \
  --output paper/development-log/private/2026-08-20-session.jsonl
```

The exporter deliberately does not include tool calls or outputs. Debugging
commands, measurements, screenshots, and commits should be added to the curated
episode after inspection. The exporter also does not prove that every secret was
removed. Treat its output as private until a human has reviewed it line by line.

## Episode format

Each episode should contain:

- date and status;
- the trigger, preferably a short exact user quotation;
- observed behavior and a reproducible case;
- diagnosis, including discarded hypotheses when informative;
- implementation and commit identifiers;
- validation command and result;
- remaining uncertainty;
- pointers to private transcript timestamps or hashes, without private paths.

Use `**Debugging episode:**` at the start of the title or summary so these notes
remain searchable. Quote the transcript only when wording matters; label a
reconstruction as a reconstruction.
