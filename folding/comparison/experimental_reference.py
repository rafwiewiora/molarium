"""Freeze crystal references and score sequence/SMILES-only cofolding runs.

All deposited protein residues enter inference; only observed corresponding C-alpha
atoms enter the protein fit. No binding-site fit or independent ligand fit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import time
import numpy as np
from biotite.structure.io import pdbx
from biotite.sequence import ProteinSequence
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from pose_metrics import component_mol, pdb_atoms, ligand_mol, fit_proteins, contacts

CASES=[('3mxf-jq1','3MXF','JQ1','A','B','BRD4–JQ1'),
       ('1fkf-fk5','1FKF','FK5','A','B','FKBP12–FK506 (deposited FK5)'),
       ('181l-bnz','181L','BNZ','A','E','T4 lysozyme–benzene')]

def sha(b):return hashlib.sha256(b).hexdigest()
def save(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def strings(category,key):return category[key].as_array(str)

def stereo_diagnostic(molecule):
    expected={i:s for i,s in Chem.FindMolChiralCenters(molecule,includeUnassigned=False)}
    if not expected:return {'specifiedTetrahedralCenters':0,'mismatchedCenters':[],'unassignedCenters':[]}
    measured=Chem.Mol(molecule)
    Chem.AssignStereochemistryFrom3D(measured,replaceExistingTags=True)
    Chem.AssignStereochemistry(measured,cleanIt=True,force=True)
    observed=dict(Chem.FindMolChiralCenters(measured,includeUnassigned=True))
    return {'specifiedTetrahedralCenters':len(expected),
      'mismatchedCenters':[{'smilesAtomIndex':i,'expected':s,'observed':observed[i]}for i,s in expected.items()if observed.get(i)not in [None,'?',s]],
      'unassignedCenters':[i for i in expected if observed.get(i)in [None,'?']]}

def reference(source,pdb_id,ccd_id,protein_chain,ligand_chain):
    cif=pdbx.CIFFile.read(source/(pdb_id+'.cif')).block
    ccd=pdbx.CIFFile.read(source/(ccd_id+'.cif')).block
    asym=cif['struct_asym'];entity=dict(zip(strings(asym,'id'),strings(asym,'entity_id')))[protein_chain]
    poly=cif['entity_poly'];sequence=''.join(strings(poly,'pdbx_seq_one_letter_code_can')[list(strings(poly,'entity_id')).index(entity)].split())
    if any(a not in 'ACDEFGHIKLMNPQRSTVWY'for a in sequence):raise ValueError('Nonstandard sequence requires explicit policy')
    desc=ccd['pdbx_chem_comp_descriptor']
    descriptors=[dict(zip(desc,values))for values in zip(*(strings(desc,k)for k in desc))]
    descriptor=next(d for d in descriptors if d['type']=='SMILES_CANONICAL'and d['program']=='OpenEye OEToolkits')
    smiles=descriptor['descriptor'];template=Chem.MolFromSmiles(smiles)
    if template is None:raise ValueError('Invalid CCD stereochemical SMILES')
    atom=ccd['chem_comp_atom'];names=list(strings(atom,'atom_id'));elements=list(strings(atom,'type_symbol'))
    heavy=[i for i,e in enumerate(elements)if e.upper()not in ['H','D']]
    by_name={names[i]:j for j,i in enumerate(heavy)}
    if len(by_name)!=template.GetNumAtoms():raise ValueError('CCD heavy atom count mismatch')
    graph=Chem.RWMol();hydrogens={n:0 for n in by_name};bond=ccd['chem_comp_bond']
    for a,b in zip(strings(bond,'atom_id_1'),strings(bond,'atom_id_2')):
        if a in hydrogens and b not in by_name:hydrogens[a]+=1
        if b in hydrogens and a not in by_name:hydrogens[b]+=1
    for i in heavy:
        a=Chem.Atom(elements[i].title());a.SetFormalCharge(int(strings(atom,'charge')[i]));a.SetNumExplicitHs(hydrogens[names[i]]);a.SetNoImplicit(True);graph.AddAtom(a)
    types={'SING':Chem.BondType.SINGLE,'DOUB':Chem.BondType.DOUBLE,'TRIP':Chem.BondType.TRIPLE,'AROM':Chem.BondType.AROMATIC}
    for a,b,o in zip(strings(bond,'atom_id_1'),strings(bond,'atom_id_2'),strings(bond,'value_order')):
        if a in by_name and b in by_name:graph.AddBond(by_name[a],by_name[b],types[o])
    graph=graph.GetMol();Chem.SanitizeMol(graph)
    match=graph.GetSubstructMatch(template,useChirality=False)
    if len(match)!=len(heavy)or graph.GetNumBonds()!=template.GetNumBonds():raise ValueError('CCD graph differs from SMILES')
    rows=cif['atom_site'];columns={k:strings(rows,k)for k in rows};selected={}
    # Highest occupancy per atom; lexical alternate ID breaks ties deterministically.
    for i in range(len(columns['id'])):
        if columns['pdbx_PDB_model_num'][i]!='1'or columns['type_symbol'][i].upper()in ['H','D']:continue
        chain=columns['label_asym_id'][i]
        if chain not in [protein_chain,ligand_chain]:continue
        if chain==ligand_chain and columns['label_comp_id'][i]!=ccd_id:raise ValueError('Unexpected ligand instance')
        key=(chain,columns['label_seq_id'][i],columns['label_atom_id'][i])
        rank=(-float(columns['occupancy'][i]),columns['label_alt_id'][i])
        if key not in selected or rank<selected[key][0]:selected[key]=(rank,i)
    indices=sorted(v[1]for v in selected.values());ligand={columns['label_atom_id'][i]:i for i in indices if columns['label_asym_id'][i]==ligand_chain}
    if set(ligand)!=set(by_name):raise ValueError('Incomplete/mismatched crystal ligand atoms')
    coords=lambda i:[float(columns[k][i])for k in ['Cartn_x','Cartn_y','Cartn_z']]
    component={'code':ccd_id,'smiles':smiles,'atoms':[],'bonds':[],
      'chemistrySource':'Exact CCD atom names, bonds and canonical isomeric SMILES; observed crystal coordinates.'}
    for j,i in enumerate(heavy):
        a=graph.GetAtomWithIdx(j);x,y,z=coords(ligand[names[i]])
        component['atoms'].append({'name':names[i],'element':a.GetAtomicNum(),'charge':a.GetFormalCharge(),
          'explicitHs':a.GetNumExplicitHs(),'x':x,'y':y,'z':z})
    for b in graph.GetBonds():component['bonds'].append({'from':b.GetBeginAtomIdx(),'to':b.GetEndAtomIdx(),'order':4 if b.GetIsAromatic()else int(b.GetBondTypeAsDouble())})
    lines=[];residues=[]
    for i in indices:
        protein=columns['label_asym_id'][i]==protein_chain
        residue=int(columns['label_seq_id'][i])if protein else 1
        name=columns['label_atom_id'][i];resname=columns['label_comp_id'][i]if protein else 'LIG'
        if protein:
            if ProteinSequence.convert_letter_3to1(resname)!=sequence[residue-1]:raise ValueError('Crystal residue mapping differs from deposited sequence')
            if name=='CA':residues.append({'sequenceIndex':residue,'authSeqId':columns['auth_seq_id'][i],
              'authChainId':columns['auth_asym_id'][i],'insertionCode':columns['pdbx_PDB_ins_code'][i],'resName':resname})
        lines.append(f'{"ATOM  "if protein else"HETATM"}{len(lines)+1:5d} {name:>4s} {resname:3s} {"A"if protein else"B"}{residue:4d}    '+
          ''.join(f'{v:8.3f}'for v in coords(i))+f'  1.00{float(columns["B_iso_or_equiv"][i]):6.2f}          {columns["type_symbol"][i].upper():>2s}')
    result={'pdb':'\n'.join(lines)+'\nEND\n','component':component,'sequence':sequence}
    component_mol(component)
    # The score of the reference against itself checks atom-name/graph consistency.
    mol=ligand_mol(result,pdb_atoms(result['pdb']),smiles)
    if abs(rdMolAlign.CalcRMS(mol,mol))>1e-8:raise ValueError('Reference identity check failed')
    return {'sequence':sequence,'smiles':smiles,'descriptor':descriptor,'observedResidues':residues,
      'ligandHeavyAtoms':len(heavy),'formalCharge':Chem.GetFormalCharge(template),'result':result,'stereochemistry':stereo_diagnostic(mol),
      'resolutionA':float(strings(cif['refine'],'ls_d_res_high')[0]),
      'selection':{'proteinLabelAsymId':protein_chain,'ligandLabelAsymId':ligand_chain,
        'alternatePolicy':'Highest occupancy per atom, then lexical alternate ID; model 1.',
        'omitted':'Other chains, waters, salts, crystallization additives and assembly mates are excluded.'}}

def prepare(sources,out):
    out.mkdir();(out/'sources').mkdir()
    source_records=[]
    for name in [x+'.cif'for x in ['3MXF','1FKF','181L','JQ1','FK5','BNZ']]:
        data=(sources/name).read_bytes();(out/'sources'/name).write_bytes(data)
        source_records.append({'file':'sources/'+name,'sha256':sha(data),'url':'https://files.rcsb.org/'+('download/'if name[:4]in ['3MXF','1FKF','181L']else'ligands/download/')+name})
    cases=[]
    for id,pdb_id,ccd,protein,ligand,name in CASES:
        r=reference(out/'sources',pdb_id,ccd,protein,ligand)
        d=out/id;d.mkdir();save(d/'reference.json',r);(d/'reference.pdb').write_text(r['result']['pdb'])
        cases.append({'id':id,'name':name,'pdbId':pdb_id,'ccdId':ccd,'sequence':r['sequence'],'smiles':r['smiles'],
          'referenceFile':id+'/reference.json','referenceSha256':sha((d/'reference.json').read_bytes()),
          'resolutionA':r['resolutionA'],'observedCa':len(r['observedResidues']),'proteinResidues':len(r['sequence']),
          'ligandHeavyAtoms':r['ligandHeavyAtoms'],'formalCharge':r['formalCharge']})
    panel={'schema':'molarium.experimental-cofold-panel.v1','createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
      'purpose':'Small retrospective crystal-pose reconstruction check; panel chosen before predictions.',
      'seeds':[0,1,2],'cases':cases,'sources':source_records,
      'browserProtocol':{'steps':25,'recycles':2,'msaMode':'single','weights':'int5'},
      'nativeProtocol':{'steps':200,'recycles':3,'msaMode':'single'},
      'caveats':['These old structures may be in model training sets; this is not a held-out or prospective benchmark.',
        'One deposited protein chain and exact CCD ligand chemical state; no crystal coordinates, templates or MSA enter inference.',
        'Single-chain tasks omit assembly partners, crystal mates, waters and other additives.',
        'Browser uses quantized weights and different sampling/RNG; native uses higher sampling effort. This is not fixed-input numerical parity.',
        'Primary ligand RMSD uses all observed matching protein C-alpha atoms, without trimming, pocket refitting or independent ligand alignment.',
        'Report every seed, seed0, median and oracle best-of3 separately; best-of3 uses the experimental answer and is not prospective selection.']}
    save(out/'panel.json',panel);print(json.dumps({'cases':cases,'output':str(out)},ensure_ascii=False))

def score(panel_path,libraries,out):
    root=panel_path.parent;panel=json.loads(panel_path.read_text());records=[];seen=set()
    for label,file in libraries:
        bundle=json.loads(file.read_text());sequence=bundle['run']['request']['sequence']
        matches=[c for c in panel['cases']if c['sequence']==sequence]
        if len(matches)!=1:raise ValueError('Library does not match exactly one experimental sequence')
        c=matches[0]
        if (c['id'],label)in seen:raise ValueError('Duplicate case/method library')
        seen.add((c['id'],label));ref_path=root/c['referenceFile']
        if sha(ref_path.read_bytes())!=c['referenceSha256']:raise ValueError('Reference hash mismatch')
        ref=json.loads(ref_path.read_text());reference_result=ref['result'];ref_atoms=pdb_atoms(reference_result['pdb'])
        observed={r['sequenceIndex']for r in ref['observedResidues']}
        poses=bundle['poses']
        if len(poses)!=len(panel['seeds'])or sorted(p['seed']for p in poses)!=panel['seeds']:raise ValueError('Incomplete or duplicate prediction seed set')
        if len(bundle['run']['compounds'])!=1 or bundle['run']['compounds'][0]['smiles']!=c['smiles']:raise ValueError('Ligand input chemical state differs from reference declaration')
        for p in poses:
            if p['status']!='complete':
                records.append({'caseId':c['id'],'method':label,'seed':p['seed'],'status':p['status'],'error':p.get('error')});continue
            result=p['result']
            if result.get('sequence')!=sequence:raise ValueError('Result sequence differs from library declaration')
            expected_hash=result.get('provenance',{}).get('outputPdbSha256')
            if expected_hash and sha(result['pdb'].encode())!=expected_hash:raise ValueError('Prediction coordinate hash mismatch')
            pred_atoms=pdb_atoms(result['pdb'])
            all_ca=[a for a in pred_atoms if a['record']=='ATOM'and a['name']=='CA']
            if len(all_ca)!=len(sequence):raise ValueError('Prediction is missing declared protein residues')
            filtered=[a for a in pred_atoms if a['record']!='ATOM'or int(a['residue'])in observed]
            transform,ca_rmsd=fit_proteins(ref_atoms,filtered)
            a=ligand_mol(reference_result,ref_atoms,c['smiles']);b=ligand_mol(result,pred_atoms,c['smiles'],transform)
            rmsd=float(rdMolAlign.CalcRMS(b,a,maxMatches=1000000,symmetrizeConjugatedTerminalGroups=True))
            rc,rg=contacts(ref_atoms);pc,pg=contacts(filtered);union=rc|pc
            records.append({'caseId':c['id'],'method':label,'seed':p['seed'],'status':'complete',
              'proteinCaRmsdA':ca_rmsd,'alignedCa':len(observed),'ligandRmsdA':rmsd,'within2A':rmsd<=2.0,
              'ligandCentroidDisplacementA':float(np.linalg.norm(a.GetConformer().GetPositions().mean(0)-b.GetConformer().GetPositions().mean(0))),
              'contactResidueJaccard':len(rc&pc)/len(union)if union else None,'referenceGeometry':rg,'predictedGeometry':pg,
              'meanPlddt':result.get('meanPlddt'),'iptm':result.get('iptm'),'stereochemistry':stereo_diagnostic(b),
              'sourceLibrarySha256':sha(file.read_bytes()),'outputPdbSha256':sha(result['pdb'].encode())})
    summary=[]
    for case,method in sorted({(r['caseId'],r['method'])for r in records}):
        group=[r for r in records if r['caseId']==case and r['method']==method];done=[r for r in group if r['status']=='complete']
        if done:
            seed0=next((r for r in done if r['seed']==0),None)
            confidence=[r for r in done if isinstance(r.get('iptm'),(int,float))and np.isfinite(r['iptm'])]
            ranked=max(confidence,key=lambda r:(r['iptm'],-r['seed']))if confidence else None
            summary.append({'caseId':case,'method':method,'complete':len(done),'failed':len(group)-len(done),
              'seed0LigandRmsdA':seed0['ligandRmsdA']if seed0 else None,'medianLigandRmsdA':float(np.median([r['ligandRmsdA']for r in done])),
              'oracleBestOf3LigandRmsdA':min(r['ligandRmsdA']for r in done),
              'highestIptmSeed':ranked['seed']if ranked else None,'highestIptmLigandRmsdA':ranked['ligandRmsdA']if ranked else None,
              'posesWithin2A':sum(r['within2A']for r in done),'medianProteinCaRmsdA':float(np.median([r['proteinCaRmsdA']for r in done]))})
    report={'schema':'molarium.experimental-cofold-scores.v1','panelSha256':sha(panel_path.read_bytes()),
      'analysisScripts':{p.name:sha(p.read_bytes())for p in [Path(__file__),Path(__file__).with_name('pose_metrics.py')]},
      'definitions':{'alignment':'All observed corresponding protein C-alpha atoms, no trimming/core/pocket refit; transform moves whole prediction.',
        'ligand':'Symmetry-aware heavy-atom RMSD in aligned protein frame; no independent ligand alignment.',
        'successThresholdA':2.0,'oracle':'Best of three uses the crystal answer and is reported separately from seed0.'},
      'environment':{'python':platform.python_version(),'numpy':np.__version__,'rdkit':Chem.rdBase.rdkitVersion},
      'summary':summary,'poses':records,'caveats':panel['caveats']}
    save(out,report);print(json.dumps(summary,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    q=sub.add_parser('prepare');q.add_argument('--sources',type=Path,required=True);q.add_argument('--output',type=Path,required=True)
    q=sub.add_parser('score');q.add_argument('--panel',type=Path,required=True);q.add_argument('--library',action='append',required=True);q.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.command=='prepare':prepare(a.sources,a.output)
    else:score(a.panel,[(label,Path(file))for label,file in (x.split('=',1)for x in a.library)],a.output)
