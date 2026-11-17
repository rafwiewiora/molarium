// Portable, unscored cofolding libraries. This format never declares a pose correct.
export const LIBRARY_SCHEMA = 'foldarium.cofolding-library.v1';
export const DECISIONS = ['unreviewed', 'preferred', 'rejected'];
export function validateLibrary(bundle) {
  if (bundle?.schema !== LIBRARY_SCHEMA || !bundle.run || !Array.isArray(bundle.poses))
    throw new Error('Expected a Foldarium cofolding library v1.');
  const {run, poses} = bundle;
  if (typeof run.id !== 'string' || !run.id || typeof run.createdAt !== 'string' || !Number.isFinite(Date.parse(run.createdAt)) ||
      !Array.isArray(run.compounds) || !run.compounds.length ||
      run.compounds.length > 10000 || poses.length > 1000000)
    throw new Error('Invalid library identity or size.');
  const compounds = new Set();
  for (const c of run.compounds) {
    if (!c || typeof c.id !== 'string' || compounds.has(c.id) || typeof c.smiles !== 'string')
      throw new Error('Compound IDs must be unique and each compound needs SMILES.');
    compounds.add(c.id);
  }
  const ids = new Map();
  for (const p of poses) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || !compounds.has(p.compoundId) ||
        !['complete', 'failed', 'interrupted'].includes(p.status)) throw new Error('Invalid pose record.');
    if (p.status === 'complete' && (typeof p.result?.pdb !== 'string' ||
        !/^ATOM  /m.test(p.result.pdb) || !/^HETATM/m.test(p.result.pdb)))
      throw new Error('A completed pose needs its predicted protein and ligand PDB.');
    ids.set(p.id,p);
  }
  const decisions = bundle.decisions ?? [];
  if (!Array.isArray(decisions)) throw new Error('Invalid decisions.');
  const decisionIds=new Set(),none=new Set(),preferred=new Set();
  for (const d of decisions) {
    if (!d || typeof d.id!=='string' || !d.id || decisionIds.has(d.id) || !compounds.has(d.compoundId) ||
        (d.poseId ? !ids.has(d.poseId) || !DECISIONS.includes(d.value) ||
          ids.get(d.poseId)?.compoundId !== d.compoundId || ids.get(d.poseId)?.status!=='complete' : d.value !== 'none'))
      throw new Error('A selection must identify an exact pose or explicitly select none for a compound.');
    decisionIds.add(d.id);if(d.value==='none')none.add(d.compoundId);if(d.value==='preferred')preferred.add(d.compoundId);
  }
  if([...none].some(c=>preferred.has(c)))throw new Error('A compound cannot prefer a pose and select none simultaneously.');
  return bundle;
}
export function stringifyLibrary(bundle) {
  validateLibrary(bundle);
  return JSON.stringify(bundle, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value);
}
export function ligandConfidence(result) {
  const slots = result?.confidenceLayout?.pdbAtoms?.filter(a => a.chain === 'B').map(a => a.slot) ?? [];
  const values = slots.map(i => result.plddt?.[i]).filter(Number.isFinite);
  return values.length ? values.reduce((a,b) => a+b, 0)/values.length : null;
}
