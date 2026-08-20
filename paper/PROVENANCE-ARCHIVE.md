# Development provenance archive

The paper's central claim depends on a development record that can be inspected independently.
Git history and benchmark notes are necessary, but they are not enough to support a claim about
how long the work took or how the human and coding agent divided the work.

## What to preserve

For every manuscript-relevant development session, preserve:

1. the visible user, assistant, and tool transcript;
2. the model name, date, and delegated-agent structure;
3. ISO 8601 timestamps for session start, checkpoints, and stop;
4. the starting and ending Git commit, plus hashes of uncommitted patches;
5. operating system, browser, GPU adapter, dependency, and model-weight versions;
6. test and benchmark commands, raw outputs, timing boundaries, and fixture hashes; and
7. hashes of the manuscript, figures, software release, and deployed assets.

The archive must distinguish three different time quantities:

- **Observed project interval:** first recorded project action to final recorded action.
- **Agent execution time:** measured model and tool-call time when the interface exposes it.
- **Human active time:** explicitly logged work intervals. Do not infer this from wall time or message gaps.

No archive should describe wall time as active development time.

## Private raw archive and public research record

Keep the raw transcript in a private archive. This conversation has contained temporary credentials,
local filesystem paths, and potentially unpublished molecular structures. Never commit a raw transcript
to the public repository.

Build the public record from a redacted copy. Remove or replace:

- API tokens, access keys, cookies, pairing codes, and signed URLs;
- private local paths and account identifiers;
- unpublished structures, sequences, coordinates, and screenshots unless release is approved; and
- unrelated personal conversation.

Preserve the scientific content of prompts, visible assistant responses, tool names, command outcomes,
timings, error messages, and acceptance decisions. The archive covers visible interaction and tool
activity. It does not contain hidden chain-of-thought and must not claim that it does.

## Proposed release layout

```text
paper/provenance/<release>/
  manifest.json
  transcript.redacted.jsonl
  timeline.csv
  environment.json
  hashes.sha256
  tests/
  benchmarks/
```

`manifest.json` should name the schema version, release commit, model, redaction status, transcript
export source, and every included file with its SHA-256 digest. `timeline.csv` should label each interval
as observed wall time, measured agent/tool execution, explicit human activity, or unknown.

## Session procedure

At the start of a session:

1. record the UTC timestamp, model, repository commit, and worktree status;
2. start an explicit human active-time interval if that measurement is wanted; and
3. create a session identifier that is used by benchmark and test outputs.

At each manuscript or release checkpoint:

1. export the visible conversation and tool activity;
2. stop the active-time interval;
3. record the ending commit and environment;
4. copy raw test and benchmark outputs into the private archive;
5. redact a release copy and scan it for credentials and private paths; and
6. hash the final archive and cite that immutable version in the manuscript.

## Current paper language

Until a complete redacted transcript and timestamped timeline are assembled, the manuscript should
continue to describe “several days” as the observed project interval, not a controlled productivity
measurement. Once the archive exists and its hashes are verified, replace that caveat with a direct
data-availability statement and report each time quantity separately.
