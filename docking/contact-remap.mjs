function formalCharge(atom) {
  const value = Number(atom?.formalCharge ?? atom?.charge ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function point(atom) {
  return { x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function adjacency(molecule) {
  const entries = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    entries[bond.a]?.push({ index:bond.b, order:Number(bond.order || 1) });
    entries[bond.b]?.push({ index:bond.a, order:Number(bond.order || 1) });
  });
  return entries;
}

function isCarbonylCenter(molecule, entries, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  return ['C', 'S', 'P'].includes(atom?.element)
    && entries[atomIndex].some(({ index, order }) => order >= 1.8
      && ['O', 'N', 'S'].includes(molecule.atoms[index]?.element));
}

function acceptorType(molecule, entries, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  const charge = formalCharge(atom);
  const neighbors = entries[atomIndex];
  if (!atom || atom.element === 'H' || charge > 0) return null;
  if (atom.element === 'O') {
    if (charge < 0) return 'anionic oxygen acceptor';
    if (neighbors.some(({ index }) => molecule.atoms[index]?.element === 'H')) {
      const acidLike = neighbors.some(({ index, order }) => order < 1.2
        && molecule.atoms[index]?.element !== 'H'
        && isCarbonylCenter(molecule, entries, index));
      return acidLike ? null : 'hydroxyl oxygen acceptor';
    }
    if (neighbors.some(({ order }) => order >= 1.8)) return 'carbonyl oxygen acceptor';
    return neighbors.length <= 2 ? 'neutral oxygen acceptor' : null;
  }
  if (atom.element === 'N') {
    if (neighbors.some(({ index }) => molecule.atoms[index]?.element === 'H')) return null;
    if (neighbors.length >= 4) return null;
    const amideLike = neighbors.some(({ index, order }) => order < 1.2
      && isCarbonylCenter(molecule, entries, index));
    return amideLike ? null : atom.aromatic ? 'aromatic nitrogen acceptor' : 'neutral nitrogen acceptor';
  }
  if (atom.element === 'S') {
    if (charge < 0) return 'anionic sulfur acceptor';
    return neighbors.length <= 4 ? 'neutral sulfur acceptor' : null;
  }
  if (atom.element === 'F') return neighbors.length <= 1 ? 'fluorine acceptor' : null;
  if (atom.element === 'P' && charge < 0) return 'anionic phosphorus acceptor';
  return null;
}

function donorType(molecule, entries, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  if (!atom || !['N', 'O', 'S'].includes(atom.element) || formalCharge(atom) < 0) return null;
  const hydrogens = entries[atomIndex]
    .filter(({ index }) => molecule.atoms[index]?.element === 'H')
    .map(({ index }) => index);
  if (!hydrogens.length) return null;
  return { type:atom.element === 'N' ? 'nitrogen donor'
      : atom.element === 'O' ? 'oxygen donor' : 'sulfur donor', hydrogens };
}

function descriptor(molecule, atomIndex, includeReferencePoint = false) {
  const atom = molecule.atoms[atomIndex];
  return { scope:'ligand', designAtomId:atom.designAtomId, element:atom.element,
    ...(includeReferencePoint ? { referencePoint:point(atom) } : {}) };
}

function roundedBondOrder(order) {
  const value = Number(order || 1);
  return Math.abs(value - 1.5) < 0.1 ? 1.5 : Math.round(value);
}

export function perceiveHydrogenBondFeature(molecule, atomIndex, role) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds)) return null;
  const entries = adjacency(molecule);
  const atom = molecule.atoms[atomIndex];
  if (!atom) return null;
  const donor = role === 'donor' ? donorType(molecule, entries, atomIndex) : null;
  const type = role === 'acceptor' ? acceptorType(molecule, entries, atomIndex)
    : donor?.type || null;
  if (!type) return null;
  const heavyNeighbors = entries[atomIndex]
    .filter(({ index }) => molecule.atoms[index]?.element !== 'H')
    .map(({ index, order }) => `${molecule.atoms[index].element}:${roundedBondOrder(order)}`)
    .sort();
  const signature = JSON.stringify({ role, element:atom.element, formalCharge:formalCharge(atom),
    aromatic:Boolean(atom.aromatic), heavyDegree:heavyNeighbors.length, heavyNeighbors, type });
  return { role, type, atomIndex, signature,
    hydrogenIndices:donor ? [...donor.hydrogens] : [] };
}

export function hydrogenBondFeatureSignature(molecule, atomIndex, role) {
  return perceiveHydrogenBondFeature(molecule, atomIndex, role)?.signature || null;
}

function hydrogenBondGeometry(donor, hydrogen, acceptor) {
  const hd = { x:donor.x - hydrogen.x, y:donor.y - hydrogen.y, z:donor.z - hydrogen.z };
  const ha = { x:acceptor.x - hydrogen.x, y:acceptor.y - hydrogen.y, z:acceptor.z - hydrogen.z };
  const denominator = Math.hypot(hd.x, hd.y, hd.z) * Math.hypot(ha.x, ha.y, ha.z);
  const cosine = denominator ? Math.max(-1, Math.min(1,
    (hd.x * ha.x + hd.y * ha.y + hd.z * ha.z) / denominator)) : 1;
  return {
    donorAcceptorDistanceAngstrom:distance(donor, acceptor),
    hydrogenAcceptorDistanceAngstrom:distance(hydrogen, acceptor),
    dhaAngleDegrees:Math.acos(cosine) * 180 / Math.PI,
  };
}

function geometryScore(geometry) {
  return Math.abs(geometry.hydrogenAcceptorDistanceAngstrom - 1.9)
    + 0.5 * Math.abs(geometry.donorAcceptorDistanceAngstrom - 2.9)
    + Math.max(0, 150 - geometry.dhaAngleDegrees) / 30;
}

export function perceiveLigandHydrogenBondFeatures(molecule, ligandAtomIndices) {
  if (!molecule?.atoms?.length) throw new Error('A molecular graph is required');
  const ligand = new Set(Array.from(ligandAtomIndices || [], Number));
  const acceptors = [], donors = [];
  [...ligand].sort((first, second) => first - second).forEach((atomIndex) => {
    const acceptor = perceiveHydrogenBondFeature(molecule, atomIndex, 'acceptor');
    if (acceptor) acceptors.push({ role:'acceptor', type:acceptor.type, atomIndex,
      atomIds:[molecule.atoms[atomIndex].designAtomId],
      signature:acceptor.signature,
      replacement:{ acceptor:{ ...descriptor(molecule, atomIndex),
        featureSignature:acceptor.signature } } });
    const donor = perceiveHydrogenBondFeature(molecule, atomIndex, 'donor');
    if (!donor) return;
    donors.push(...donor.hydrogenIndices.map((hydrogenIndex) => ({
      role:'donor', type:donor.type, atomIndex, hydrogenIndex,
      atomIds:[molecule.atoms[atomIndex].designAtomId, molecule.atoms[hydrogenIndex].designAtomId],
      signature:donor.signature,
      replacement:{ donor:{ ...descriptor(molecule, atomIndex),
          featureSignature:donor.signature },
        // A replacement hydrogen has no captured reference coordinate. The
        // torsion/refinement stages must place it; restoring the deleted H's
        // coordinate would manufacture geometry.
        hydrogen:descriptor(molecule, hydrogenIndex) },
    })));
  });
  return { acceptors, donors };
}

export function validateCapturedLigandHydrogenBondFeature(definition, molecule) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('A complete candidate molecular graph is required');
  const ligandRole = definition?.receptorRole === 'donor' ? 'acceptor' : 'donor';
  const descriptors = [definition?.donor, definition?.hydrogen, definition?.acceptor]
    .filter((entry) => entry?.scope === 'ligand');
  const byId = new Map(molecule.atoms.map((atom, index) => [atom.designAtomId, { atom, index }]));
  const missingAtomIds = descriptors.filter((entry) => !byId.has(entry.designAtomId))
    .map((entry) => entry.designAtomId);
  const incompatibleAtomIds = descriptors.filter((entry) => {
    const current = byId.get(entry.designAtomId)?.atom;
    return current && entry.element && current.element !== entry.element;
  }).map((entry) => entry.designAtomId);
  const reasons = [];
  if (missingAtomIds.length) reasons.push('ligand-participant-missing');
  if (incompatibleAtomIds.length) reasons.push('ligand-participant-element-changed');
  if (!missingAtomIds.length && !incompatibleAtomIds.length && ligandRole === 'acceptor') {
    const descriptorValue = definition.acceptor;
    const current = perceiveHydrogenBondFeature(molecule,
      byId.get(descriptorValue.designAtomId)?.index, 'acceptor');
    if (!descriptorValue.featureSignature || current?.signature !== descriptorValue.featureSignature) {
      incompatibleAtomIds.push(descriptorValue.designAtomId);
      reasons.push(!current ? 'ligand-acceptor-untyped' : 'ligand-acceptor-signature-changed');
    }
  }
  if (!missingAtomIds.length && !incompatibleAtomIds.length && ligandRole === 'donor') {
    const donorDescriptor = definition.donor, hydrogenDescriptor = definition.hydrogen;
    const donor = perceiveHydrogenBondFeature(molecule,
      byId.get(donorDescriptor.designAtomId)?.index, 'donor');
    const hydrogenIndex = byId.get(hydrogenDescriptor.designAtomId)?.index;
    if (!donorDescriptor.featureSignature || donor?.signature !== donorDescriptor.featureSignature) {
      incompatibleAtomIds.push(donorDescriptor.designAtomId);
      reasons.push(!donor ? 'ligand-donor-untyped' : 'ligand-donor-signature-changed');
    } else if (!donor.hydrogenIndices.includes(hydrogenIndex)) {
      incompatibleAtomIds.push(hydrogenDescriptor.designAtomId);
      reasons.push('ligand-donor-hydrogen-bond-missing');
    }
  }
  return { id:definition?.id, ligandRole,
    available:missingAtomIds.length === 0 && incompatibleAtomIds.length === 0,
    missingAtomIds:[...new Set(missingAtomIds)],
    incompatibleAtomIds:[...new Set(incompatibleAtomIds)], reasons };
}

function ligandDescriptorCompatible(descriptorValue, molecule, featureById, signature = null) {
  if (descriptorValue?.scope !== 'ligand') return true;
  const atom = molecule.atoms.find((candidate) => candidate.designAtomId === descriptorValue.designAtomId);
  const feature = featureById.get(descriptorValue.designAtomId);
  return Boolean(atom && (!descriptorValue.element || atom.element === descriptorValue.element)
    && feature && (!signature || feature.signature === signature));
}

function receptorPoint(descriptorValue) {
  return descriptorValue?.point ? { ...descriptorValue.point } : null;
}

function candidateGeometry(definition, molecule, feature) {
  if (definition.receptorRole === 'donor') {
    const donor = receptorPoint(definition.donor);
    const hydrogen = receptorPoint(definition.hydrogen);
    const acceptor = point(molecule.atoms[feature.atomIndex]);
    return donor && hydrogen ? hydrogenBondGeometry(donor, hydrogen, acceptor) : null;
  }
  const donor = point(molecule.atoms[feature.atomIndex]);
  const hydrogen = point(molecule.atoms[feature.hydrogenIndex]);
  const acceptor = receptorPoint(definition.acceptor);
  return acceptor ? hydrogenBondGeometry(donor, hydrogen, acceptor) : null;
}

function atomsById(molecule) {
  return new Map(molecule.atoms.map((atom, index) => [atom.designAtomId, { atom, index }]));
}

function atomIdentity(atom) {
  return JSON.stringify([atom.element, formalCharge(atom), Boolean(atom.aromatic)]);
}

function editRegionIds(beforeMolecule, molecule) {
  const before = atomsById(beforeMolecule), after = atomsById(molecule);
  const beforeIds = new Set(before.keys()), afterIds = new Set(after.keys());
  const removed = new Set([...beforeIds].filter((id) => !afterIds.has(id)));
  const added = new Set([...afterIds].filter((id) => !beforeIds.has(id)));
  const changed = new Set([...beforeIds].filter((id) => afterIds.has(id)
    && atomIdentity(before.get(id).atom) !== atomIdentity(after.get(id).atom)));
  return { before, after, removed, added, changed };
}

function regionBoundary(molecule, regionIds, seedIds, counterpartIds) {
  const byId = atomsById(molecule);
  const entries = adjacency(molecule);
  const seeds = Array.from(seedIds || []).filter((id) => regionIds.has(id) && byId.has(id));
  if (!seeds.length) return [];
  const visited = new Set(seeds), queue = [...seeds];
  while (queue.length) {
    const id = queue.shift();
    const current = byId.get(id);
    entries[current.index].forEach(({ index }) => {
      const neighborId = molecule.atoms[index].designAtomId;
      if (regionIds.has(neighborId) && !visited.has(neighborId)) {
        visited.add(neighborId); queue.push(neighborId);
      }
    });
  }
  const boundary = new Set();
  visited.forEach((id) => {
    const current = byId.get(id);
    entries[current.index].forEach(({ index }) => {
      const neighborId = molecule.atoms[index].designAtomId;
      if (!visited.has(neighborId) && counterpartIds.has(neighborId)) boundary.add(neighborId);
    });
  });
  return [...boundary].sort();
}

function sameIds(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

export function proposeLigandHydrogenBondFeatureRemaps(definitions, molecule,
  ligandAtomIndices, { eligibleAtomIndices = [], beforeMolecule = null } = {}) {
  const eligible = new Set(Array.from(eligibleAtomIndices || [], Number));
  const features = perceiveLigandHydrogenBondFeatures(molecule, ligandAtomIndices);
  const acceptorById = new Map(features.acceptors.map((feature) => [feature.atomIds[0], feature]));
  const donorById = new Map(features.donors.map((feature) => [feature.atomIds[0], feature]));
  const donorPairs = new Map(features.donors.map((feature) => [feature.atomIds.join('\u0000'), feature]));
  const regions = beforeMolecule ? editRegionIds(beforeMolecule, molecule) : null;
  return Array.from(definitions || []).map((definition) => {
    const ligandRole = definition.receptorRole === 'donor' ? 'acceptor' : 'donor';
    const originalDescriptor = ligandRole === 'acceptor' ? definition.acceptor : definition.donor;
    const originalSignature = originalDescriptor?.featureSignature
      || (beforeMolecule ? hydrogenBondFeatureSignature(beforeMolecule,
        regions.before.get(originalDescriptor?.designAtomId)?.index, ligandRole) : null);
    const currentlyCompatible = ligandRole === 'acceptor'
      ? ligandDescriptorCompatible(definition.acceptor, molecule, acceptorById, originalSignature)
      : ligandDescriptorCompatible(definition.donor, molecule, donorById, originalSignature)
        && definition.hydrogen?.scope === 'ligand'
        && donorPairs.has([definition.donor.designAtomId, definition.hydrogen.designAtomId].join('\u0000'));
    if (currentlyCompatible) return { id:definition.id, status:'available',
      ligandRole, candidates:[] };
    // If the donor heavy atom survived but its explicit H was replaced during
    // valence reconciliation, anchor the tuple to that same donor. Treat each
    // new H as a separate exact candidate; do not expand the edit region
    // through the surviving donor and accidentally move the boundary outward.
    if (ligandRole === 'donor' && originalSignature) {
      const donorId = definition.donor?.designAtomId;
      const hydrogenId = definition.hydrogen?.designAtomId;
      const hydrogenCandidates = features.donors
        .filter((feature) => feature.atomIds[0] === donorId
          && feature.atomIds[1] !== hydrogenId
          && feature.signature === originalSignature)
        .filter((feature) => {
          const index = molecule.atoms.findIndex((atom) =>
            atom.designAtomId === feature.atomIds[1]);
          return eligible.has(index);
        })
        .map((feature) => {
          const geometry = candidateGeometry(definition, molecule, feature);
          const hydrogenIndex = molecule.atoms.findIndex((atom) =>
            atom.designAtomId === feature.atomIds[1]);
          return { ...feature,
            id:`donor:${feature.atomIds.join('+')}`,
            label:`${feature.type} · ${molecule.atoms[feature.atomIndex]?.element || '?'}${feature.atomIndex + 1}`
              + `–${molecule.atoms[hydrogenIndex]?.element || '?'}${hydrogenIndex + 1}`,
            originalFeatureSignature:originalSignature,
            boundaryAnchorIds:[donorId],
            geometry, geometryScore:geometry ? geometryScore(geometry) : Number.POSITIVE_INFINITY };
        })
        .sort((first, second) => first.id.localeCompare(second.id));
      if (hydrogenCandidates.length) return {
        id:definition.id,
        status:hydrogenCandidates.length === 1 ? 'unique' : 'ambiguous',
        ligandRole,
        originalFeatureSignature:originalSignature,
        boundaryAnchorIds:[donorId],
        candidates:hydrogenCandidates,
      };
    }
    const oldRegion = regions ? new Set([...regions.removed, ...regions.changed]) : new Set();
    const newRegion = regions ? new Set([...regions.added, ...regions.changed]) : new Set();
    const originalIds = ligandRole === 'acceptor'
      ? [definition.acceptor?.designAtomId]
      : [definition.donor?.designAtomId, definition.hydrogen?.designAtomId];
    const oldBoundary = regions ? regionBoundary(beforeMolecule, oldRegion, originalIds,
      new Set(regions.after.keys())) : [];
    const pool = (ligandRole === 'acceptor' ? features.acceptors : features.donors)
      .filter((feature) => feature.atomIds.some((id) => {
        const index = molecule.atoms.findIndex((atom) => atom.designAtomId === id);
        return eligible.has(index);
      }))
      .filter((feature) => !originalSignature || feature.signature === originalSignature)
      .map((feature) => {
        const candidateRegion = new Set(newRegion);
        feature.atomIds.forEach((id) => candidateRegion.add(id));
        const boundaryAnchorIds = regions ? regionBoundary(molecule, candidateRegion,
          feature.atomIds, new Set(regions.before.keys())) : [];
        const geometry = candidateGeometry(definition, molecule, feature);
        return { ...feature,
          id:`${ligandRole}:${feature.atomIds.join('+')}`,
          label:`${feature.type} · ${feature.atomIds.map((id) => {
            const index = molecule.atoms.findIndex((atom) => atom.designAtomId === id);
            return `${molecule.atoms[index]?.element || '?'}${index + 1}`;
          }).join('–')}`,
          originalFeatureSignature:originalSignature,
          boundaryAnchorIds,
          geometry, geometryScore:geometry ? geometryScore(geometry) : Number.POSITIVE_INFINITY };
      })
      .filter((feature) => !regions || oldBoundary.length > 0
        && sameIds(feature.boundaryAnchorIds, oldBoundary))
      // Geometry is evidence for later refinement, never a candidate selector.
      .sort((first, second) => first.id.localeCompare(second.id));
    return { id:definition.id, status:pool.length === 1 ? 'unique'
        : pool.length ? 'ambiguous' : 'unavailable', ligandRole,
      originalFeatureSignature:originalSignature, boundaryAnchorIds:oldBoundary, candidates:pool };
  });
}

export function retainOriginatingHydrogenBondRemapCandidates(priorProposal, currentProposal,
  molecule, ligandAtomIndices) {
  if (!priorProposal || currentProposal?.status === 'available') return currentProposal;
  const features = perceiveLigandHydrogenBondFeatures(molecule, ligandAtomIndices);
  const liveFeatures = new Map([...features.acceptors, ...features.donors]
    .map((feature) => [`${feature.role}:${feature.atomIds.join('+')}`, feature]));
  const retained = (priorProposal.candidates || []).flatMap((candidate) => {
    const live = liveFeatures.get(`${candidate.role}:${candidate.atomIds.join('+')}`);
    if (!live || live.signature !== candidate.signature) return [];
    return [{ ...candidate, ...live, boundaryAnchorIds:[...(candidate.boundaryAnchorIds || [])],
      geometry:null, geometryScore:Number.POSITIVE_INFINITY,
      geometryEvidenceStatus:'not-used; candidate retained from the originating edit' }];
  });
  const combined = new Map([...retained, ...(currentProposal?.candidates || [])]
    .map((candidate) => [candidate.id, candidate]));
  const candidates = [...combined.values()].sort((first, second) =>
    first.id.localeCompare(second.id));
  if (!candidates.length) return { ...currentProposal,
    originalFeatureSignature:priorProposal.originalFeatureSignature
      || currentProposal?.originalFeatureSignature,
    boundaryAnchorIds:priorProposal.boundaryAnchorIds || currentProposal?.boundaryAnchorIds };
  return { ...currentProposal,
    status:candidates.length === 1 ? 'unique' : 'ambiguous', candidates,
    originalFeatureSignature:priorProposal.originalFeatureSignature
      || currentProposal?.originalFeatureSignature,
    boundaryAnchorIds:priorProposal.boundaryAnchorIds || currentProposal?.boundaryAnchorIds,
    originatingCommittedEditId:priorProposal.originatingCommittedEditId
      || priorProposal.committedEditId,
  };
}

export function applyLigandHydrogenBondFeatureRemap(definition, candidate) {
  if (!definition || !candidate?.replacement) throw new Error('A contact and remap candidate are required');
  const remapped = structuredClone(definition);
  if (candidate.role === 'acceptor') remapped.acceptor = structuredClone(candidate.replacement.acceptor);
  else {
    remapped.donor = structuredClone(candidate.replacement.donor);
    remapped.hydrogen = structuredClone(candidate.replacement.hydrogen);
  }
  remapped.ligandFeatureRemap = {
    role:candidate.role, featureType:candidate.type,
    replacementAtomIds:[...candidate.atomIds], geometry:structuredClone(candidate.geometry),
  };
  return remapped;
}
