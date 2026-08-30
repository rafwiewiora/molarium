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
    const multipleBond = neighbors.find(({ order }) => order >= 1.8);
    if (multipleBond) {
      const center = molecule.atoms[multipleBond.index]?.element;
      if (center === 'C') return 'carbonyl oxygen acceptor';
      if (center === 'S') return 'sulfonyl oxygen acceptor';
      if (center === 'P') return 'phosphoryl oxygen acceptor';
      return 'multiple-bonded oxygen acceptor';
    }
    return neighbors.length <= 2 ? 'neutral oxygen acceptor' : null;
  }
  if (atom.element === 'N') {
    if (neighbors.some(({ index }) => molecule.atoms[index]?.element === 'H')) return null;
    if (neighbors.length >= 4) return null;
    if (neighbors.some(({ index, order }) => order >= 2.8
      && molecule.atoms[index]?.element === 'C')) return 'nitrile nitrogen acceptor';
    const amideLike = neighbors.some(({ index, order }) => order < 1.2
      && isCarbonylCenter(molecule, entries, index));
    return amideLike ? null : atom.aromatic ? 'aromatic nitrogen acceptor' : 'neutral nitrogen acceptor';
  }
  if (atom.element === 'S') {
    if (charge < 0) return 'anionic sulfur acceptor';
    // A sulfone/sulfoxide sulfur is electrophilic; its oxygens are the
    // acceptors. Neutral divalent sulfur (for example a thioether) can be an
    // acceptor, but do not manufacture a third hypothesis at the sulfur
    // center of S(IV)/S(VI) groups.
    if (neighbors.some(({ index, order }) => order >= 1.8
      && ['O', 'N', 'S'].includes(molecule.atoms[index]?.element))) return null;
    return neighbors.length <= 2 ? 'neutral sulfur acceptor' : null;
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
  // A stable atom can change pharmacophore identity solely because a
  // neighbour changed element or bonding.  For example, the original oxygen
  // in C=O -> S(=O)2 keeps its atom ID and S=O bond order, but changes from a
  // carbonyl acceptor into a sulfonyl acceptor.  Treat that surviving feature
  // atom as edited so it participates in the same boundary-constrained
  // bioisostere hypothesis as newly added acceptors.
  [...beforeIds].filter((id) => afterIds.has(id)).forEach((id) => {
    const beforeIndex = before.get(id).index;
    const afterIndex = after.get(id).index;
    for (const role of ['acceptor', 'donor']) {
      if (hydrogenBondFeatureSignature(beforeMolecule, beforeIndex, role)
        !== hydrogenBondFeatureSignature(molecule, afterIndex, role)) {
        changed.add(id);
        break;
      }
    }
  });
  // Bond-order changes can create or destroy a pharmacophore without changing
  // either endpoint's atom identity. Include both surviving endpoints in the
  // edit region, while keeping a stable attachment atom outside the region
  // when its bond to a newly added or removed atom is merely created/broken.
  const bondOrders = (candidate) => new Map((candidate.bonds || []).flatMap((bond) => {
    const first = candidate.atoms[bond.a]?.designAtomId;
    const second = candidate.atoms[bond.b]?.designAtomId;
    if (!first || !second) return [];
    const ids = [first, second].sort();
    return [[ids.join('\u0000'), roundedBondOrder(bond.order)]];
  }));
  const beforeBonds = bondOrders(beforeMolecule), afterBonds = bondOrders(molecule);
  new Set([...beforeBonds.keys(), ...afterBonds.keys()]).forEach((key) => {
    if (beforeBonds.get(key) === afterBonds.get(key)) return;
    const ids = key.split('\u0000');
    if (ids.every((id) => beforeIds.has(id) && afterIds.has(id)))
      ids.forEach((id) => changed.add(id));
  });
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

function regionConnectedToBoundary(molecule, regionIds, boundaryIds) {
  const byId = atomsById(molecule);
  const entries = adjacency(molecule);
  const region = new Set([...regionIds].filter((id) => byId.has(id)));
  const boundary = new Set(boundaryIds);
  const queue = [...region].filter((id) => entries[byId.get(id).index].some(({ index }) =>
    boundary.has(molecule.atoms[index].designAtomId)));
  const connected = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    entries[byId.get(id).index].forEach(({ index }) => {
      const neighborId = molecule.atoms[index].designAtomId;
      if (region.has(neighborId) && !connected.has(neighborId)) {
        connected.add(neighborId); queue.push(neighborId);
      }
    });
  }
  return connected;
}

function sameIds(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function featureMatchKind(originalSignature, candidateSignature) {
  return originalSignature && candidateSignature === originalSignature
    ? 'exact-feature' : 'role-compatible-bioisostere';
}

export function proposeLigandHydrogenBondFeatureRemaps(definitions, molecule,
  ligandAtomIndices, { eligibleAtomIndices = [], beforeMolecule = null,
    editRegionsOverride = null } = {}) {
  const eligible = new Set(Array.from(eligibleAtomIndices || [], Number));
  const features = perceiveLigandHydrogenBondFeatures(molecule, ligandAtomIndices);
  const acceptorById = new Map(features.acceptors.map((feature) => [feature.atomIds[0], feature]));
  const donorById = new Map(features.donors.map((feature) => [feature.atomIds[0], feature]));
  const donorPairs = new Map(features.donors.map((feature) => [feature.atomIds.join('\u0000'), feature]));
  const inferredRegions = beforeMolecule ? editRegionIds(beforeMolecule, molecule) : null;
  const regions = beforeMolecule && editRegionsOverride ? {
    before:inferredRegions.before, after:inferredRegions.after,
    removed:new Set(editRegionsOverride.removedAtomIds || []),
    added:new Set(editRegionsOverride.addedAtomIds || []),
    changed:new Set(editRegionsOverride.changedAtomIds || []),
  } : inferredRegions;
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
    // A changed heavy-donor signature is not this special case: it must use
    // the normal cumulative edit region and the original scaffold boundary.
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
            matchKind:featureMatchKind(originalSignature, feature.signature),
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
    // A donor heavy atom and its explicit hydrogen are one pharmacophore
    // tuple. Include both tuple members in the old and new candidate regions;
    // otherwise an unchanged H is incorrectly counted as an old scaffold
    // boundary but removed from the new boundary when evaluating the same
    // surviving donor after a neighbouring atom changes feature class.
    const oldCandidateRegion = new Set(oldRegion);
    originalIds.forEach((id) => oldCandidateRegion.add(id));
    const oldBoundary = regions ? regionBoundary(beforeMolecule, oldCandidateRegion, originalIds,
      new Set(regions.after.keys())) : [];
    const editEligibleFeatures = (ligandRole === 'acceptor' ? features.acceptors : features.donors)
      .filter((feature) => feature.atomIds.some((id) => {
        const index = molecule.atoms.findIndex((atom) => atom.designAtomId === id);
        return eligible.has(index) || newRegion.has(id);
      }))
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
          matchKind:featureMatchKind(originalSignature, feature.signature),
          boundaryAnchorIds,
          geometry, geometryScore:geometry ? geometryScore(geometry) : Number.POSITIVE_INFINITY };
      })
      // Geometry is evidence for later refinement, never a candidate selector.
      .sort((first, second) => first.id.localeCompare(second.id));
    const pool = editEligibleFeatures.filter((feature) => !regions || oldBoundary.length > 0
      && sameIds(feature.boundaryAnchorIds, oldBoundary));
    return { id:definition.id, status:pool.length === 1 ? 'unique'
        : pool.length ? 'ambiguous' : 'unavailable', ligandRole,
      originalFeatureSignature:originalSignature, boundaryAnchorIds:oldBoundary, candidates:pool,
      editEligibleFeatures,
      // Persist the live side of this transaction's edit region. A replacement
      // ring is often built and sanitized in several commits before its final
      // donor/acceptor feature exists.
      editRegionAtomIds:[...newRegion].sort() };
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
    if (!live) return [];
    return [{ ...candidate, ...live, boundaryAnchorIds:[...(candidate.boundaryAnchorIds || [])],
      matchKind:featureMatchKind(priorProposal.originalFeatureSignature, live.signature),
      geometry:null, geometryScore:Number.POSITIVE_INFINITY,
      geometryEvidenceStatus:'not-used; candidate retained from the originating edit' }];
  });
  // A group replacement can be committed as a deletion followed by an
  // addition. Only the deletion graph can recover the removed feature's
  // boundary, while only the addition graph contains the replacement. Reuse
  // the audited originating boundary for exact, edit-eligible features from
  // this transaction; never broaden the match to pre-existing ligand features.
  const originatingSignature = priorProposal.originalFeatureSignature
    || currentProposal?.originalFeatureSignature;
  const originatingBoundary = priorProposal.boundaryAnchorIds
    || currentProposal?.boundaryAnchorIds || [];
  const liveIds = new Set(molecule.atoms.map((atom) => atom.designAtomId));
  const allBoundaryIdsLive = originatingBoundary.length > 0
    && originatingBoundary.every((id) => liveIds.has(id));
  const rawCumulativeEditRegion = new Set([
    ...(priorProposal.cumulativeEditRegionAtomIds || priorProposal.editRegionAtomIds || []),
    ...(currentProposal?.editRegionAtomIds || []),
  ].filter((id) => liveIds.has(id)));
  // The captured boundary is the immutable scaffold side of the replacement,
  // even if a later bond-order edit happens to touch it.
  originatingBoundary.forEach((id) => rawCumulativeEditRegion.delete(id));
  // Keep only connected replacement components that still touch the complete,
  // live originating scaffold boundary. This prevents an unrelated edit from
  // polluting provenance and prevents a detached formerly valid candidate from
  // surviving on a stale cached boundary.
  const cumulativeEditRegion = allBoundaryIdsLive
    ? regionConnectedToBoundary(molecule, rawCumulativeEditRegion, originatingBoundary)
    : new Set();
  const outsideEditRegion = new Set([...liveIds].filter((id) => !cumulativeEditRegion.has(id)));
  const combined = new Map([...retained, ...(currentProposal?.editEligibleFeatures || []),
    ...(currentProposal?.candidates || [])]
    .map((candidate) => [candidate.id, candidate]));
  const candidates = allBoundaryIdsLive ? [...combined.values()].flatMap((candidate) => {
    const live = liveFeatures.get(`${candidate.role}:${candidate.atomIds.join('+')}`);
    if (!live || live.role !== priorProposal.ligandRole) return [];
    const boundaryAnchorIds = regionBoundary(molecule, cumulativeEditRegion,
      live.atomIds, outsideEditRegion);
    return sameIds(boundaryAnchorIds, originatingBoundary)
      ? [{ ...candidate, ...live, boundaryAnchorIds,
        matchKind:featureMatchKind(originatingSignature, live.signature) }] : [];
  }).sort((first, second) => first.id.localeCompare(second.id)) : [];
  if (!candidates.length) return { ...currentProposal,
    status:'unavailable', candidates:[],
    originalFeatureSignature:originatingSignature,
    boundaryAnchorIds:originatingBoundary,
    cumulativeEditRegionAtomIds:[...cumulativeEditRegion].sort() };
  return { ...currentProposal,
    status:candidates.length === 1 ? 'unique' : 'ambiguous', candidates,
    originalFeatureSignature:originatingSignature,
    boundaryAnchorIds:originatingBoundary,
    cumulativeEditRegionAtomIds:[...cumulativeEditRegion].sort(),
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
  const originalFeature = candidate.role === 'acceptor' ? definition.acceptor : definition.donor;
  remapped.targetLigandFeatureReferencePoint = originalFeature?.referencePoint
    ? { ...originalFeature.referencePoint } : null;
  return remapped;
}
