import { createHash } from 'node:crypto';

const COORDINATE_RECORDS = new Set(['ATOM', 'HETATM']);

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function parsePdb(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const atoms = [];
  for (const [lineIndex, line] of lines.entries()) {
    const record = line.slice(0, 6).trim();
    if (!COORDINATE_RECORDS.has(record)) continue;
    const altLoc = line.slice(16, 17).trim();
    if (altLoc && altLoc !== 'A') continue;
    atoms.push({
      lineIndex,
      line,
      record,
      serial:Number(line.slice(6, 11)),
      atomName:line.slice(12, 16).trim(),
      altLoc,
      resName:line.slice(17, 20).trim(),
      chain:line.slice(21, 22).trim(),
      resSeq:Number(line.slice(22, 26)),
      iCode:line.slice(26, 27).trim(),
      x:Number(line.slice(30, 38)),
      y:Number(line.slice(38, 46)),
      z:Number(line.slice(46, 54)),
      element:line.slice(76, 78).trim() || line.slice(12, 14).trim(),
    });
  }
  return { lines, atoms };
}

export const point = (atom) => [atom.x, atom.y, atom.z];

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function atomsForResidue(model, spec) {
  return model.atoms.filter((atom) => atom.resName === spec.resName
    && atom.chain === spec.chain && atom.resSeq === spec.resSeq);
}

function residueKey(atom) {
  return `${atom.chain}:${atom.resSeq}:${atom.iCode}:${atom.resName}`;
}

export function pocketResidues(model, ligandAtoms, cutoffAngstrom = 5) {
  const keys = new Set();
  for (const atom of model.atoms) {
    if (atom.record !== 'ATOM') continue;
    if (ligandAtoms.some((ligand) => distance(point(atom), point(ligand)) <= cutoffAngstrom))
      keys.add(residueKey(atom));
  }
  return keys;
}

function selectedConect(line, serials) {
  const fields = line.slice(6).match(/.{1,5}/g)?.map((value) => Number(value.trim()))
    .filter(Number.isFinite) || [];
  return fields.length > 1 && serials.has(fields[0]) && fields.slice(1).some((serial) => serials.has(serial));
}

export function subsetPdb(model, predicate, title) {
  const selected = model.atoms.filter(predicate);
  const lineIndexes = new Set(selected.map((atom) => atom.lineIndex));
  const serials = new Set(selected.map((atom) => atom.serial));
  const lines = [`HEADER    ${String(title || 'MOLARIUM STRUCTURE').slice(0, 40).padEnd(40)}`];
  for (const [index, line] of model.lines.entries()) {
    if (lineIndexes.has(index)) lines.push(line);
    else if (line.startsWith('CONECT') && selectedConect(line, serials)) lines.push(line);
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

function centroid(points) {
  const sum = points.reduce((value, item) => value.map((axis, index) => axis + item[index]), [0, 0, 0]);
  return sum.map((axis) => axis / points.length);
}

function largestEigenvectorSymmetric4(matrix) {
  const a = matrix.map((row) => [...row]);
  const vectors = Array.from({ length:4 }, (_, row) =>
    Array.from({ length:4 }, (_, column) => row === column ? 1 : 0));
  for (let sweep = 0; sweep < 80; sweep++) {
    let p = 0, q = 1, maximum = 0;
    for (let row = 0; row < 4; row++) for (let column = row + 1; column < 4; column++) {
      const magnitude = Math.abs(a[row][column]);
      if (magnitude > maximum) { maximum = magnitude; p = row; q = column; }
    }
    if (maximum < 1e-12) break;
    const angle = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let index = 0; index < 4; index++) {
      const aip = a[index][p], aiq = a[index][q];
      a[index][p] = c * aip - s * aiq;
      a[index][q] = s * aip + c * aiq;
    }
    for (let index = 0; index < 4; index++) {
      const api = a[p][index], aqi = a[q][index];
      a[p][index] = c * api - s * aqi;
      a[q][index] = s * api + c * aqi;
    }
    for (let index = 0; index < 4; index++) {
      const vip = vectors[index][p], viq = vectors[index][q];
      vectors[index][p] = c * vip - s * viq;
      vectors[index][q] = s * vip + c * viq;
    }
  }
  let largest = 0;
  for (let index = 1; index < 4; index++) if (a[index][index] > a[largest][largest]) largest = index;
  const vector = vectors.map((row) => row[largest]);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

function quaternionRotation([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function multiply(matrix, value) {
  return matrix.map((row) => row.reduce((sum, item, index) => sum + item * value[index], 0));
}

export function rigidFit(referencePoints, mobilePoints) {
  if (referencePoints.length !== mobilePoints.length || referencePoints.length < 3)
    throw new Error('Rigid alignment requires at least three paired points');
  const referenceCenter = centroid(referencePoints), mobileCenter = centroid(mobilePoints);
  const s = Array.from({ length:3 }, () => [0, 0, 0]);
  for (let index = 0; index < referencePoints.length; index++) {
    const p = referencePoints[index].map((value, axis) => value - referenceCenter[axis]);
    const q = mobilePoints[index].map((value, axis) => value - mobileCenter[axis]);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++)
      s[row][column] += q[row] * p[column];
  }
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = s;
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const rotation = quaternionRotation(largestEigenvectorSymmetric4(n));
  const rotatedCenter = multiply(rotation, mobileCenter);
  const translation = referenceCenter.map((value, axis) => value - rotatedCenter[axis]);
  const transform = (value) => multiply(rotation, value).map((axis, index) => axis + translation[index]);
  const rmsd = Math.sqrt(referencePoints.reduce((sum, value, index) => {
    const aligned = transform(mobilePoints[index]);
    return sum + value.reduce((part, axis, coordinate) => part + (axis - aligned[coordinate]) ** 2, 0);
  }, 0) / referencePoints.length);
  return { rotation, translation, transform, rmsd };
}

export function alignModels(reference, mobile, referenceChain = 'A', mobileChain = 'A') {
  const referenceCa = new Map(reference.atoms.filter((atom) => atom.record === 'ATOM'
    && atom.chain === referenceChain && atom.atomName === 'CA')
    .map((atom) => [`${atom.resSeq}:${atom.iCode}:${atom.resName}`, point(atom)]));
  const pairs = mobile.atoms.filter((atom) => atom.record === 'ATOM'
    && atom.chain === mobileChain && atom.atomName === 'CA')
    .map((atom) => ({ key:`${atom.resSeq}:${atom.iCode}:${atom.resName}`, mobile:point(atom) }))
    .filter((entry) => referenceCa.has(entry.key));
  const fit = rigidFit(pairs.map((entry) => referenceCa.get(entry.key)), pairs.map((entry) => entry.mobile));
  const atomsByLine = new Map(mobile.atoms.map((atom) => [atom.lineIndex, atom]));
  const lines = mobile.lines.map((line, index) => {
    const atom = atomsByLine.get(index);
    if (!atom) return line;
    const [x, y, z] = fit.transform(point(atom));
    return `${line.slice(0, 30)}${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}${line.slice(54)}`;
  });
  return { model:parsePdb(`${lines.join('\n')}\n`), pairs:pairs.length, rmsd:fit.rmsd,
    rotation:fit.rotation, translation:fit.translation };
}

export function coordinateSphere(atoms) {
  if (!atoms.length) throw new Error('A coordinate sphere needs atoms');
  const center = centroid(atoms.map(point));
  const radius = Math.max(...atoms.map((atom) => distance(point(atom), center)));
  return { center, radius };
}

export function interactionMolBlock(model, interactions, title = 'Published interactions') {
  const selected = interactions.map((interaction) => interaction.map((spec) => {
    const atom = model.atoms.find((candidate) => candidate.chain === spec.chain
      && candidate.resSeq === spec.resSeq && candidate.resName === spec.resName
      && candidate.atomName === spec.atomName);
    if (!atom) throw new Error(`Interaction atom not found: ${JSON.stringify(spec)}`);
    return atom;
  }));
  const atoms = selected.flat();
  const lines = [title, '  Molarium', '', `${String(atoms.length).padStart(3)}${String(interactions.length).padStart(3)}  0  0  0  0            999 V2000`];
  atoms.forEach((atom) => lines.push(`${atom.x.toFixed(4).padStart(10)}${atom.y.toFixed(4).padStart(10)}${atom.z.toFixed(4).padStart(10)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`));
  interactions.forEach((_, index) => lines.push(`${String(index * 2 + 1).padStart(3)}${String(index * 2 + 2).padStart(3)}  1  0  0  0  0`));
  lines.push('M  END', '$$$$');
  return `${lines.join('\n')}\n`;
}
