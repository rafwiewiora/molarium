#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const PRIVATE_ROOT = path.resolve("paper/development-log/private");

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
  return { source: path.resolve(source), output: resolvedOutput };
}

function redact(text) {
  return String(text)
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
    .replace(/\/Users\/[^/\s]+/g, "$HOME")
    .replace(/\/private\/var\/folders\/[^\s"')]+/g, "$TMP")
    .replace(/\/var\/folders\/[^\s"')]+/g, "$TMP");
}

function visibleMessage(record) {
  if (record?.type !== "response_item" || record?.payload?.type !== "message") {
    return null;
  }
  const role = record.payload.role;
  if (role !== "user" && role !== "assistant") return null;

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
    type: "visible_message",
    timestamp: record.timestamp || null,
    ordinal: Number.isFinite(record.ordinal) ? record.ordinal : null,
    role,
    phase: role === "assistant" ? record.payload.phase || null : null,
    text: parts.join("\n\n"),
    omittedAttachments,
  };
}

const { source, output } = parseArguments(process.argv.slice(2));
const digest = createHash("sha256");
const messages = [];
let lineNumber = 0;
const input = createReadStream(source);
input.on("data", (chunk) => digest.update(chunk));
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
  if (message) messages.push(message);
}

const metadata = {
  type: "redacted_codex_export",
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceBasename: path.basename(source),
  sourceSha256: digest.digest("hex"),
  reviewStatus: "REQUIRES_MANUAL_REVIEW",
  policy: [
    "user and visible assistant messages only",
    "system/developer messages, reasoning, tools, and event records omitted",
    "attachments omitted",
    "credential and local-path patterns redacted",
  ],
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  `${[metadata, ...messages].map((item) => JSON.stringify(item)).join("\n")}\n`,
  { mode: 0o600 },
);

console.log(`Wrote ${messages.length} visible messages to ${output}.`);
console.log("This file is private and still requires manual review before quotation.");
