import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Read-only, independent archive/diff checks. Do not import the builders: they write.
const root = dirname(fileURLToPath(import.meta.url));
const history = join(root, 'history-2026-09-06');
const data = JSON.parse(readFileSync(join(root, 'review-data.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(history, 'manifest.json'), 'utf8'));
const pdfRecords = JSON.parse(readFileSync(join(history, 'pdf-records.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = id => readFileSync(join(history, 'artifacts', id));
const current = bytes(data.currentArtifact).toString('utf8');
const baseline = bytes(data.comparisonBaseline).toString('utf8');
const scientific = data.sources.find(source => source.id === 'current-scientific-view').text;
const ids = new Map(manifest.artifacts.map(item => [item.id, item]));
const CURRENT_SHA = '3de523cc745279a9962cae7d1afb90ccb8867f8d4d086e449e5f146f84fc24ff';
const BASELINE_SHA = 'd098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9';
const PRE_C_SHA = '61e57f2d6944b25becb1c033e97c098d1848fa35d90027485f838c8baca6cc8f';
const MISSING_B_SHA = 'bb47e79e91b413c1b81ceb1047de0ba7aff0ca03e4987d9e853c75654ec486f6';
const marker = String.raw`\appendixsection{Editorial history: recovered paragraph versions}{app:paragraph-history}`;
const lines = source => source.match(/[^\n]*\n|[^\n]+$/g) ?? [];

function verifyCompleteHunks(before, after, changes) {
  const left = lines(before), right = lines(after);
  let l = 0, r = 0;
  const forward = [], reverse = [];
  for (const change of changes) {
    const a = change.beforeLine - 1, b = change.beforeEndLine;
    const c = change.afterLine - 1, d = change.afterEndLine;
    assert.ok([a, b, c, d].every(Number.isInteger), `${change.id}: integer coordinates`);
    assert.ok(a >= l && b >= a && b <= left.length, `${change.id}: ordered left range`);
    assert.ok(c >= r && d >= c && d <= right.length, `${change.id}: ordered right range`);
    const leftGap = left.slice(l, a).join('');
    const rightGap = right.slice(r, c).join('');
    assert.equal(leftGap, rightGap, `${change.id}: omitted region must be byte-identical`);
    assert.equal(change.before, left.slice(a, b).join(''), `${change.id}: exact before precondition`);
    assert.equal(change.after, right.slice(c, d).join(''), `${change.id}: exact after precondition`);
    assert.notEqual(change.before, change.after, `${change.id}: real difference`);
    assert.equal(change.kind, a === b ? 'insert' : c === d ? 'delete' : 'replace');
    forward.push(leftGap, change.after);
    reverse.push(rightGap, change.before);
    l = b; r = d;
  }
  assert.equal(left.slice(l).join(''), right.slice(r).join(''), 'unlisted tail must be byte-identical');
  forward.push(left.slice(l).join(''));
  reverse.push(right.slice(r).join(''));
  assert.equal(forward.join(''), after, 'all changes reconstruct current source exactly');
  assert.equal(reverse.join(''), before, 'all inverse changes reconstruct baseline exactly');
  return { forwardSha: sha(forward.join('')), reverseSha: sha(reverse.join('')) };
}

test('every recovered identity and alias resolves; all public originals retain exact bytes', () => {
  // Initial recovery floors remain protected while additional identified files may be added.
  assert.ok(manifest.artifacts.length >= 120);
  assert.equal(ids.size, manifest.artifacts.length);
  assert.ok(manifest.aliases.length >= 449);
  const publicIds = [];
  for (const item of manifest.artifacts) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.equal(item.id, item.sha256 + item.extension);
    assert.match(item.extension, /^\.[a-z0-9]+$/);
    if (item.extension === '.docx') continue;
    const original = bytes(item.id);
    assert.equal(original.length, item.bytes, item.id);
    assert.equal(sha(original), item.sha256, item.id);
    publicIds.push(item.id);
  }
  assert.equal(publicIds.length, manifest.artifacts.length - 3);
  assert.deepEqual(readdirSync(join(history, 'artifacts')).sort(), publicIds.sort());
  for (const alias of manifest.aliases) assert.ok(ids.has(alias.artifact), alias.source);
  assert.deepEqual(data.history, manifest, 'embedded inventory is the complete archived manifest');
  assert.equal(sha(readFileSync(join(history, 'recover-history.py'))), manifest.builderSha256);
});

test('private DOCX originals/comments are not included in the public artifact archive', () => {
  assert.equal(manifest.aliases.some(alias => /molarium-manuscript-decisions(?: \(\d+\))?\.json$/i.test(alias.source)), false, 'QA and author decision exports are not historical manuscript sources');
  const privateItems = manifest.artifacts.filter(item => item.extension === '.docx');
  assert.equal(privateItems.length, 3);
  for (const item of privateItems) {
    assert.match(item.publication, /hash only.*privacy/i);
    assert.equal(existsSync(join(history, 'artifacts', item.id)), false);
    assert.equal(data.sources.some(source => source.id === item.id), false);
  }
  // Only identities and structural counts belong here, not private comment text.
  assert.equal(data.sources.some(source => /\.docx$/i.test(source.id)), false);
});

test('all 61 recovered Git paper commits have traceable snapshot aliases', () => {
  assert.equal(manifest.gitCommits.length, 61);
  assert.equal(new Set(manifest.gitCommits).size, 61);
  const snapshotCommits = new Set(manifest.aliases.filter(alias => alias.origin === 'Git snapshot (not necessarily accepted)').map(alias => alias.gitCommit));
  assert.deepEqual([...snapshotCommits].sort(), [...manifest.gitCommits].sort());
  assert.match(manifest.policy.authorship, /not inferred/i);
  assert.match(manifest.policy.dates, /not.*chronology/i);
});

test('every recovered text source is a selectable identity, plus clearly derived views', () => {
  const expected = manifest.artifacts.filter(item => ['.tex', '.bib', '.md'].includes(item.extension)).map(item => item.id);
  assert.ok(expected.length >= 63);
  assert.ok(data.sources.length >= expected.length + 1);
  assert.equal(new Set(data.sources.map(source => source.id)).size, data.sources.length);
  assert.deepEqual(data.sources.filter(source => ids.has(source.id)).map(source => source.id).sort(), expected.sort());
  for (const source of data.sources) {
    if (source.id === 'current-scientific-view') {
      assert.match(source.origin, /Derived.*original retained/i);
      continue;
    }
    if (source.id.startsWith('pdf-text:')) {
      assert.ok(source.pdfArtifact, `${source.id}: original PDF identity required`);
      continue; // Full extraction provenance is checked independently below.
    }
    assert.ok(ids.has(source.id), `${source.id}: additional derived views need explicit provenance tests`);
    assert.equal(sha(source.text), ids.get(source.id).sha256, source.id);
    assert.deepEqual(source.aliases, manifest.aliases.filter(alias => alias.artifact === source.id));
  }
});

test('the exact current source retains Appendix C; only the hash-verified derived view omits it', () => {
  assert.equal(data.currentArtifact, `${CURRENT_SHA}.tex`);
  assert.equal(data.currentSha256, CURRENT_SHA);
  assert.equal(sha(current), CURRENT_SHA);
  assert.equal(data.currentPdf, 'd8c320ad781a306b0fe8114656819a8ea49ed3bcd260560da8ad04ae48509fb6.pdf');
  assert.equal(data.comparisonBaseline, `${BASELINE_SHA}.tex`);
  assert.equal(data.appendixBaselineHashVerified, true);
  assert.equal(data.baselineBeforeAppendixC, PRE_C_SHA);
  assert.equal(sha(scientific), PRE_C_SHA);
  const cStart = current.indexOf(marker);
  const bibliography = String.raw`\begin{thebibliography}`;
  assert.ok(cStart > 0);
  assert.equal(scientific.includes(marker), false);
  assert.equal(scientific.slice(0, scientific.indexOf(bibliography)).replace(/\s*\\clearpage\s*$/, '').trimEnd(), current.slice(0, cStart).trimEnd());
  assert.equal(scientific.slice(scientific.indexOf(bibliography)), current.slice(current.indexOf(bibliography, cStart)));
  const originalSource = data.sources.find(source => source.id === data.currentArtifact);
  assert.equal(originalSource.text, current, 'exact full source remains available alongside the derived view');
});

test('current Downloads manuscript still matches the readonly archived original when available', t => {
  const download = '/Users/bb/Downloads/main (2).tex';
  if (!existsSync(download)) return t.skip('External Downloads source is not available in this checkout; archived-byte checks still run.');
  assert.equal(sha(readFileSync(download)), CURRENT_SHA);
});

test('same-named recovered Source B is not misidentified as the missing Appendix C Source B', () => {
  assert.ok(ids.has('5f639cc0a4bf05e0ae88725dc1957e64b09d29099b1b6252b51cbe211645c909.tex'), 'Appendix C Source A is actually recovered');
  assert.equal(ids.has(`${MISSING_B_SHA}.tex`), false);
  assert.ok(current.includes(MISSING_B_SHA), 'original historical claim is preserved, not silently corrected');
  const named = manifest.aliases.filter(alias => /Molarium_paper_source_2026-09-02.*\/Molarium_complete\.tex$/.test(alias.source));
  assert.ok(named.length >= 2);
  assert.ok(named.every(alias => alias.artifact === `${BASELINE_SHA}.tex`));
  assert.notEqual(BASELINE_SHA, MISSING_B_SHA);
});

test('all 40 line hunks account for every byte changed, in both directions, without a curated filter', () => {
  assert.equal(data.changes.length, 40);
  assert.deepEqual(data.changes.map(change => change.id), Array.from({ length: 40 }, (_, i) => `D${String(i + 1).padStart(3, '0')}`));
  assert.deepEqual(verifyCompleteHunks(baseline, scientific, data.changes), { forwardSha: PRE_C_SHA, reverseSha: BASELINE_SHA });
  assert.ok(data.changes.some(change => change.kind === 'insert'));
  assert.ok(data.changes.some(change => change.kind === 'delete'));
  assert.ok(data.changes.some(change => change.recordIds.length === 0), 'changes outside curated Appendix C records are retained');
  assert.ok(data.changes.some(change => change.area === 'Preamble'));
  assert.ok(data.changes.some(change => change.area === 'Main text'));
  assert.ok(data.changes.some(change => change.area === 'Appendices'));
});

test('independent coverage checker rejects omitted differences and stale hunk preconditions', () => {
  assert.throws(() => verifyCompleteHunks(baseline, scientific, data.changes.slice(1)), /omitted region/);
  const stale = structuredClone(data.changes);
  stale[1].after += 'unapproved rewrite';
  assert.throws(() => verifyCompleteHunks(baseline, scientific, stale), /exact after precondition/);
});

test('all 228 Appendix C record identities and all 38 changed-record variant groups are retained', () => {
  assert.deepEqual(Object.keys(data.appendixRecords).sort(), Array.from({ length: 228 }, (_, i) => `R${String(i + 1).padStart(3, '0')}`));
  assert.equal(Object.keys(data.appendixChangedRecords).length, 38);
  const fullLines = lines(current);
  const appendix = current.slice(current.indexOf(marker));
  const headings = [...appendix.matchAll(/\\subsection\{(R\d{3}):/g)].map(match => match[1]);
  assert.deepEqual(Object.keys(data.appendixChangedRecords).sort(), headings.sort());
  for (const [id, record] of Object.entries(data.appendixRecords)) {
    assert.ok(Number.isInteger(record.line) && record.line > 0 && record.line < 1212, id);
    assert.ok(fullLines[record.line - 1].trim(), `${id}: indexed current block exists`);
    assert.ok(record.location.length > 0, id);
  }
  for (const [id, variants] of Object.entries(data.appendixChangedRecords)) {
    assert.ok(variants.length >= 2, `${id}: alternatives retained`);
    assert.equal(variants.filter(variant => variant.label === 'CURRENT').length, 1, id);
    for (const variant of variants) {
      assert.ok(appendix.includes(`\\begin{lstlisting}\n${variant.latex}\n\\end{lstlisting}`), `${id}: exact source listing`);
      assert.ok(variant.evidence.length > 0, `${id}: attribution evidence retained`);
      for (const evidence of variant.evidence) assert.ok(appendix.includes(evidence), id);
    }
    const currentVariant = variants.find(variant => variant.label === 'CURRENT');
    assert.ok(fullLines.slice(data.appendixRecords[id].line - 1).join('').startsWith(currentVariant.latex), `${id}: CURRENT variant matches indexed exact text`);
  }
});

test('every PDF original, full text digest, and page-located extraction record is present', () => {
  const pdfs = manifest.artifacts.filter(item => item.extension === '.pdf');
  assert.ok(pdfs.length >= 30);
  assert.deepEqual(Object.keys(pdfRecords).sort(), pdfs.map(item => item.sha256).sort());
  for (const item of pdfs) {
    assert.equal(sha(readFileSync(join(history, 'text', `${item.sha256}.txt`))), item.textSha256, item.id);
    const record = pdfRecords[item.sha256];
    assert.equal(record.artifact, item.id);
    assert.equal(record.pages, item.pages);
    for (const block of record.blocks) {
      assert.ok(Number.isInteger(block.page) && block.page >= 1 && block.page <= item.pages, item.id);
      assert.equal(typeof block.text, 'string');
      assert.equal(block.bbox.length, 4);
      assert.ok(block.bbox.every(Number.isFinite));
      assert.ok(block.bbox[0] <= block.bbox[2] && block.bbox[1] <= block.bbox[3]);
    }
  }
  const figurePdfs = pdfs.filter(item => manifest.aliases.some(alias => alias.artifact === item.id && /(?:^|[\s/])figures\//.test(alias.source)));
  assert.equal(figurePdfs.length, 6, 'PDF count includes six figure assets, not 30 paper versions');
});

test('every recovered PDF has a clearly labeled comparison view tied to exact extraction bytes', () => {
  const pdfs = manifest.artifacts.filter(item => item.extension === '.pdf');
  const extracted = data.sources.filter(source => source.id.startsWith('pdf-text:'));
  assert.equal(extracted.length, pdfs.length);
  assert.equal(data.sources.length, manifest.artifacts.filter(item => ['.tex', '.bib', '.md'].includes(item.extension)).length + 1 + pdfs.length);
  assert.deepEqual(extracted.map(source => source.pdfArtifact).sort(), pdfs.map(item => item.id).sort());
  for (const source of extracted) {
    const original = ids.get(source.pdfArtifact);
    assert.equal(source.id, `pdf-text:${original.sha256}`);
    assert.match(source.label, /^PDF text · /);
    assert.match(source.origin, /Derived.*extraction.*original PDF retained/i);
    assert.equal(source.textSha256, original.textSha256);
    assert.equal(sha(source.text), original.textSha256);
    assert.equal(source.text, readFileSync(join(history, 'text', `${original.sha256}.txt`), 'utf8'));
    assert.equal(source.pages, original.pages);
    assert.deepEqual(source.aliases, manifest.aliases.filter(alias => alias.artifact === original.id));
  }
});

test('suggestions target exact current substrings and carry no implicit approval', () => {
  assert.equal(new Set(data.suggestions.map(item => item.id)).size, data.suggestions.length);
  const fullLines = lines(current);
  for (const item of [...data.changes, ...data.suggestions]) {
    assert.equal(item.approved, undefined, item.id);
    assert.equal(item.accepted, undefined, item.id);
    assert.equal(item.decision, undefined, item.id);
  }
  for (const suggestion of data.suggestions) {
    assert.ok(fullLines[suggestion.line - 1].includes(suggestion.before), suggestion.id);
    assert.notEqual(suggestion.before, suggestion.after);
  }
  assert.match(data.policy.default, /Every decision is pending/);
  assert.match(data.policy.application, /do not compile, modify, or publish/);
});

test('review identity covers the entire data payload, not only hand-picked changes', () => {
  const { dataId, ...payload } = data;
  // Match documented Python JSON serialization without invoking either writing builder.
  const result = spawnSync('python3', ['-c', 'import json,sys,hashlib; print(hashlib.sha256(json.dumps(json.load(sys.stdin),sort_keys=True,ensure_ascii=False).encode()).hexdigest())'], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), dataId);
});

function templateFunction(name, nextName, context = {}) {
  const template = readFileSync(join(root, 'review-template.html'), 'utf8');
  const start = template.indexOf(`function ${name}(`);
  const end = template.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name}: actual template function is available`);
  return runInNewContext(`(${template.slice(start, end).trim()})`, context, { timeout: 1000 });
}

function blankDecisionState() {
  return { schema: 'molarium.manuscript-decisions/v1', identity: `${data.currentSha256}:${data.comparisonBaseline}`, currentSourceSha256: data.currentSha256, comparisonBaseline: data.comparisonBaseline, reviewDataId: data.dataId, decisions: {}, suggestions: {}, figures: {}, technical: {}, versionNotes: [], events: [] };
}

test('actual import guard accepts matching decisions without turning pending into approval', () => {
  const initial = blankDecisionState();
  const validate = templateFunction('validateImport', 'save', { DATA: data, state: initial, identity: initial.identity });
  for (const choice of ['current', 'earlier', 'custom', 'pending']) {
    const input = blankDecisionState();
    input.decisions.D008 = { choice, before: data.changes[7].before, after: data.changes[7].after, custom: 'Independent QA proposal <not markup>', note: 'QA only' };
    input.suggestions[data.suggestions[0].id] = 'pending';
    input.figures.F01 = { choice: 'pending', note: '' };
    if (data.technicalFindings?.length) input.technical[data.technicalFindings[0].id] = { choice: 'pending', note: '' };
    const result = validate(input);
    assert.equal(result.decisions.D008.choice, choice);
    assert.equal(result.decisions.D008.custom, input.decisions.D008.custom);
    assert.equal(result.suggestions[data.suggestions[0].id], 'pending');
    assert.equal(result.figures.F01.choice, 'pending');
    assert.equal(Object.keys(initial.decisions).length, 0, 'validation does not mutate live decisions');
  }
});

test('actual import guard rejects stale dataset/source identities and altered hunk preconditions', () => {
  const initial = blankDecisionState();
  const validate = templateFunction('validateImport', 'save', { DATA: data, state: initial, identity: initial.identity });
  for (const key of ['identity', 'currentSourceSha256', 'comparisonBaseline', 'reviewDataId']) {
    const stale = blankDecisionState();
    stale[key] = 'different snapshot';
    assert.throws(() => validate(stale), /different source snapshot/, key);
    delete stale[key];
    assert.throws(() => validate(stale), /different source snapshot/, `${key}: absent`);
  }
  for (const side of ['before', 'after']) {
    const input = blankDecisionState();
    input.decisions.D008 = { choice: 'current', before: data.changes[7].before, after: data.changes[7].after };
    input.decisions.D008[side] += 'unreviewed edit';
    assert.throws(() => validate(input), /does not match its original source text/, side);
  }
});

test('actual import guard rejects fabricated IDs, unsupported choices, and non-text custom content', () => {
  const initial = blankDecisionState();
  const validate = templateFunction('validateImport', 'save', { DATA: data, state: initial, identity: initial.identity });
  const invalid = [
    { decisions: { D999: { choice: 'current', before: '', after: '' } } },
    { decisions: { D008: { choice: 'publish', before: data.changes[7].before, after: data.changes[7].after } } },
    { decisions: { D008: { choice: 'custom', before: data.changes[7].before, after: data.changes[7].after, custom: {} } } },
    { suggestions: { 'MR-S999': 'propose' } },
    { suggestions: { [data.suggestions[0].id]: 'accepted' } },
    { figures: { F03: { choice: 'current' } } },
    { figures: { F01: { choice: 'publish' } } },
    { technical: { 'MR-T999': { choice: 'propose' } } },
    { versionNotes: {} },
    { versionNotes: [{ left: 'invented-source', right: data.currentArtifact, note: 'Not a source-backed note' }] },
    { versionNotes: [{ left: data.currentArtifact, right: data.currentArtifact, note: {} }] },
    { events: {} },
  ];
  for (const patch of invalid) assert.throws(() => validate({ ...blankDecisionState(), ...patch }));
});

test('actual startup restores only matching saved reviews and leaves stale reviews unapproved', () => {
  const template = readFileSync(join(root, 'review-template.html'), 'utf8');
  const declarations = template.slice(template.indexOf('const byId='), template.indexOf("let tab='review'"));
  const validator = template.slice(template.indexOf('function validateImport('), template.indexOf('function save('));
  assert.ok(declarations.length > 100 && validator.length > 100);
  const stored = blankDecisionState();
  stored.decisions.D008 = { choice: 'current', before: data.changes[7].before, after: data.changes[7].after };
  const run = saved => {
    const accessed = [];
    const result = runInNewContext(`(() => { const DATA = payload; ${declarations}\n${validator}\nreturn {state, storageKey}; })()`, {
      payload: data,
      localStorage: { getItem: key => { accessed.push(key); return saved; } },
    }, { timeout: 1000 });
    assert.deepEqual(accessed, [result.storageKey]);
    assert.ok(result.storageKey.includes(data.currentSha256));
    assert.ok(result.storageKey.includes(data.dataId), 'restoration is isolated by the complete dataset identity');
    return result;
  };
  assert.equal(run(JSON.stringify(stored)).state.decisions.D008.choice, 'current');
  assert.equal(Object.keys(run(null).state.decisions).length, 0);
  assert.equal(Object.keys(run('{malformed JSON').state.decisions).length, 0);
  stored.reviewDataId = 'stale suggestions or images';
  assert.equal(Object.keys(run(JSON.stringify(stored)).state.decisions).length, 0);
});

test('actual full-source renderer retains every character even in its bounded coarse fallback', () => {
  const diff = templateFunction('sequenceDiff', 'wordPanels');
  const pairs = [
    ['', 'inserted\n'], ['deleted\n', ''], ['same\n', 'same\n'],
    ['A\nB\nC\n', 'A\nX\nC\n'], ['A\nA\nB\n', 'A\nB\nB\n'],
    [baseline, scientific],
    [baseline, current],
  ];
  for (const [before, after] of pairs) {
    for (const limit of [0, 700000]) {
      const pieces = diff(lines(before), lines(after), limit);
      assert.equal(pieces.filter(piece => piece.kind !== 'insert').flatMap(piece => piece.items).join(''), before);
      assert.equal(pieces.filter(piece => piece.kind !== 'delete').flatMap(piece => piece.items).join(''), after);
    }
  }
});

test('both figure alternatives are content-addressed and covered by the review dataset identity', () => {
  assert.deepEqual(Object.keys(data.figureAssets).sort(), ['F01', 'F02']);
  for (const alternatives of Object.values(data.figureAssets)) {
    assert.deepEqual(Object.keys(alternatives).sort(), ['current', 'repository']);
    for (const asset of Object.values(alternatives)) {
      assert.equal(asset.path, `figures/${asset.sha256}.png`);
      assert.equal(sha(readFileSync(join(root, asset.path))), asset.sha256);
    }
  }
  const template = readFileSync(join(root, 'review-template.html'), 'utf8');
  assert.ok(template.includes('DATA.figureAssets'), 'rendered figure choices use the fingerprinted assets');
});

test('generated HTML contains the complete current review data and exactly the current template', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const template = readFileSync(join(root, 'review-template.html'), 'utf8');
  const start = html.indexOf('const DATA = ') + 'const DATA = '.length;
  const end = html.indexOf(';\nconst byId', start);
  assert.ok(start >= 'const DATA = '.length && end > start);
  assert.deepEqual(JSON.parse(html.slice(start, end)), data);
  assert.equal(sha(html.slice(0, start) + '/* REVIEW_DATA */' + html.slice(end)), sha(template), 'generated HTML must be rebuilt after any template edit');
  assert.equal(/<script[\s>]/i.test(html.slice(start, end)), false, 'source excerpts cannot close the data script');
});
