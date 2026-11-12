// Use the featurized graph, never infer ligand bonds from predicted distances.
export function ligandMol(result,pdb) {
  const c=result.component;if(!c?.atoms||!c?.bonds)throw new Error('Ligand chemical graph is missing from this pose.');
  const coords=new Map(pdb.split(/\r?\n/).filter(l=>l.startsWith('HETATM')&&l[21]==='B').map(l=>
    [l.slice(12,16).trim(),{xyz:[30,38,46].map(i=>Number(l.slice(i,i+8))),element:l.slice(76,78).trim()}]));
  const lines=['Cofold ligand','Foldarium','',`${String(c.atoms.length).padStart(3)}${String(c.bonds.length).padStart(3)}  0  0  0  0            999 V2000`];
  for(const a of c.atoms) {
    const record=coords.get(a.name);if(!record?.element)throw new Error('Ligand atom correspondence or element is missing.');
    lines.push(record.xyz.map(x=>x.toFixed(4).padStart(10)).join('')+` ${record.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for(const b of c.bonds) lines.push([b.from+1,b.to+1,b.order===1.5||b.order===4?4:b.order].map(x=>String(x).padStart(3)).join('')+'  0  0  0  0');
  for(let i=0;i<c.atoms.length;i++)if(c.atoms[i].charge)lines.push(`M  CHG  1${String(i+1).padStart(4)}${String(c.atoms[i].charge).padStart(4)}`);
  return lines.concat('M  END','$$$$').join('\n');
}
