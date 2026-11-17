// Least-squares rigid alignment on corresponding protein C-alpha atoms.
// The resulting transform moves the whole complex, never the ligand alone.
function anchors(pdb) {
  const out = new Map();
  for (const l of pdb.split(/\r?\n/)) if (l.startsWith('ATOM  ') && l.slice(12,16).trim() === 'CA') {
    const xyz = [30,38,46].map(i => Number(l.slice(i,i+8)));
    if (xyz.every(Number.isFinite)) out.set(l.slice(21,27),xyz);
  }
  return out;
}
export function alignComplexPdb(pdb, reference) {
  const a = anchors(pdb), b = anchors(reference), pairs = [...a].filter(([k]) => b.has(k)).map(([k,v]) => [v,b.get(k)]);
  if (pairs.length < 3) throw new Error('At least three matching protein C-alpha atoms are needed to align poses.');
  const center = side => [0,1,2].map(j => pairs.reduce((s,p) => s+p[side][j],0)/pairs.length);
  const ac = center(0), bc = center(1), s = Array.from({length:3},() => [0,0,0]);
  for (const [x,y] of pairs) for(let i=0;i<3;i++) for(let j=0;j<3;j++) s[i][j]+=(x[i]-ac[i])*(y[j]-bc[j]);
  const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]] = s;
  const n = [[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],
    [zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]];
  const v = Array.from({length:4},(_,i) => Array.from({length:4},(_,j) => +(i===j)));
  // Jacobi eigensolver avoids the sign ambiguity of power iteration.
  for(let iter=0;iter<80;iter++) {
    let p=0,q=1;
    for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) if(Math.abs(n[i][j])>Math.abs(n[p][q])) {p=i;q=j;}
    if(Math.abs(n[p][q])<1e-10) break;
    const phi=.5*Math.atan2(2*n[p][q],n[q][q]-n[p][p]), c=Math.cos(phi),t=Math.sin(phi);
    const pp=n[p][p],qq=n[q][q],pq=n[p][q];
    for(let k=0;k<4;k++) if(k!==p&&k!==q) {
      const kp=n[k][p],kq=n[k][q]; n[k][p]=n[p][k]=c*kp-t*kq; n[k][q]=n[q][k]=t*kp+c*kq;
    }
    n[p][p]=c*c*pp-2*c*t*pq+t*t*qq; n[q][q]=t*t*pp+2*c*t*pq+c*c*qq; n[p][q]=n[q][p]=0;
    for(let k=0;k<4;k++) {const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-t*kq;v[k][q]=t*kp+c*kq;}
  }
  const k = [0,1,2,3].reduce((a,b) => n[a][a]>n[b][b]?a:b), [w,x,y,z] = v.map(r => r[k]);
  const r = [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
    [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)], [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
  const apply = p => r.map((row,i) => row.reduce((s,c,j) => s+c*(p[j]-ac[j]),bc[i]));
  const rmsd = Math.sqrt(pairs.reduce((s,[p,q]) => s+apply(p).reduce((s,x,i) => s+(x-q[i])**2,0),0)/pairs.length);
  const aligned = pdb.split(/\r?\n/).map(l => {
    if(!/^(ATOM  |HETATM)/.test(l)) return l;
    const coords = apply([30,38,46].map(i => Number(l.slice(i,i+8))));
    if (!coords.every(Number.isFinite)) throw new Error('Invalid PDB coordinates.');
    const fields = coords.map(x => (Math.abs(x)<.0005?0:x).toFixed(3).padStart(8));
    if (fields.some(x => x.length>8)) throw new Error('Aligned coordinates exceed PDB field width.');
    return l.slice(0,30)+fields.join('')+l.slice(54);
  }).join('\n');
  return {pdb:aligned,rmsd,atoms:pairs.length};
}
