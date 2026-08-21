#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const privateRoot = path.join(repositoryRoot, "paper/development-log/private");
await mkdir(privateRoot, { recursive:true });
const fixtureDirectory = await mkdtemp(path.join(privateRoot, "export-test-"));
const source = path.join(fixtureDirectory, "rollout-fixture.jsonl");
const output = path.join(fixtureDirectory, "redacted.jsonl");
const evidenceHash = "a".repeat(64);
const unlabelledHexSecret = "b".repeat(64);
const apiKey = "sk-testsecret0123456789";
const githubToken = "ghp_0123456789abcdefghijkl";

const records = [
  { timestamp:"2026-08-20T00:00:00Z", type:"response_item",
    payload:{ type:"message", role:"system", content:[{ type:"input_text", text:"private system" }] } },
  { timestamp:"2026-08-20T00:00:01Z", type:"response_item",
    payload:{ type:"message", role:"user", content:[
      { type:"input_text", text:`File /Users/bb/project/a and /private/tmp/run/b. Email person@example.com. ${apiKey} ${githubToken} raw ${unlabelledHexSecret} SHA256: ${evidenceHash} https://example.test/?token=visible-secret` },
      { type:"input_image", image_url:"data:image/png;base64,PRIVATE" },
    ] } },
  { timestamp:"2026-08-20T00:00:02Z", type:"response_item",
    payload:{ type:"message", role:"assistant", phase:"analysis",
      content:[{ type:"output_text", text:"hidden analysis" }] } },
  { timestamp:"2026-08-20T00:00:03Z", type:"response_item",
    payload:{ type:"message", role:"assistant", phase:"commentary",
      content:[{ type:"output_text", text:"Visible tested hypothesis." }] } },
  { timestamp:"2026-08-20T00:00:04Z", type:"function_call_output",
    payload:{ output:"private tool output" } },
];

try {
  const sourceText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(source, sourceText, { mode:0o600 });
  const process = Bun.spawn([
    "bun", "scripts/export-codex-session.mjs", source,
    "--output", path.relative(repositoryRoot, output),
  ], { cwd:repositoryRoot, stdout:"pipe", stderr:"pipe" });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  assert.equal(exitCode, 0, stderr);

  const exportedText = await readFile(output, "utf8");
  const exported = exportedText.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(exported[0].type, "redacted_codex_export_header");
  assert.equal(exported[0].version, 2);
  const visible = exported.filter((record) => record.type === "visible_message");
  assert.equal(visible.length, 2);
  assert.equal(visible[0].role, "user");
  assert.equal(visible[0].omittedAttachments, 1);
  assert.equal(visible[1].phase, "commentary");
  assert.match(visible[1].text, /Visible tested hypothesis/);
  assert.doesNotMatch(exportedText, /private system|hidden analysis|private tool output|PRIVATE/);
  assert.doesNotMatch(exportedText, new RegExp(apiKey));
  assert.doesNotMatch(exportedText, new RegExp(githubToken));
  assert.doesNotMatch(exportedText, new RegExp(unlabelledHexSecret));
  assert.doesNotMatch(exportedText, /\/Users\/bb|\/private\/tmp|person@example\.com|visible-secret/);
  assert.match(exportedText, /\$HOME\/project\/a/);
  assert.match(exportedText, /\$TMP/);
  assert.match(exportedText, /\[REDACTED_EMAIL\]/);
  assert.match(exportedText, new RegExp(evidenceHash));

  const summary = exported.at(-1);
  assert.equal(summary.type, "redacted_codex_export_summary");
  assert.equal(summary.sourceLineCount, records.length);
  assert.equal(summary.visibleMessageCount, 2);
  assert.equal(summary.omittedAttachmentCount, 1);
  assert.equal(summary.sourceSizeBytes, Buffer.byteLength(sourceText));
  assert.equal(summary.sourceSha256, createHash("sha256").update(sourceText).digest("hex"));

  const checksumText = await readFile(`${output}.sha256`, "utf8");
  assert.equal(checksumText.trim(),
    `${createHash("sha256").update(exportedText).digest("hex")}  ${path.basename(output)}`);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal((await stat(`${output}.sha256`)).mode & 0o777, 0o600);
  console.log("Codex session exporter: PASS");
} finally {
  await rm(fixtureDirectory, { recursive:true, force:true });
}
