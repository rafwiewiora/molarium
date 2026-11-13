"""Drug-like, target-diverse recent-release selection fixed before prediction.

Foldarium-inspired artifact exclusions are extended with explicit RDKit property
gates/QED ranking and single-chain coordinate-quality checks. Not a claim of
pharmacological suitability or a reproduction of Foldarium's largest-ligand rule.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import time
import numpy as np
from rdkit import Chem,rdBase
from rdkit.Chem import QED,Descriptors,Lipinski,Crippen
from biotite.structure.io import pdbx
from biotite.sequence import ProteinSequence
from biotite.sequence.align import align_optimal,SubstitutionMatrix,get_sequence_identity
from experimental_reference import reference,sha,save,strings

# Component IDs are factual identifiers. Policy source is MIT-licensed Foldarium:
# b73ac80d9354dc0f323d7fb54d128f8c1ac0cb8e, pipeline/.../selection.py
# sha256 6648cf02ed4f1c6e840147c63bc319222c5a3d255b2cc5454992d13c47131c27.
ARTIFACTS=set(('HOH DOD NA CL MG ZN CA K MN FE FE2 FE3 CU CU1 NI CO CD HG CS BA SR BR '
 'IOD I RB LI PB PT AU AG TL SM GD YB EU MO W V SE F ZN2 3CO 4MO OH O OXY '
 'SO4 PO4 PI NO3 ACT EDO GOL PEG PG4 PGE 1PE 2PE P6G MPD DMS BME MES EPE '
 'TRS TAR CIT FLC FMT IPA BO3 NH4 AZI CAC MLA OXL SCN 144 15P PE4 PEU DIO '
 'SIN MLI BCT CO3 UNX UNL UNK BU3 MRD IMD POL PGO PG0 12P 7PE DTT DTV TLA '
 'SUC NAG MAN BMA FUC GAL GLC NDG BGC FUL XYS RAM SIA NGA A2G GLA XYP GCU '
 'ADA RIB API MAL TRE LMT LMN DGD SGN BOG NAD NAP NDP NAI NAJ FAD FMN FDA '
 'ATP ADP AMP ANP ACP AGS APC GTP GDP GNP GSP GMP CTP UTP UDP UMP TTP TMP '
 'COA ACO SAM SAH SFG HEM HEC HEA HEB DHE HAS PLP PMP TPP TDP BTI BTN B12 '
 'COB H4B BH4 MGD PAP UD1 UPG 5GP PNS PLM CLR POV PTY CDL OLA OLB OLC STE '
 'MYR PEE PCW PC1 PEF LHG PGV PGW D10 DD9 HP6 Y01 HC3 PX4 3PE PEK PSC 17F '
 'PC7 PEV UND DAO LMG MC3 9PE PLC SPH CHS CHD EIC ARA HTG PX2 P4K TGL').split())
POLICY={'version':'molarium-recent-druglike/v2','window':{'from':'2026-10-16','to':'2026-11-13'},
 'maxCasesPerRelease':3,'seeds':[0,1,2],
 'chemistry':{'minHeavyAtoms':15,'maxHeavyAtoms':60,'minMW':150,'maxMW':650,'minQED':0.5,
  'minLogP':-1,'maxLogP':6,'maxHBD':5,'maxHBA':12,'maxRotatable':12,'maxAbsCharge':2,
  'elements':['B','C','N','O','F','P','S','Cl','Br','I','Se'],'connected':True,'atLeastOneRing':True},
 'structure':{'method':'X-RAY DIFFRACTION','maxResolutionA':2.5,'proteinPolymerEntities':1,
  'minProteinResidues':60,'maxProteinResidues':350,'minObservedCaFraction':0.9,
  'minContactResiduesAt4A':4,'otherProteinChainCutoffA':4.0,'otherNonwaterSpeciesCutoffA':3.0,
  'biologicalAssembly':'First deposited assembly containing the selected protein/ligand labels; include generated symmetry copies in neighbor checks.',
  'rejectExplicitCovalentLinks':True,'rejectProteinLigandHeavyDistanceUnderA':1.8},
 'diversity':{'sequenceIdentityCutoff':0.8,'minimumLengthRatio':0.8,
  'alignment':'Global BLOSUM62, affine gap penalties -10/-1, identity over shorter sequence'},
 'ranking':'Within each release date: descending RDKit QED, then ascending resolution, PDB ID, CCD ID. Skip near-duplicate protein sequences across the whole panel.',
 'browserProtocol':{'steps':25,'recycles':2,'msaMode':'single','weights':'int5'},
 'nativeProtocol':{'steps':200,'recycles':3,'msaMode':'single'},
 'foldariumPolicySource':{'revision':'b73ac80d9354dc0f323d7fb54d128f8c1ac0cb8e','file':'pipeline/src/foldarium_pipeline/selection.py',
  'sha256':'6648cf02ed4f1c6e840147c63bc319222c5a3d255b2cc5454992d13c47131c27'}}

def chem_properties(smiles,ccd):
    if ccd in ARTIFACTS:return None,'foldarium-artifact-component'
    if not smiles:return None,'missing-stereochemical-smiles'
    m=Chem.MolFromSmiles(smiles)
    if m is None:return None,'invalid-smiles'
    if len(Chem.GetMolFrags(m))!=1:return None,'disconnected-ligand'
    g=POLICY['chemistry']
    if any(a.GetSymbol()not in g['elements']for a in m.GetAtoms()):return None,'unsupported-or-metal-element'
    p={'heavyAtoms':m.GetNumHeavyAtoms(),'MW':Descriptors.MolWt(m),'QED':QED.qed(m),'logP':Crippen.MolLogP(m),
      'HBD':Lipinski.NumHDonors(m),'HBA':Lipinski.NumHAcceptors(m),'rotatable':Lipinski.NumRotatableBonds(m),
      'formalCharge':Chem.GetFormalCharge(m),'rings':Lipinski.RingCount(m)}
    for key,lo,hi in [('heavyAtoms',g['minHeavyAtoms'],g['maxHeavyAtoms']),('MW',g['minMW'],g['maxMW']),
      ('QED',g['minQED'],1),('logP',g['minLogP'],g['maxLogP']),('HBD',0,g['maxHBD']),
      ('HBA',0,g['maxHBA']),('rotatable',0,g['maxRotatable']),('formalCharge',-g['maxAbsCharge'],g['maxAbsCharge']),('rings',1,100)]:
        if not lo<=p[key]<=hi:return p,'property-gate:'+key
    return p,None

def rank(entries_path,out):
    entries=json.loads(entries_path.read_text());records=[];s=POLICY['structure']
    for e in entries:
        polymers=e.get('polymer_entities')or [];proteins=[p for p in polymers if p['entity_poly']['type']=='polypeptide(L)']
        reason=None;sequence=None;protein=None
        if len(polymers)!=1 or len(proteins)!=1:reason='requires-more-than-one-polymer-entity'
        else:
            protein=proteins[0];sequence=''.join(protein['entity_poly']['pdbx_seq_one_letter_code_can'].split())
            if not s['minProteinResidues']<=len(sequence)<=s['maxProteinResidues']:reason='protein-length-outside-initial-browser-panel'
            elif any(a not in 'ACDEFGHIKLMNPQRSTVWY'for a in sequence):reason='nonstandard-declared-sequence'
        resolution=min((e.get('rcsb_entry_info')or {}).get('resolution_combined')or [float('inf')])
        if resolution>s['maxResolutionA']:reason=reason or'resolution-outside-panel'
        for ligand in e.get('nonpolymer_entities')or []:
            comp=ligand.get('nonpolymer_comp')or {};ccd=ligand['pdbx_entity_nonpoly']['comp_id']
            smiles=(comp.get('rcsb_chem_comp_descriptor')or {}).get('SMILES_stereo');properties,chemical_reason=chem_properties(smiles,ccd)
            records.append({'pdbId':e['rcsb_id'],'releaseDate':e['rcsb_accession_info']['initial_release_date'][:10],
              'title':e['struct']['title'],'ccdId':ccd,'ligandName':ligand['pdbx_entity_nonpoly']['name'],
              'smiles':smiles,'properties':properties,'resolutionA':resolution if np.isfinite(resolution)else None,
              'sequence':sequence,'proteinDescription':(protein.get('rcsb_polymer_entity')or {}).get('pdbx_description')if protein else None,
              'proteinChains':protein['rcsb_polymer_entity_container_identifiers']['asym_ids']if protein else [],
              'ligandChains':ligand['rcsb_nonpolymer_entity_container_identifiers']['asym_ids'],
              'rejectionReason':reason or chemical_reason})
    eligible=[r for r in records if not r['rejectionReason']]
    eligible.sort(key=lambda r:(r['releaseDate'],-r['properties']['QED'],r['resolutionA'],r['pdbId'],r['ccdId']))
    save(out,{'schema':'molarium.recent-pdb-ranking.v1','policy':POLICY,'rdkitVersion':rdBase.rdkitVersion,
      'entriesSha256':sha(entries_path.read_bytes()),'records':records,'eligible':eligible})
    print(json.dumps({'entries':len(entries),'ligandRecords':len(records),'eligible':len(eligible),
      'rejections':Counter(r['rejectionReason']for r in records if r['rejectionReason']),
      'releases':Counter(r['releaseDate']for r in eligible),'top':[{k:r[k]for k in ['pdbId','ccdId','releaseDate','proteinDescription','properties']}for r in eligible[:12]]},indent=2))

def similar(a,b):
    d=POLICY['diversity']
    if min(len(a),len(b))/max(len(a),len(b))<d['minimumLengthRatio']:return False
    alignment=align_optimal(ProteinSequence(a),ProteinSequence(b),SubstitutionMatrix.std_protein_matrix(),gap_penalty=(-10,-1),max_number=1)[0]
    return get_sequence_identity(alignment,mode='shortest')>=d['sequenceIdentityCutoff']

def assembly_compatibility(cif,c,protein,ligand):
    if 'pdbx_struct_assembly_gen'not in cif:raise ValueError('missing-biological-assembly-definition')
    for assembly_id in pdbx.list_assemblies(cif):
        a=pdbx.get_assembly(cif,assembly_id=assembly_id,model=1,use_author_fields=False,altloc='occupancy',extra_fields=['label_seq_id'])
        heavy=~np.isin(np.char.upper(a.element),['H','D'])
        if not np.any(heavy&(a.chain_id==ligand))or not np.any(heavy&(a.chain_id==protein)):continue
        protein_mask=heavy&np.isin(a.chain_id,c['proteinChains'])&(a.label_seq_id!='.')
        protein_keys=sorted(set(zip(a.chain_id[protein_mask],a.sym_id[protein_mask])))
        checks=[]
        for sym in sorted(set(a.sym_id[a.chain_id==ligand])):
            lm=heavy&(a.chain_id==ligand)&(a.sym_id==sym);lc=a.coord[lm]
            if not len(lc):continue
            contacts=[]
            for chain,operator in protein_keys:
                mask=protein_mask&(a.chain_id==chain)&(a.sym_id==operator)
                distance=float(np.linalg.norm(a.coord[mask,None,:]-lc[None,:,:],axis=2).min())
                if distance<POLICY['structure']['otherProteinChainCutoffA']:contacts.append({'labelAsymId':str(chain),'symmetryCopy':int(operator),'distanceA':distance})
            if len(contacts)>1:raise ValueError('pocket-contacts-generated-biological-assembly-partner')
            if not contacts:raise ValueError('biological-assembly-has-no-protein-pocket-contact')
            other=heavy&(~protein_mask)&(~np.isin(a.res_name,['HOH','DOD']))&(~lm)
            if np.any(other)and np.linalg.norm(a.coord[other,None,:]-lc[None,:,:],axis=2).min()<POLICY['structure']['otherNonwaterSpeciesCutoffA']:
                raise ValueError('nearby-omitted-species-in-biological-assembly')
            checks.append({'ligandSymmetryCopy':int(sym),'contactingProteinCopies':contacts})
        return {'assemblyId':str(assembly_id),'proteinCopies':len(protein_keys),'ligandCopyChecks':checks}
    raise ValueError('selected-ligand-not-in-deposited-biological-assemblies')

def coordinate_candidate(c,sources):
    f=pdbx.CIFFile.read(sources/(c['pdbId']+'.cif')).block;t=f['atom_site'];s=POLICY['structure']
    a={k:strings(t,k)for k in t};xyz=np.array([[float(x)for x in a[k]]for k in ['Cartn_x','Cartn_y','Cartn_z']]).T
    heavy=(~np.isin(a['type_symbol'],['H','D']))&(a['pdbx_PDB_model_num']=='1');best=None
    for ligand in sorted(c['ligandChains']):
        lc=xyz[heavy&(a['label_asym_id']==ligand)]
        if not len(lc):continue
        for protein in c['proteinChains']:
            indices=np.flatnonzero(heavy&(a['label_asym_id']==protein))
            if not len(indices):continue
            distances=np.linalg.norm(xyz[indices,None,:]-lc[None,:,:],axis=2).min(1)
            contacts=set(a['label_seq_id'][indices[distances<=4]])
            key=(-len(contacts),ligand,protein)
            if best is None or key<best[0]:best=(key,protein,ligand,indices,distances,contacts)
    if best is None:raise ValueError('no-protein-ligand-coordinate-instance')
    _,protein,ligand,indices,distances,contacts=best
    if len(contacts)<s['minContactResiduesAt4A']:raise ValueError('too-few-pocket-contacts')
    if distances.min()<s['rejectProteinLigandHeavyDistanceUnderA']:raise ValueError('protein-ligand-close-contact-under1.8A')
    if 'struct_conn'in f:
        conn=f['struct_conn']
        for kind,p1,p2 in zip(strings(conn,'conn_type_id'),strings(conn,'ptnr1_label_asym_id'),strings(conn,'ptnr2_label_asym_id')):
            if kind.startswith('covale')and ligand in [p1,p2]and p1!=p2:raise ValueError('explicit-covalent-ligand-link')
    lc=xyz[heavy&(a['label_asym_id']==ligand)]
    for other in c['proteinChains']:
        if other==protein:continue
        oc=xyz[heavy&(a['label_asym_id']==other)]
        if len(oc)and np.linalg.norm(oc[:,None,:]-lc[None,:,:],axis=2).min()<s['otherProteinChainCutoffA']:raise ValueError('pocket-contacts-another-protein-chain')
    other=heavy&(~np.isin(a['label_asym_id'],[protein,ligand]))&(~np.isin(a['label_comp_id'],['HOH','DOD']))
    oc=xyz[other]
    if len(oc)and np.linalg.norm(oc[:,None,:]-lc[None,:,:],axis=2).min()<s['otherNonwaterSpeciesCutoffA']:raise ValueError('nearby-omitted-nonwater-species')
    r=reference(sources,c['pdbId'],c['ccdId'],protein,ligand)
    if r['sequence']!=c['sequence']:raise ValueError('metadata-coordinate-sequence-mismatch')
    declared=Chem.MolToSmiles(Chem.MolFromSmiles(c['smiles']));actual=Chem.MolToSmiles(Chem.MolFromSmiles(r['smiles']))
    if declared!=actual:raise ValueError('metadata-CCD-chemical-state-mismatch')
    if len(r['observedResidues'])/len(r['sequence'])<s['minObservedCaFraction']:raise ValueError('low-reference-backbone-coverage')
    stereo=r['stereochemistry']
    if stereo['mismatchedCenters']or stereo['unassignedCenters']:raise ValueError('reference-tetrahedral-stereo-disagrees-with-CCD')
    r['selection']['biologicalAssembly']=assembly_compatibility(f,c,protein,ligand)
    return r,protein,ligand

def prepare(ranked_path,sources,out):
    ranked=json.loads(ranked_path.read_text());audit=[];selected=[];counts=Counter();waiting=set();out.mkdir();(out/'sources').mkdir()
    if ranked['policy']!=POLICY:raise ValueError('Frozen ranking policy differs from the current selection protocol')
    for c in ranked['eligible']:
        date=c['releaseDate']
        if date in waiting:
            audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'not-assessed','reason':'higher-ranked-source-pending'});continue
        if counts[date]>=POLICY['maxCasesPerRelease']:
            audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'not-selected','reason':'release-quota'});continue
        if any(similar(c['sequence'],p['sequence'])for p in selected):
            audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'not-selected','reason':'near-duplicate-protein'});continue
        missing=[name for name in [c['pdbId']+'.cif',c['ccdId']+'.cif']if not (sources/name).exists()]
        if missing:
            audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'needs-source','files':missing});waiting.add(date);continue
        try:r,protein,ligand=coordinate_candidate(c,sources)
        except (ValueError,KeyError,StopIteration,IndexError)as e:
            audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'rejected','reason':str(e)or type(e).__name__});continue
        id=c['pdbId'].lower()+'-'+c['ccdId'].lower();d=out/id;d.mkdir();save(d/'reference.json',r);(d/'reference.pdb').write_text(r['result']['pdb'])
        selected.append({**c,'id':id,'name':c['pdbId']+' · '+c['proteinDescription']+' · '+c['ccdId'],
          'smiles':r['smiles'],'proteinLabelAsymId':protein,'ligandLabelAsymId':ligand,
          'referenceFile':id+'/reference.json','referenceSha256':sha((d/'reference.json').read_bytes()),
          'observedCa':len(r['observedResidues']),'proteinResidues':len(r['sequence']),'ligandHeavyAtoms':r['ligandHeavyAtoms']})
        counts[date]+=1;audit.append({'pdbId':c['pdbId'],'ccdId':c['ccdId'],'status':'selected'})
        for name in [c['pdbId']+'.cif',c['ccdId']+'.cif']:shutil.copyfile(sources/name,out/'sources'/name)
    save(out/'selection-audit.json',{'policy':POLICY,'rankingSha256':sha(ranked_path.read_bytes()),'records':audit})
    incomplete=any(counts[d]<POLICY['maxCasesPerRelease']for d in {c['releaseDate']for c in ranked['eligible']})
    if incomplete and any(a['status']=='needs-source'for a in audit):
        save(out/'needed-sources.json',sorted({f for a in audit if a['status']=='needs-source'for f in a['files']}))
        print(json.dumps({'status':'needs-source','selected':len(selected),'perRelease':counts,'output':str(out)}));return
    sources_record=[{'file':'sources/'+p.name,'sha256':sha(p.read_bytes()),'url':'https://files.rcsb.org/'+('download/'if any(c['pdbId']+'.cif'==p.name for c in selected)else'ligands/download/')+p.name}for p in sorted((out/'sources').glob('*.cif'))]
    panel={'schema':'molarium.experimental-cofold-panel.v1','createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
      'purpose':'Predeclared drug-like, protein-diverse recent-release reconstruction panel; no prediction-based selection.',
      'policy':POLICY,'seeds':POLICY['seeds'],'cases':selected,'sources':sources_record,
      'browserProtocol':POLICY['browserProtocol'],'nativeProtocol':POLICY['nativeProtocol'],
      'caveats':['Recent release is not proof that similar proteins, ligands or binding sites were absent from training.',
       'Single standard-amino-acid protein chain and one noncovalent ligand; selection excludes out-of-scope complexes and records every exclusion.',
       'Protein sequence and stereochemical SMILES only; crystal coordinates and bound conformers are scoring/display-only.',
       'Drug-likeness uses stated heuristic gates and RDKit QED; it is not an experimental pharmacology or safety assessment.',
       'Browser int5/25steps/2recycles and native unquantized200steps/3recycles confound precision and sampling; not fixed-input parity.',
       'Primary ligand RMSD uses every observed corresponding protein C-alpha, no trimming/pocket refit or independent ligand fit.',
       'Each seed and failure remains visible; oracle best-of3 uses the experimental answer and is separate from confidence selection.']}
    save(out/'panel.json',panel);print(json.dumps({'status':'frozen','cases':len(selected),'perRelease':counts,'output':str(out)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    q=sub.add_parser('rank');q.add_argument('--entries',type=Path,required=True);q.add_argument('--output',type=Path,required=True)
    q=sub.add_parser('prepare');q.add_argument('--ranking',type=Path,required=True);q.add_argument('--sources',type=Path,required=True);q.add_argument('--output',type=Path,required=True)
    q=sub.add_parser('policy');q.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.command=='rank':rank(a.entries,a.output)
    elif a.command=='prepare':prepare(a.ranking,a.sources,a.output)
    else:save(a.output,POLICY)
