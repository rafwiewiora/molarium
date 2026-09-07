import { perceiveHydrogenBondFeature } from './contact-remap.mjs';

// DV-01: a graph-only edit must not lose a chemically unchanged single donor H
// merely by regenerating its name/ID. Do not infer multi-H or changed-role maps.
export function preserveRegisteredDonorHydrogens(precursor, product, definitions) {
  const lookup = (molecule) => new Map(molecule.atoms.map((atom,index) => [atom.designAtomId,{atom,index}]));
  const beforeById=lookup(precursor), afterById=lookup(product);
  const heavyNeighbors = (molecule,index) => molecule.bonds.flatMap((bond) => {
    const neighbor=bond.a===index?bond.b:bond.b===index?bond.a:null;
    return neighbor == null || molecule.atoms[neighbor].element==='H' ? []
      : [{atom:molecule.atoms[neighbor],order:Number(bond.order||1)}];
  });
  const neighborhood = (entries) => entries.map(({atom,order})=>
    JSON.stringify([atom.designAtomId,atom.element,order])).sort().join('|');
  const samePoint = (first,second) => ['x','y','z'].every((axis)=>Number.isFinite(first?.[axis])
    &&Number.isFinite(second?.[axis])&&Math.abs(first[axis]-second[axis])<=1e-9);
  const preserved=[],skipped=[],seen=new Set();
  for(const definition of definitions) {
    if(definition.donor?.scope!=='ligand'||definition.hydrogen?.scope!=='ligand')continue;
    const donorId=definition.donor.designAtomId,hydrogenId=definition.hydrogen.designAtomId;
    if(seen.has(hydrogenId))continue;
    seen.add(hydrogenId);
    const fail=(reason)=>skipped.push({contactId:definition.id,donorAtomId:donorId,hydrogenAtomId:hydrogenId,reason});
    const before=beforeById.get(donorId),after=afterById.get(donorId),oldH=beforeById.get(hydrogenId);
    if(!before||!after||!oldH){fail('captured-donor-or-hydrogen-missing');continue;}
    const oldFeature=perceiveHydrogenBondFeature(precursor,before.index,'donor');
    const newFeature=perceiveHydrogenBondFeature(product,after.index,'donor');
    if(!oldFeature||!newFeature||oldFeature.signature!==newFeature.signature
      ||oldFeature.signature!==definition.donor.featureSignature) {
      fail('donor-chemistry-changed');continue;
    }
    if(oldFeature.hydrogenIndices.length!==1||newFeature.hydrogenIndices.length!==1
      ||oldFeature.hydrogenIndices[0]!==oldH.index) {
      fail('hydrogen-count-or-correspondence-ambiguous');continue;
    }
    const oldNeighbors=heavyNeighbors(precursor,before.index),newNeighbors=heavyNeighbors(product,after.index);
    if(neighborhood(oldNeighbors)!==neighborhood(newNeighbors)) {
      fail('mapped-heavy-neighborhood-changed');continue;
    }
    if(!samePoint(before.atom,after.atom)||oldNeighbors.some(({atom})=>
      !samePoint(atom,afterById.get(atom.designAtomId)?.atom))) {
      fail('local-donor-geometry-changed');continue;
    }
    if(!['x','y','z'].every((axis)=>Number.isFinite(oldH.atom[axis]))) {
      fail('captured-hydrogen-coordinates-invalid');continue;
    }
    const newIndex=newFeature.hydrogenIndices[0],newH=product.atoms[newIndex];
    if(afterById.has(hydrogenId)&&afterById.get(hydrogenId).index!==newIndex)
      throw new Error('Preserved donor hydrogen identity already belongs to another product atom');
    const generatedAtomId=newH.designAtomId;
    afterById.delete(generatedAtomId);
    Object.assign(newH,{designAtomId:hydrogenId,atomName:oldH.atom.atomName,
      x:oldH.atom.x,y:oldH.atom.y,z:oldH.atom.z});
    for(const bond of product.bonds) if(bond.a===newIndex||bond.b===newIndex) {
      const first=product.atoms[bond.a],second=product.atoms[bond.b];
      bond.distance=Math.hypot(first.x-second.x,first.y-second.y,first.z-second.z);
    }
    afterById.set(hydrogenId,{atom:newH,index:newIndex});
    preserved.push({contactId:definition.id,donorAtomId:donorId,hydrogenAtomId:hydrogenId,
      replacedGeneratedAtomId:generatedAtomId,
      coordinateSource:'current-visible-precursor',maximumDisplacementAngstrom:0});
  }
  return {schema:'molarium.docking.registered-donor-hydrogen-lineage/v1',
    policy:'single captured donor hydrogen; identical typed donor, mapped heavy neighborhood and current local geometry',
    preserved,skipped};
}
