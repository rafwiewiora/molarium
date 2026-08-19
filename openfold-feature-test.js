import {
  ATOM_TYPES, buildOpenFoldFeatures, mergeA3mDocuments, normalizeProteinSequence,
  parseA3m, predictionToPdb, RESTYPES, selectOpenFoldBucket,
} from './openfold/features.js';
import { ColabFoldMsaProvider, decodeColabFoldArchive, extractTarFiles } from './openfold/msa-client.js';

let checks = 0;
function check(condition, message) {
  checks++;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function equalArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function tarArchive(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const write = (target, offset, length, value) => target.set(encoder.encode(value).subarray(0, length), offset);
  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    const header = new Uint8Array(512);
    write(header, 0, 100, name);
    write(header, 100, 8, '0000644\0');
    write(header, 108, 8, '0000000\0');
    write(header, 116, 8, '0000000\0');
    write(header, 124, 12, `${data.length.toString(8).padStart(11, '0')}\0`);
    write(header, 136, 12, '00000000000\0');
    header.fill(32, 148, 156);
    header[156] = 48;
    write(header, 257, 6, 'ustar\0');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    write(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    chunks.push(header, data, new Uint8Array((512 - data.length % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const archive = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.length; }
  return archive;
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const sequence = RESTYPES;
check(normalizeProteinSequence(`>test\n${sequence.toLowerCase()}`) === sequence, 'FASTA normalization');
check(normalizeProteinSequence('BUZOJ') === 'DCEXX', 'ambiguous residue normalization');
let longRejected = false;
try { normalizeProteinSequence('A'.repeat(129)); } catch { longRejected = true; }
check(longRejected, 'length bucket is enforced');
check(normalizeProteinSequence('A'.repeat(128)).length === 128, '128-residue maximum is accepted');
check(selectOpenFoldBucket(64).residues === 64 && selectOpenFoldBucket(65).residues === 128,
  'smallest fitting model bucket is selected');

const parsed = parseA3m(`>query\n${sequence}\n>hit\nARnN-CQEGHILKMFPSTWYV\n`);
check(parsed.length === 2, 'A3M records parsed');
check(parsed[1].sequence === 'ARN-CQEGHILKMFPSTWYV', 'A3M insertions removed');
check(parsed[1].deletions[2] === 1, 'A3M deletion vector records insertion count');
const rows = mergeA3mDocuments([`>query\n${sequence}\n>duplicate\n${sequence}\n>hit\n${parsed[1].sequence}\n`], sequence);
check(rows.length === 2, 'duplicate MSA rows removed');

const manyRows = [{ description: 'query', sequence, deletions: Array(sequence.length).fill(0) }];
for (let row = 1; row < 120; row++) {
  const hit = [...sequence].map((letter, index) => (index + row) % 17 === 0 ? '-' : letter).join('');
  manyRows.push({ description: `hit-${row}`, sequence: hit, deletions: Array(sequence.length).fill(row % 4) });
}
const first = buildOpenFoldFeatures({ sequence, alignments: manyRows, seed: 7 });
const second = buildOpenFoldFeatures({ sequence, alignments: manyRows, seed: 7 });
check(first.metadata.selectedMsaDepth === 32 && first.metadata.extraMsaDepth === 64, 'MSA cluster buckets filled');
check(first.features.msa_feat.data.length === 32 * 64 * 49, '49-channel MSA tensor shape');
check(first.features.extra_msa.data.length === 64 * 64, 'extra MSA tensor shape');
check(equalArray(first.features.msa_feat.data, second.features.msa_feat.data), 'feature sampling is deterministic by seed');
check(Number(first.features.aatype.data[0]) === 0 && Number(first.features.aatype.data[1]) === 1, 'OpenFold residue order');
check(first.features.seq_mask.data.slice(0, sequence.length).every((value) => value === 1), 'sequence mask populated');
check(first.features.seq_mask.data.slice(sequence.length).every((value) => value === 0), 'bucket padding masked');
for (let residue = 0; residue < sequence.length; residue++) {
  const profileOffset = residue * 49 + 25;
  const total = first.features.msa_feat.data.slice(profileOffset, profileOffset + 23).reduce((sum, value) => sum + value, 0);
  check(Math.abs(total - 1) < 1e-5, `cluster profile ${residue} normalized`);
}
const glyIndex = sequence.indexOf('G');
const cbIndex = ATOM_TYPES.indexOf('CB');
check(first.features.atom37_atom_exists.data[glyIndex * 37 + cbIndex] === 0, 'glycine has no CB');
check(first.features.atom37_atom_exists.data[cbIndex] === 1, 'alanine has CB');
check(first.features.atom37_atom_exists.data.slice(sequence.length * 37).every((value) => value === 0), 'padded atom mask empty');

const sequence65 = RESTYPES.repeat(4).slice(0, 65);
const bucket128 = buildOpenFoldFeatures({ sequence: sequence65, alignments: [{
  description: 'query', sequence: sequence65, deletions: Array(sequence65.length).fill(0),
}] });
check(bucket128.metadata.bucketResidues === 128, '65 residues select the 128-residue bucket');
check(bucket128.features.msa_feat.dims.join(',') === '1,32,128,49', 'L128 MSA feature shape');
check(bucket128.features.atom37_atom_exists.dims.join(',') === '1,128,37', 'L128 atom feature shape');

const fakePositions = new Float32Array(64 * 37 * 3);
const fakePlddt = new Float32Array(sequence.length); fakePlddt.fill(88);
const pdb = predictionToPdb(sequence, fakePositions, first.features.atom37_atom_exists.data, fakePlddt);
check(pdb.startsWith('ATOM') && pdb.endsWith('END\n'), 'PDB output emitted');

const a3m = `>101\n${sequence}\n>hit\n${sequence}\n`;
const tar = tarArchive({ 'uniref.a3m': a3m, 'bfd.mgnify30.metaeuk30.smag30.a3m': a3m });
check(extractTarFiles(tar).size === 2, 'tar archive entries extracted');
const compressed = await gzip(tar);
const decoded = await decodeColabFoldArchive(compressed.buffer);
check(decoded.documents.length === 2, 'ColabFold gzip archive decoded');

const requests = [];
const fetchReceivers = [];
const mockFetch = async function (url, options = {}) {
  fetchReceivers.push(this);
  requests.push({ url, options });
  if (url.endsWith('/ticket/msa')) return Response.json({ status: 'PENDING', id: 'job-1' });
  if (url.endsWith('/ticket/job-1')) return Response.json({ status: 'COMPLETE', id: 'job-1' });
  if (url.endsWith('/result/download/job-1')) return new Response(compressed);
  return new Response('not found', { status: 404 });
};
const provider = new ColabFoldMsaProvider({ endpoint: 'https://mock.invalid', fetchImplementation: mockFetch,
  pollIntervalMs: 1, jitterMs: 0 });
const result = await provider.search({ entities: [{ id: 'A', type: 'protein', sequence }] });
check(result.documents.length === 2 && requests.length === 3, 'MSA submit, poll and download protocol');
check(fetchReceivers.every((receiver) => receiver === globalThis), 'fetch keeps the browser global receiver');
check(requests[0].options.body.get('mode') === 'env', 'ColabFold environment mode submitted');
check((await provider.search({ entities: [{ id: 'A', type: 'protein', sequence }] })) === result, 'MSA result cached');

console.log(`OpenFold feature/MSA tests: ${checks}/${checks} passed`);
