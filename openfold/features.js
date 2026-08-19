export const OPENFOLD_BUCKET = Object.freeze({ residues: 64, msaClusters: 32, extraMsa: 64 });
export const OPENFOLD_BUCKETS = Object.freeze([
  OPENFOLD_BUCKET,
  Object.freeze({ residues: 128, msaClusters: 32, extraMsa: 64 }),
]);
export const MAX_OPENFOLD_RESIDUES = OPENFOLD_BUCKETS.at(-1).residues;

export const RESTYPES = 'ARNDCQEGHILKMFPSTWYV';
export const ATOM_TYPES = Object.freeze([
  'N', 'CA', 'C', 'CB', 'O', 'CG', 'CG1', 'CG2', 'OG', 'OG1', 'SG', 'CD',
  'CD1', 'CD2', 'ND1', 'ND2', 'OD1', 'OD2', 'SD', 'CE', 'CE1', 'CE2', 'CE3',
  'NE', 'NE1', 'NE2', 'OE1', 'OE2', 'CH2', 'NH1', 'NH2', 'OH', 'CZ', 'CZ2',
  'CZ3', 'NZ', 'OXT',
]);

export const RESTYPE_3 = Object.freeze({
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU',
  G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE',
  P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL', X: 'UNK',
});

const ATOM14_BY_RESTYPE = Object.freeze([
  ['N', 'CA', 'C', 'O', 'CB'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'NE', 'CZ', 'NH1', 'NH2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'OD1', 'ND2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'OD1', 'OD2'],
  ['N', 'CA', 'C', 'O', 'CB', 'SG'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'OE1', 'NE2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'OE1', 'OE2'],
  ['N', 'CA', 'C', 'O'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'ND1', 'CD2', 'CE1', 'NE2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG1', 'CG2', 'CD1'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD1', 'CD2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'CE', 'NZ'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'SD', 'CE'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD'],
  ['N', 'CA', 'C', 'O', 'CB', 'OG'],
  ['N', 'CA', 'C', 'O', 'CB', 'OG1', 'CG2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD1', 'CD2', 'NE1', 'CE2', 'CE3', 'CZ2', 'CZ3', 'CH2'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ', 'OH'],
  ['N', 'CA', 'C', 'O', 'CB', 'CG1', 'CG2'],
  [],
].map((names) => Object.freeze([...names, ...Array(14 - names.length).fill('')])));

const AA_ALIASES = Object.freeze({ B: 'D', J: 'X', O: 'X', U: 'C', Z: 'E', '*': 'X' });
const atomOrder = new Map(ATOM_TYPES.map((name, index) => [name, index]));

export function normalizeProteinSequence(value) {
  const lines = String(value || '').trim().split(/\r?\n/);
  const raw = lines.filter((line) => !line.trim().startsWith('>')).join('').replace(/\s+/g, '').toUpperCase();
  if (!raw) throw new Error('Enter a protein sequence.');
  const sequence = [...raw].map((letter) => AA_ALIASES[letter] || letter).join('');
  if ([...sequence].some((letter) => !RESTYPES.includes(letter) && letter !== 'X'))
    throw new Error('Protein sequences may contain the 20 standard amino acids or X.');
  if (sequence.length > MAX_OPENFOLD_RESIDUES)
    throw new Error(`This browser model supports at most ${MAX_OPENFOLD_RESIDUES} residues.`);
  return sequence;
}

export function selectOpenFoldBucket(residueCount) {
  const length = Number(residueCount);
  if (!Number.isInteger(length) || length < 1) throw new Error('Protein length must be a positive integer.');
  const bucket = OPENFOLD_BUCKETS.find((candidate) => length <= candidate.residues);
  if (!bucket) throw new Error(`This browser model supports at most ${MAX_OPENFOLD_RESIDUES} residues.`);
  return bucket;
}

export function residueId(letter) {
  if (letter === '-' || letter === '.') return 21;
  const normalized = AA_ALIASES[letter] || letter;
  const index = RESTYPES.indexOf(normalized);
  return index < 0 ? 20 : index;
}

export function parseA3m(document) {
  const records = [];
  let description = '';
  let sequence = '';
  const flush = () => {
    if (!sequence) return;
    let deletions = 0;
    const aligned = [];
    const deletionVector = [];
    for (const character of sequence) {
      if (/[a-z]/.test(character)) {
        deletions++;
      } else {
        deletionVector.push(deletions);
        deletions = 0;
        const upper = character.toUpperCase();
        aligned.push(upper === '.' ? '-' : upper);
      }
    }
    records.push({ description, sequence: aligned.join(''), deletions: deletionVector });
  };
  for (const rawLine of String(document || '').replaceAll('\0', '\n').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      flush();
      description = line.slice(1);
      sequence = '';
    } else if (!line.startsWith('#')) {
      sequence += line;
    }
  }
  flush();
  return records;
}

export function mergeA3mDocuments(documents, querySequence) {
  const query = normalizeProteinSequence(querySequence);
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    if (row.sequence.length !== query.length || seen.has(row.sequence)) return;
    if ([...row.sequence].some((letter) => !RESTYPES.includes(AA_ALIASES[letter] || letter) && !['X', '-'].includes(letter))) return;
    seen.add(row.sequence);
    rows.push(row);
  };
  add({ description: 'query', sequence: query, deletions: Array(query.length).fill(0) });
  for (const document of documents || []) for (const row of parseA3m(document)) add(row);
  if (!rows.length) throw new Error('The MSA result did not contain a valid query alignment.');
  return rows;
}

function randomGenerator(seed) {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffledHitIndices(count, random) {
  const values = Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 1);
  for (let index = values.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function oneHotWrite(target, offset, index, classes) {
  if (index >= 0 && index < classes) target[offset + index] = 1;
}

function categoricalSample(weights, random) {
  let value = random();
  for (let index = 0; index < weights.length; index++) {
    value -= weights[index];
    if (value <= 0) return index;
  }
  return weights.length - 1;
}

function encodeRows(rows, length) {
  return rows.map((row) => ({
    ids: Int32Array.from([...row.sequence], residueId),
    deletions: Float32Array.from(row.deletions.slice(0, length)),
  }));
}

function makeAtomMappings(aatype, length, bucket) {
  const atom14AtomExists = new Float32Array(bucket * 14);
  const atom14To37 = new BigInt64Array(bucket * 14);
  const atom37To14 = new BigInt64Array(bucket * 37);
  const atom37AtomExists = new Float32Array(bucket * 37);
  for (let residue = 0; residue < length; residue++) {
    const names = ATOM14_BY_RESTYPE[Number(aatype[residue])];
    for (let atom14 = 0; atom14 < 14; atom14++) {
      const name = names[atom14];
      if (!name) continue;
      const atom37 = atomOrder.get(name);
      atom14AtomExists[residue * 14 + atom14] = 1;
      atom14To37[residue * 14 + atom14] = BigInt(atom37);
      atom37To14[residue * 37 + atom37] = BigInt(atom14);
      atom37AtomExists[residue * 37 + atom37] = 1;
    }
  }
  return { atom14AtomExists, atom14To37, atom37To14, atom37AtomExists };
}

export function buildOpenFoldFeatures({ sequence, alignments, seed = 0x4f50464c, bucket: requestedBucket }) {
  const normalized = normalizeProteinSequence(sequence);
  const length = normalized.length;
  const selectedBucket = requestedBucket == null
    ? selectOpenFoldBucket(length)
    : OPENFOLD_BUCKETS.find((candidate) => candidate === requestedBucket ||
      candidate.residues === Number(requestedBucket?.residues ?? requestedBucket));
  if (!selectedBucket || length > selectedBucket.residues)
    throw new Error(`No exported OpenFold bucket can fit ${length} residues.`);
  const { residues: bucket, msaClusters, extraMsa } = selectedBucket;
  const rows = Array.isArray(alignments) && typeof alignments[0]?.sequence === 'string'
    ? alignments
    : mergeA3mDocuments(alignments || [], normalized);
  const encoded = encodeRows(rows, length);
  const random = randomGenerator(seed);
  const shuffled = shuffledHitIndices(encoded.length, random);
  const selectedIndices = [0, ...shuffled.slice(0, msaClusters - 1)];
  const extraIndices = shuffled.slice(msaClusters - 1, msaClusters - 1 + extraMsa);
  const selected = selectedIndices.map((index) => encoded[index]);
  const extra = extraIndices.map((index) => encoded[index]);

  // HHblits profile is computed over the complete, unmasked MSA.
  const fullProfile = new Float32Array(length * 22);
  for (const row of encoded) for (let residue = 0; residue < length; residue++)
    fullProfile[residue * 22 + row.ids[residue]] += 1 / encoded.length;

  // OpenFold prediction masks 15% of selected MSA tokens before clustering.
  const maskedSelected = selected.map((row) => ({ ids: row.ids.slice(), deletions: row.deletions }));
  for (const row of maskedSelected) for (let residue = 0; residue < length; residue++) {
    if (random() >= 0.15) continue;
    const weights = new Float32Array(23);
    for (let aa = 0; aa < 20; aa++) weights[aa] = 0.005;
    for (let aa = 0; aa < 22; aa++) weights[aa] += 0.1 * fullProfile[residue * 22 + aa];
    weights[row.ids[residue]] += 0.1;
    weights[22] += 0.7;
    row.ids[residue] = categoricalSample(weights, random);
  }

  const assignments = extra.map((row) => {
    let bestIndex = 0;
    let bestScore = -1;
    for (let cluster = 0; cluster < maskedSelected.length; cluster++) {
      let score = 0;
      for (let residue = 0; residue < length; residue++) {
        const token = row.ids[residue];
        if (token <= 20 && token === maskedSelected[cluster].ids[residue]) score++;
      }
      if (score > bestScore) { bestScore = score; bestIndex = cluster; }
    }
    return bestIndex;
  });

  const clusterProfiles = maskedSelected.map((row) => {
    const profile = new Float32Array(length * 23);
    const deletionSum = row.deletions.slice();
    const counts = new Float32Array(length); counts.fill(1);
    for (let residue = 0; residue < length; residue++)
      profile[residue * 23 + row.ids[residue]] = 1;
    return { profile, deletionSum, counts };
  });
  extra.forEach((row, extraIndex) => {
    const cluster = clusterProfiles[assignments[extraIndex]];
    for (let residue = 0; residue < length; residue++) {
      cluster.profile[residue * 23 + row.ids[residue]]++;
      cluster.deletionSum[residue] += row.deletions[residue];
      cluster.counts[residue]++;
    }
  });

  const aatype = new BigInt64Array(bucket); aatype.fill(20n);
  const residueIndex = new BigInt64Array(bucket);
  const seqMask = new Float32Array(bucket);
  const targetFeat = new Float32Array(bucket * 22);
  for (let residue = 0; residue < bucket; residue++) residueIndex[residue] = BigInt(residue);
  for (let residue = 0; residue < length; residue++) {
    const id = residueId(normalized[residue]);
    aatype[residue] = BigInt(id);
    seqMask[residue] = 1;
    targetFeat[residue * 22 + 1 + id] = 1;
  }

  const msaMask = new Float32Array(msaClusters * bucket);
  const msaFeat = new Float32Array(msaClusters * bucket * 49);
  maskedSelected.forEach((row, clusterIndex) => {
    const summary = clusterProfiles[clusterIndex];
    for (let residue = 0; residue < length; residue++) {
      msaMask[clusterIndex * bucket + residue] = 1;
      const offset = (clusterIndex * bucket + residue) * 49;
      oneHotWrite(msaFeat, offset, row.ids[residue], 23);
      const deletion = row.deletions[residue];
      msaFeat[offset + 23] = Math.min(1, deletion);
      msaFeat[offset + 24] = Math.atan(deletion / 3) * (2 / Math.PI);
      const count = summary.counts[residue];
      for (let token = 0; token < 23; token++)
        msaFeat[offset + 25 + token] = summary.profile[residue * 23 + token] / count;
      msaFeat[offset + 48] = Math.atan((summary.deletionSum[residue] / count) / 3) * (2 / Math.PI);
    }
  });

  const extraMsaIds = new BigInt64Array(extraMsa * bucket);
  const extraMsaMask = new Float32Array(extraMsa * bucket);
  const extraHasDeletion = new Float32Array(extraMsa * bucket);
  const extraDeletionValue = new Float32Array(extraMsa * bucket);
  extra.forEach((row, rowIndex) => {
    for (let residue = 0; residue < length; residue++) {
      const offset = rowIndex * bucket + residue;
      extraMsaIds[offset] = BigInt(row.ids[residue]);
      extraMsaMask[offset] = 1;
      extraHasDeletion[offset] = Math.min(1, row.deletions[residue]);
      extraDeletionValue[offset] = Math.atan(row.deletions[residue] / 3) * (2 / Math.PI);
    }
  });

  const atom = makeAtomMappings(aatype, length, bucket);
  const features = {
    aatype: { type: 'int64', data: aatype, dims: [1, bucket] },
    residue_index: { type: 'int64', data: residueIndex, dims: [1, bucket] },
    seq_mask: { type: 'float32', data: seqMask, dims: [1, bucket] },
    msa_mask: { type: 'float32', data: msaMask, dims: [1, msaClusters, bucket] },
    msa_feat: { type: 'float32', data: msaFeat, dims: [1, msaClusters, bucket, 49] },
    target_feat: { type: 'float32', data: targetFeat, dims: [1, bucket, 22] },
    extra_msa: { type: 'int64', data: extraMsaIds, dims: [1, extraMsa, bucket] },
    extra_msa_mask: { type: 'float32', data: extraMsaMask, dims: [1, extraMsa, bucket] },
    extra_has_deletion: { type: 'float32', data: extraHasDeletion, dims: [1, extraMsa, bucket] },
    extra_deletion_value: { type: 'float32', data: extraDeletionValue, dims: [1, extraMsa, bucket] },
    atom14_atom_exists: { type: 'float32', data: atom.atom14AtomExists, dims: [1, bucket, 14] },
    residx_atom14_to_atom37: { type: 'int64', data: atom.atom14To37, dims: [1, bucket, 14] },
    residx_atom37_to_atom14: { type: 'int64', data: atom.atom37To14, dims: [1, bucket, 37] },
    atom37_atom_exists: { type: 'float32', data: atom.atom37AtomExists, dims: [1, bucket, 37] },
  };
  return {
    sequence: normalized,
    features,
    metadata: { sequenceLength: length, bucketResidues: bucket, msaDepth: rows.length,
      selectedMsaDepth: selected.length, extraMsaDepth: extra.length, seed },
  };
}

export function predictedAtoms(sequence, positions, mask, plddt) {
  const normalized = normalizeProteinSequence(sequence);
  const atoms = [];
  for (let residue = 0; residue < normalized.length; residue++) {
    for (let atom = 0; atom < 37; atom++) {
      if (mask[residue * 37 + atom] < 0.5) continue;
      const offset = (residue * 37 + atom) * 3;
      const name = ATOM_TYPES[atom];
      atoms.push({
        element: name[0], atomName: name, residueName: RESTYPE_3[normalized[residue]] || 'UNK',
        residueIndex: residue + 1, chain: 'A', x: positions[offset], y: positions[offset + 1],
        z: positions[offset + 2], plddt: plddt[residue],
      });
    }
  }
  return atoms;
}

export function predictionToPdb(sequence, positions, mask, plddt) {
  return `${predictedAtoms(sequence, positions, mask, plddt).map((atom, index) => {
    const serial = String(index + 1).padStart(5);
    const atomName = atom.atomName.padStart(4);
    const residue = atom.residueName.padStart(3);
    const residueIndex = String(atom.residueIndex).padStart(4);
    const x = atom.x.toFixed(3).padStart(8);
    const y = atom.y.toFixed(3).padStart(8);
    const z = atom.z.toFixed(3).padStart(8);
    const confidence = atom.plddt.toFixed(2).padStart(6);
    return `ATOM  ${serial} ${atomName} ${residue} A${residueIndex}    ${x}${y}${z}  1.00${confidence}          ${atom.element.padStart(2)}`;
  }).join('\n')}\nEND\n`;
}
