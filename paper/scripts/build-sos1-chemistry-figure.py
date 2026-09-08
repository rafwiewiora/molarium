#!/usr/bin/env python3
"""Draw Figure 2 directly from frozen graphs/coordinates, without a science rerun.

Requires RDKit, numpy, and Pillow. No source screenshot is edited, no coordinates
are optimized/interpolated, and no later crystal contributes a coordinate.
"""
from pathlib import Path
import argparse, gzip, hashlib, io, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rdkit import Chem, rdBase
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'design-history/publications/sos1/designer-intent-2026-09-04'
NAVY = '#243747'
PURPLE = '#7350A2'
TEAL = '#087E8B'
GOLD = '#B77716'
GRAY = '#B8BDC6'
INK = '#273844'
ORANGE = (1.0, 0.81, 0.49)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def font(size, bold=False):
    name = 'Arial Bold.ttf' if bold else 'Arial.ttf'
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/' + name, size)

def load_states():
    release = json.loads((RELEASE / 'release.json').read_text())
    states = []
    for entry in release['checkpoints']:
        raw = (ROOT / entry['path']).read_bytes()
        assert digest(raw) == entry['sha256']
        uncompressed = gzip.decompress(raw) if entry.get('encoding') == 'gzip' else raw
        assert digest(uncompressed) == entry['canonicalSha256']
        campaign = json.loads(uncompressed)
        snapshot = campaign['objects']['snapshots'][entry['snapshotId']]
        atoms = {a['atomId']: a for a in snapshot['graph']['atoms']}
        coords = dict(zip(snapshot['coordinates']['atomIds'], snapshot['coordinates']['positions']))
        assert set(coords) == set(atoms)
        ligand = {key: a for key, a in atoms.items()
                  if a.get('record') == 'HETATM' and a.get('residueName') in {'AXE','AWT','AWZ','AWW','AXH'}}
        assert ligand
        code = next(iter(ligand.values()))['residueName']
        states.append(dict(stage=entry['id'], entry=entry, atoms=atoms, ligand=ligand,
                           coords={key: np.array(value) for key, value in coords.items()},
                           bonds=snapshot['graph']['bonds'], code=code))
    assert [s['code'] for s in states] == ['AXE','AWT','AWZ','AWW','AWW','AWW','AXH']
    return states

def rdkit_molecule(state):
    mol = Chem.RWMol()
    ids = {}
    for key, data in state['ligand'].items():
        atom = Chem.Atom(data['element'])
        atom.SetFormalCharge(data.get('formalCharge', 0))
        atom.SetIsAromatic(data.get('aromatic', False))
        atom.SetProp('sourceId', key)
        atom.SetProp('atomName', data['atomName'])
        ids[key] = mol.AddAtom(atom)
    for bond in state['bonds']:
        a, b = bond['atomIds']
        if a in ids and b in ids:
            kind = {1:Chem.BondType.SINGLE, 2:Chem.BondType.DOUBLE,
                    3:Chem.BondType.TRIPLE, 1.5:Chem.BondType.AROMATIC}[bond['order']]
            mol.AddBond(ids[a], ids[b], kind)
    mol = mol.GetMol()
    Chem.SanitizeMol(mol)
    conf = Chem.Conformer(mol.GetNumAtoms())
    conf.Set3D(True)
    for key, index in ids.items():
        conf.SetAtomPosition(index, state['coords'][key])
    mol.AddConformer(conf)
    Chem.AssignStereochemistryFrom3D(mol)
    mol = Chem.RemoveHs(mol)
    # Preserve graph identities and stereo; only the depiction gets 2D coordinates.
    rdDepictor.Compute2DCoords(mol)
    conf = mol.GetConformer()
    xy = np.array([[conf.GetAtomPosition(i).x, conf.GetAtomPosition(i).y]
                   for i in range(mol.GetNumAtoms())])
    xy -= xy.mean(axis=0)
    _, _, axes = np.linalg.svd(xy, full_matrices=False)
    rotated = xy @ axes.T
    rotated = rotated[:, [1, 0]]  # long molecular axis vertical
    anchor = next(a.GetIdx() for a in mol.GetAtoms() if a.GetProp('atomName') == 'N6')
    if rotated[anchor, 1] < 0:
        rotated[:, 1] *= -1
        rotated[:, 0] *= -1  # proper rotation, not a mirror of stereochemistry
    for i, p in enumerate(rotated):
        conf.SetAtomPosition(i, (float(p[0]), float(p[1]), 0.0))
    # Swapping projection axes reflects the diagram. RDKit sets the wedge from
    # the stored chiral tag during PrepareAndDrawMolecule, retaining the isomer.
    return mol

def depict(state, previous, width, height, reference):
    mol = rdkit_molecule(state)
    if previous:
        ref_atoms = {a.GetProp('atomName'): a.GetIdx() for a in reference.GetAtoms()}
        new_atoms = {a.GetProp('atomName'): a.GetIdx() for a in mol.GetAtoms()}
        core = ['C1','C2','N6','C11','N8','C3','N7','C12','C16']
        rdDepictor.GenerateDepictionMatching2DStructure(mol, reference,
            [(ref_atoms[n],new_atoms[n]) for n in core])
    prior = set(previous['ligand']) if previous else set(state['ligand'])
    added = [a.GetIdx() for a in mol.GetAtoms() if a.GetProp('sourceId') not in prior]
    changed = [b.GetIdx() for b in mol.GetBonds()
               if b.GetBeginAtomIdx() in added or b.GetEndAtomIdx() in added]
    renderer = rdMolDraw2D.MolDraw2DCairo(width, height)
    options = renderer.drawOptions()
    options.padding = 0.10
    options.fixedFontSize = 36
    options.bondLineWidth = 3.1
    options.highlightBondWidthMultiplier = 8
    options.highlightRadius = .27
    options.setAtomPalette({6:(.16,.20,.24),7:(.15,.30,.73),8:(.76,.18,.20),16:(.63,.47,.08)})
    rdMolDraw2D.PrepareAndDrawMolecule(renderer, mol, highlightAtoms=added,
        highlightBonds=changed, highlightAtomColors={i:ORANGE for i in added},
        highlightBondColors={i:ORANGE for i in changed})
    renderer.FinishDrawing()
    return Image.open(io.BytesIO(renderer.GetDrawingText())).convert('RGB'), {
        'state': state['code'], 'isomericSmiles': Chem.MolToSmiles(mol),
        'heavyAtoms': mol.GetNumAtoms(),
        'highlightedAtomIds': [mol.GetAtomWithIdx(i).GetProp('sourceId') for i in added],
        'highlightMeaning': 'outside the registered atom-lineage conserved subgraph relative to the preceding chemical graph'}

def arrow(draw, start, end, color, width=6, head=20):
    a, b = np.array(start, dtype=float), np.array(end, dtype=float)
    vec = b-a
    if np.linalg.norm(vec) < 1:
        return
    v = vec/np.linalg.norm(vec)
    normal = np.array([-v[1], v[0]])
    draw.line([tuple(a), tuple(b)], fill=color, width=width)
    draw.polygon([tuple(b), tuple(b-head*v+head*.48*normal),
                  tuple(b-head*v-head*.48*normal)], fill=color)

def dashed(draw, a, b, color, width=5, step=17):
    a,b = np.array(a),np.array(b)
    length = np.linalg.norm(b-a)
    if length < 1:
        return
    for t in np.arange(0, length, step*2):
        draw.line([tuple(a+(b-a)*t/length), tuple(a+(b-a)*min(t+step,length)/length)],
                  fill=color, width=width)

def atom_id(state, name, residue=None):
    matches = [key for key, a in state['atoms'].items()
               if a.get('atomName') == name and
               (a.get('residueIndex') == residue if residue else key in state['ligand'])]
    assert len(matches) == 1, (name,residue,len(matches))
    return matches[0]

def heavy_ligand(state):
    return {key for key,a in state['ligand'].items() if a['element'] != 'H'}

def molecular_panel(states, mode, width, height, basis, bounds):
    canvas = Image.new('RGB', (width,height), 'white')
    draw = ImageDraw.Draw(canvas)
    left, right, bottom, top = bounds
    scale = min((width-130)/(right-left), (height-155)/(top-bottom))
    def point(state, key):
        p = state['coords'][key] @ basis
        return np.array([width/2 + (p[0]-(left+right)/2)*scale,
                         height/2 + 10 - (p[1]-(top+bottom)/2)*scale])
    def draw_state(state, ids, carbon=PURPLE, ghost=False, halo=None):
        if halo:
            for bond in state['bonds']:
                a,b = bond['atomIds']
                if a in halo and b in halo:
                    draw.line([tuple(point(state,a)),tuple(point(state,b))],fill='#BDE9E3',width=25)
        bonds = [b for b in state['bonds'] if all(k in ids for k in b['atomIds'])]
        bonds.sort(key=lambda b: sum(float(state['coords'][k] @ np.cross(basis[:,0],basis[:,1])) for k in b['atomIds']))
        for bond in bonds:
            a,b = bond['atomIds']
            if ghost:
                dashed(draw, point(state,a),point(state,b),GRAY,5,10)
            else:
                draw.line([tuple(point(state,a)),tuple(point(state,b))], fill=carbon, width=8)
        if not ghost:
            for key in ids:
                a = state['atoms'][key]
                x,y = point(state,key)
                color = {'N':'#4567BA','O':'#C94445','S':'#BC981C'}.get(a['element'],carbon)
                draw.ellipse((x-7,y-7,x+7,y+7),fill=color,outline='white',width=1)
    if mode == 'placement':
        before,current = states[3],states[4]
        moved = {key for key in heavy_ligand(current)
                 if np.linalg.norm(current['coords'][key]-before['coords'][key]) > .05}
        draw_state(before,moved,ghost=True)
        draw_state(current,heavy_ligand(current))
        a,b = atom_id(current,'C12'),atom_id(current,'C15')
        draw.line([tuple(point(current,a)),tuple(point(current,b))],fill=TEAL,width=15)
        # Two endpoint positions and an arrow annotate a change, not a trajectory.
        old,new = point(before,atom_id(before,'OX3')),point(current,atom_id(current,'OX3'))
        arrow(draw,old,new,TEAL,5,17)
        draw.text((28,20),'Same AWW graph',font=font(31,True),fill=INK)
        draw.text((28,height-58),'C12-C15 rotation: +150 degrees',font=font(30),fill=TEAL)
    elif mode == 'receptor':
        before,current = states[4],states[5]
        ligand = heavy_ligand(current)
        assert all(np.array_equal(before['coords'][k],current['coords'][k]) for k in ligand)
        phe = {key for key,a in current['atoms'].items() if a.get('residueIndex')==890 and a['element']!='H'}
        draw_state(before,phe,ghost=True)
        draw_state(current,ligand)
        draw_state(current,phe,carbon=GOLD)
        old = np.mean([point(before,k) for k in phe if before['atoms'][k]['atomName'] in {'CG','CD1','CD2','CE1','CE2','CZ'}],axis=0)
        new = np.mean([point(current,k) for k in phe if current['atoms'][k]['atomName'] in {'CG','CD1','CD2','CE1','CE2','CZ'}],axis=0)
        arrow(draw,old,new,GOLD,5,17)
        draw.text((28,20),'Ligand coordinates fixed',font=font(31,True),fill=INK)
        draw.text((28,height-58),'Phe890: 13 trials, 2 clash-free',font=font(30),fill=GOLD)
    else:
        before,current = states[5],states[6]
        route = json.loads((ROOT/'design-history/structures/generated/sos1-prospective-campaign.json').read_text())
        step = route['steps'][-1]
        feature = step['posePropagationMap']['spatialFeatureCorrespondences'][0]
        prior_feature = {atom_id(before,n) for n in feature['referenceAtomNames']}
        product_feature = {atom_id(current,step['productAtomNames'][i]) for i in feature['productAtomIndices']}
        assert len(prior_feature)==len(product_feature)==7
        draw_state(before,prior_feature,ghost=True)
        draw_state(current,heavy_ligand(current),halo=product_feature)
        draw.text((28,20),'BAY-293: retain the distal feature',font=font(31,True),fill=INK)
        draw.text((28,height-58),'Seven-atom feature RMSD: 1.529 A',font=font(30),fill=TEAL)
    if mode in {'placement','receptor'}:
        tyr = {atom_id(current,n,884) for n in ['CA','C','O']}
        draw_state(current,tyr,carbon='#7D8A93')
        oxy = point(current,atom_id(current,'O',884))
        donor = point(current,atom_id(current,'OX3'))
        dashed(draw,donor,oxy,TEAL,5,12)
        labelx, labely = width-365, 65
        draw.text((labelx,labely),'Tyr884 backbone O',font=font(29),fill=TEAL)
        draw.line([(labelx+20,labely+38),tuple(oxy)],fill=TEAL,width=2)
    return canvas

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    states=load_states()
    W,H=3200,1940
    canvas=Image.new('RGB',(W,H),'white')
    draw=ImageDraw.Draw(canvas)
    draw.text((65,35),'CHEMICAL GRAPH EDITS',font=font(43,True),fill=NAVY)
    draw.rounded_rectangle((1990,35,2035,70),radius=7,fill='#FFCF7D')
    draw.text((2052,35),'Rewritten regions (registered atom lineage)',font=font(30),fill=INK)
    row=[states[i] for i in [0,1,2,3,6]]
    titles=['AXE | starting hit','AWT | scaffold rewrite','AWZ | fragment merge',
            'AWW | alcohol arm','BAY-293 (AXH)']
    notes=[['Starting naphthyl group'],
           ['Naphthyl to pyrazolylphenyl','Add the 2-methyl group'],
           ['Phenyl to thiophene','Merge the bicyclic heterocycle'],
           ['Install the benzyl alcohol','Change to a 5,8-dihydro core'],
           ['Move the thiophene attachment','Alcohol to N-methylamine','Restore the aromatic core']]
    records=[]
    reference = rdkit_molecule(row[0])
    for i,state in enumerate(row):
        x=65+i*622
        draw.text((x,105),chr(65+i),font=font(46,True),fill=NAVY)
        draw.text((x+54,115),titles[i],font=font(32,True),fill=INK)
        depiction,record=depict(state,row[i-1] if i else None,580,650,reference)
        canvas.paste(depiction,(x,170))
        records.append(record)
        for n,line in enumerate(notes[i]):
            draw.text((x+8,838+n*40),line,font=font(30),fill=INK)
        if i<4:
            arrow(draw,(x+570,490),(x+610,490),NAVY,5,17)
    draw.line([(65,994),(3135,994)],fill='#D4DCE1',width=3)
    draw.text((65,1021),'POSE AND POCKET OPERATIONS',font=font(43,True),fill=NAVY)
    draw.line([(2010,1042),(2060,1042)],fill=PURPLE,width=8)
    draw.text((2075,1024),'Current ligand',font=font(29),fill=INK)
    dashed(draw,(2540,1042),(2590,1042),GRAY,5,10)
    draw.text((2605,1024),'Previous positions',font=font(29),fill=INK)
    # One projection and scale for all three details, computed from the same
    # frozen ligand/receptor coordinates; no per-panel molecular superposition.
    xyz=[]
    for s in states[3:]:
        ids=heavy_ligand(s)|{k for k,a in s['atoms'].items()
             if a.get('residueIndex') in {884,890} and a.get('atomName') in {'CA','C','O','CG','CD1','CD2','CE1','CE2','CZ'}}
        xyz.extend(s['coords'][key] for key in sorted(ids))
    xyz=np.array(xyz)
    _,_,axes=np.linalg.svd(xyz-xyz.mean(axis=0),full_matrices=False)
    basis=axes[:2].T
    # Reproducible sign convention, invariant to LAPACK eigenvector signs.
    for column in range(2):
        if basis[np.argmax(np.abs(basis[:,column])),column]<0: basis[:,column]*=-1
    projected=xyz@basis
    bounds=[float(projected[:,0].min()-1),float(projected[:,0].max()+1),
            float(projected[:,1].min()-1),float(projected[:,1].max()+1)]
    for i,(mode,title) in enumerate([('placement','Place the arm'),('receptor','Test the pocket response'),('retention','Retain a feature, not an exact pose')]):
        x=65+i*1040
        draw.text((x,1110),chr(70+i),font=font(46,True),fill=NAVY)
        draw.text((x+58,1121),title,font=font(33,True),fill=INK)
        panel=molecular_panel(states,mode,1000,660,basis,bounds)
        canvas.paste(panel,(x,1180))
    draw.text((65,1884),'3D details use frozen checkpoint coordinates. Arrows connect endpoint states; they are not simulated paths.',font=font(30),fill='#58656D')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    canvas.save(args.output,optimize=True,dpi=(450,450))
    provenance={
        'schema':'molarium.paper-chemistry-figure/v1','figureSha256':digest(args.output.read_bytes()),
        'builderSha256':digest(Path(__file__).read_bytes()), 'rdkitVersion':rdBase.rdkitVersion,
        'sourceReleaseSha256':digest((RELEASE/'release.json').read_bytes()),
        'graphDepictions':records,'checkpointSources':[s['entry'] for s in states],
        'projectionBasis':basis.tolist(),'projectionBounds':bounds,
        'policy':'Graph-derived 2D depictions and fixed-projection frozen-coordinate details; no image synthesis, molecular optimization, coordinate interpolation, or independent ligand fitting.',
        'chemicalIdentityCheck':'AWW 5,8-dihydro bond pattern also checked against https://files.rcsb.org/ligands/download/AWW.cif; its coordinates were not used.',
        'panelMapping':{'A':'starting-hit','B':'scaffold-rewrite','C':'fragment-merge','D':'aww-graph','E':'finish-bay-293',
                        'F':['aww-graph','aww-designer-intent'],'G':['aww-designer-intent','aww-phe890-response'],
                        'H':['aww-phe890-response','finish-bay-293']}}
    args.output.with_suffix('.provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    print(args.output)
    print(json.dumps([{'state':r['state'],'heavyAtoms':r['heavyAtoms'],'smiles':r['isomericSmiles'],'highlightedAtoms':len(r['highlightedAtomIds'])} for r in records],indent=2))

if __name__=='__main__': main()
