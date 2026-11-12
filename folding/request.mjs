import {ELEMENT_SYMBOLS} from '../vendor/localfold/shared/af3/featurise/ccd-component.js';
export const LOCALFOLD_REVISION='5ea3d42c911949700401b54003cb28c557fcf2a6';
export const FOLD_MODELS=Object.freeze({
  'localfold-af2':'AlphaFold2 · LocalFold',
  'localfold-openbind0':'OpenBind-0 · protein + ligand',
  'localfold-boltz2':'Boltz-2 · protein + ligand',
  openfold:'OpenFold · legacy 128-residue export',
});
export const COFOLD_FAMILIES=Object.freeze({'localfold-openbind0':'openbind0','localfold-boltz2':'boltz2'});
export function foldingRequest(input) {
  if(String(input.sequence??'').split(/\r?\n/).filter(l=>l.trim().startsWith('>')).length>1)
    throw new Error('Provide one protein chain; multiple FASTA records are not supported yet.');
  const sequence=String(input.sequence??'').split(/\r?\n/).filter(l=>!l.trim().startsWith('>'))
    .join('').replace(/\s/g,'').toUpperCase();
  if(!sequence||!/^[ACDEFGHIKLMNPQRSTVWYX]+$/.test(sequence))
    throw new Error('Enter one protein sequence using standard amino acids or X.');
  if(sequence.length>20000)throw new Error('Sequence input exceeds 20,000 residues.');
  const model=input.model??'localfold-af2';
  if(!Object.hasOwn(FOLD_MODELS,model))throw new Error('Unknown folding model.');
  if(model==='openfold'&&sequence.length>128)throw new Error('Legacy OpenFold supports at most 128 residues.');
  const msaMode=input.msaMode??(input.msaEndpoint?'search':'single');
  if(!['single','search','provided'].includes(msaMode))throw new Error('Unknown alignment mode.');
  if(model==='openfold'&&msaMode==='single')throw new Error('Select MSA search or provide A3M for legacy OpenFold.');
  const msaEndpoint=input.msaEndpoint??'https://api.colabfold.com';
  if(msaMode==='search'&&new URL(msaEndpoint).protocol!=='https:')throw new Error('MSA search requires an HTTPS endpoint.');
  if(msaMode==='provided'&&(typeof input.a3m!=='string'||!input.a3m.trim().startsWith('>')))
    throw new Error('Provide a valid A3M alignment starting with its query header.');
  const recycles=input.recycles??2,steps=input.steps??25,seed=input.seed??0;
  if(!Number.isInteger(recycles)||recycles<0||recycles>20)throw new Error('Recycles must be an integer from 0 to 20.');
  if(!Number.isInteger(steps)||steps<1||steps>200)throw new Error('Sampling steps must be an integer from 1 to 200.');
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Seed must be an unsigned 32-bit integer.');
  let ligand=null;
  if(input.ligand){
    if(!Object.hasOwn(COFOLD_FAMILIES,model))throw new Error('Choose OpenBind-0 or Boltz-2 to cofold a ligand.');
    const {type,value}=input.ligand;
    if(!['smiles','ccd'].includes(type)||typeof value!=='string'||!value.trim())
      throw new Error('Ligand requires an explicit smiles or ccd type and value.');
    if(type==='ccd'&&!/^[A-Za-z0-9]{1,3}$/.test(value.trim()))
      throw new Error('This PDB importer supports CCD codes of 1–3 letters or digits.');
    if(value.length>10000)throw new Error('Ligand input is too long.');
    ligand={type,value:type==='ccd'?value.trim().toUpperCase():value.trim()};
  }
  return {schema:'molarium.fold-request.v2',sequence,model,msaMode,msaEndpoint,
    a3m:msaMode==='provided'?input.a3m:null,recycles,steps,seed,ligand};
}

// Restore explicit component chemistry by atom name, never by predicted distance.
export function installFoldLigand(molecule,component,chain='B') {
  if(!component)return;
  const indices=molecule.atoms.flatMap((atom,i)=>atom.chain===chain&&atom.record==='HETATM'?[i]:[]);
  const byName=new Map(indices.map(i=>[molecule.atoms[i].atomName,i]));
  if(indices.length!==component.atoms.length||byName.size!==indices.length)
    throw new Error('Predicted ligand atoms do not match the input component.');
  for(const atom of component.atoms){
    const i=byName.get(atom.name);if(i===undefined)throw new Error('Missing predicted ligand atom '+atom.name);
    if(molecule.atoms[i].element.toUpperCase()!==ELEMENT_SYMBOLS[atom.element-1])
      throw new Error('Predicted ligand element differs at '+atom.name);
    Object.assign(molecule.atoms[i],{charge:atom.charge??0,formalCharge:atom.charge??0,aromatic:false});
  }
  const ligandSet=new Set(indices);
  molecule.bonds=molecule.bonds.filter(b=>!ligandSet.has(b.a)&&!ligandSet.has(b.b));
  for(const bond of component.bonds){
    const a=byName.get(component.atoms[bond.from]?.name),b=byName.get(component.atoms[bond.to]?.name);
    if(a===undefined||b===undefined||a===b)throw new Error('Invalid ligand component bond.');
    const aromatic=bond.order===4||bond.order===1.5;
    if(aromatic){molecule.atoms[a].aromatic=true;molecule.atoms[b].aromatic=true;}
    molecule.bonds.push({a,b,order:aromatic?1.5:bond.order,aromatic,topology:'fold-input-component',
      distance:Math.hypot(...['x','y','z'].map(axis=>molecule.atoms[a][axis]-molecule.atoms[b][axis]))});
  }
}

export function validateFoldComponent(component){
  if(!component.atoms.length||component.atoms.length>150)
    throw new Error('This integration accepts 1–150 ligand heavy atoms.');
  const adjacency=component.atoms.map(()=>[]);
  for(const bond of component.bonds){
    if(!adjacency[bond.from]||!adjacency[bond.to])throw new Error('Invalid ligand connectivity.');
    adjacency[bond.from].push(bond.to);adjacency[bond.to].push(bond.from);
  }
  const seen=new Set([0]),pending=[0];
  while(pending.length)for(const neighbor of adjacency[pending.pop()]){
    if(!seen.has(neighbor)){seen.add(neighbor);pending.push(neighbor);}
  }
  if(seen.size!==component.atoms.length)throw new Error('Provide one connected ligand; separate salts are not supported yet.');
}
