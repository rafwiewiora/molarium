#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const PRIVATE_ROOT = path.resolve("paper/development-log/private");
const EXPORT_VERSION = 2;
const VISIBLE_ASSISTANT_PHASES = new Set(["commentary", "final"]);

function usage(message = "") {
  if (message) console.error(`${message}\n`);
  console.error(
    "Usage: bun scripts/export-codex-session.mjs <rollout.jsonl> " +
      "--output paper/development-log/private/<name>.jsonl",
  );
  process.exit(1);
}

function parseArguments(argv) {
  const source = argv[0];
  const outputFlag = argv.indexOf("--output");
  const output = outputFlag >= 0 ? argv[outputFlag + 1] : "";
  if (!source || !output) usage("Both a source rollout and --output are required.");

  const resolvedOutput = path.resolve(output);
  if (
    resolvedOutput !== PRIVATE_ROOT &&
    !resolvedOutput.startsWith(`${PRIVATE_ROOT}${path.sep}`)
  ) {
    usage("Refusing to write outside the ignored private transcript directory.");
  }
  return { source:path.resolve(source), output:resolvedOutput };
}

function redact(text) {
  const preservedEvidenceHashes = [];
  let value = String(text).replace(
    /\b((?:sha(?:-?256)?|sourceSha256|checksum|digest)\s*[:=]?\s*)([a-fA-F0-9]{64})\b/gi,
    (_match, prefix, hash) => {
      const marker = `MOLARIUM_EVIDENCE_HASH_${preservedEvidenceHashes.length}`;
      preservedEvidenceHashes.push(hash);
      return `${prefix}${marker}`;
    },
  );
  value = value
    .replace(/\bcfat_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{12,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_ACCESS_KEY]")
    .replace(/\b[a-fA-F0-9]{64}\b/g, "[REDACTED_64_HEX_SECRET]")
    .replace(/\b[a-fA-F0-9]{32}\b/g, "[REDACTED_32_HEX_CREDENTIAL]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_ -]?key|access[_ -]?key|secret|password|token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:api[_-]?key|access[_-]?key|secret|password|token)=)[^&#\s]+/gi,
      "$1[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\/Users\/[^/\s"')`]+/g, "$HOME")
    .replace(/\/(?:private\/)?var\/folders\/[^\s"')`]+/g, "$TMP")
    .replace(/\/private\/tmp(?:\/[^\s"')`]+)*/g, "$TMP")
    .replace(/\/tmp(?:\/[^\s"')`]+)*/g, "$TMP")
    .replace(/\/Volumes(?:\/[^\s"')`]+)*/g, "$VOLUME")
    .replace(/\/workspacenfs(?:\/[^\s"')`]+)*/g, "$REMOTE_PATH");
  return value.replace(/MOLARIUM_EVIDENCE_HASH_(\d+)/g, (_match, index) =>
    preservedEvidenceHashes[Number(index)] || "[REDACTED_UNRESOLVED_HASH]");
}

function visibleMessage(record) {
  if (record?.type !== "response_item" || record?.payload?.type !== "message") return null;
  const role = record.payload.role;
  if (role !== "user" && role !== "assistant") return null;
  const phase = role === "assistant" ? record.payload.phase || null : null;
  if (role === "assistant" && phase && !VISIBLE_ASSISTANT_PHASES.has(phase)) return null;

  const parts = [];
  let omittedAttachments = 0;
  for (const item of record.payload.content || []) {
    if (item?.type === "input_text" || item?.type === "output_text") {
      parts.push(redact(item.text || ""));
    } else {
      omittedAttachments += 1;
    }
  }
  if (!parts.length && !omittedAttachments) return null;

  return {
    type:"visible_message",
    timestamp:record.timestamp || null,
    ordinal:Number.isFinite(record.ordinal) ? record.ordinal : null,
    role,
    phase,
    text:parts.join("\n\n"),
    omittedAttachments,
  };
}

async function writeRecord(stream, digest, record) {
  const line = `${JSON.stringify(record)}\n`;
  digest.update(line);
  if (!stream.write(line)) await once(stream, "drain");
}

const { source, output } = parseArguments(process.argv.slice(2));
await mkdir(path.dirname(output), { recursive:true });
const partialOutput = `${output}.partial-${process.pid}-${Date.now()}`;
const sourceDigest = createHash("sha256");
const outputDigest = createHash("sha256");
const destination = createWriteStream(partialOutput, { mode:0o600 });
let completed = false;
let lineNumber = 0;
let sourceSizeBytes = 0;
let visibleMessages = 0;
let omittedAttachments = 0;

try {
  await writeRecord(destination, outputDigest, {
    type:"redacted_codex_export_header",
    version:EXPORT_VERSION,
    generatedAt:new Date().toISOString(),
    sourceBasename:path.basename(source),
    reviewStatus:"REQUIRES_MANUAL_REVIEW",
    policy:[
      "user and visible assistant messages only",
      "system/developer messages, hidden reasoning, tools, and event records omitted",
      "attachments omitted and counted",
      "credential, email, and local-path patterns redacted",
      "labelled scientific SHA-256 evidence hashes retained",
      "Codex rollout JSONL is treated as an observed internal format, not a stable public API",
    ],
  });

  const input = createReadStream(source);
  input.on("data", (chunk) => {
    sourceDigest.update(chunk);
    sourceSizeBytes += chunk.length;
  });
  const lines = readline.createInterface({ input, crlfDelay:Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on rollout line ${lineNumber}.`);
    }
    const message = visibleMessage(record);
    if (!message) continue;
    visibleMessages += 1;
    omittedAttachments += message.omittedAttachments;
    await writeRecord(destination, outputDigest, message);
  }

  await writeRecord(destination, outputDigest, {
    type:"redacted_codex_export_summary",
    version:EXPORT_VERSION,
    sourceSha256:sourceDigest.digest("hex"),
    sourceSizeBytes,
    sourceLineCount:lineNumber,
    visibleMessageCount:visibleMessages,
    omittedAttachmentCount:omittedAttachments,
    reviewStatus:"REQUIRES_MANUAL_REVIEW",
  });
  destination.end();
  await once(destination, "finish");
  await rename(partialOutput, output);
  const outputSha256 = outputDigest.digest("hex");
  await writeFile(`${output}.sha256`, `${outputSha256}  ${path.basename(output)}\n`, { mode:0o600 });
  completed = true;
  console.log(`Wrote ${visibleMessages} visible messages to ${output}.`);
  console.log(`SHA-256 ${outputSha256}`);
  console.log("This file is private and still requires manual review before quotation.");
} finally {
  if (!completed) {
    destination.destroy();
    await rm(partialOutput, { force:true });
  }
}
