"""Require the installed official OpenFold3 pipeline to consume the saved MSA.

Run on an allocated CPU node before GPU submission. This is an input/feature
check, not model inference. Its outputs support independent parser comparison.
"""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import platform
from native_run import resolved_input_files


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inputs',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if importlib.metadata.version('openfold3')!='0.5.1':
        raise ValueError('This control requires official OpenFold3 0.5.1')
    from openfold3.core.config.msa_pipeline_configs import MsaSampleProcessorInputInference
    from openfold3.core.data.pipelines.sample_processing.msa import MsaSampleProcessorInference
    from openfold3.core.data.primitives.featurization.msa import vstack_pad_msa_arrays
    from openfold3.projects.of3_all_atom.config.dataset_config_components import MSASettings
    from openfold3.projects.of3_all_atom.config.inference_query_format import InferenceQuerySet
    from openfold3.core.data.resources.residues import (
        map_str_array_to_idx_array,MoleculeType,STANDARD_RESIDUES_WITH_GAP_1)
    args.output.mkdir()
    index=json.loads((args.inputs/'input-index.json').read_text());records=[]
    for case in index['cases']:
        source=args.inputs/case;out=args.output/case;out.mkdir()
        spec=json.loads((source/'comparison.json').read_text())
        query_file,_=resolved_input_files(source,out,spec)
        query_set=InferenceQuerySet.from_json(query_file)
        processor=MsaSampleProcessorInference(config=MSASettings(subsample_main=False))
        for name,query in query_set.queries.items():
            assert query.use_msas and query.use_main_msas
            data=MsaSampleProcessorInputInference.create_from_inference_query_entry(inference_query=query)
            collection=processor(input=data)
            stacked,_=vstack_pad_msa_arrays(collection,'A')
            rows=[''.join(row)for row in stacked.msa]
            assert rows[0]==spec['sequence']
            assert len(rows)>=256, 'Provided MSA was truncated or replaced by a dummy alignment'
            record={'caseId':case,'query':name,'providedMsaSha256':spec['alignment']['sha256'],
                'rows':rows,'deletionMatrix':stacked.deletion_matrix.tolist(),
                'profile':collection.chain_id_to_profile['A'].tolist(),
                'deletionMean':collection.chain_id_to_deletion_mean['A'].tolist(),
                'modelResidueRows':[''.join(STANDARD_RESIDUES_WITH_GAP_1[int(i)]for i in row)
                    for row in map_str_array_to_idx_array(stacked.msa,MoleculeType.PROTEIN)]}
            records.append(record)
    package_sources={}
    for obj in [MsaSampleProcessorInference,vstack_pad_msa_arrays,InferenceQuerySet]:
        source=Path(inspect.getsourcefile(obj))
        package_sources[str(source).split('/openfold3/',1)[-1]]=hashlib.sha256(source.read_bytes()).hexdigest()
    report={'schema':'molarium.official-native-msa-preflight.v1','runtime':'openfold3 0.5.1',
        'scope':'Official protein alignment/deletion rows, residue profiles and deletion means; no model weights or inference.',
        'environment':{'python':platform.python_version(),'packages':{p:importlib.metadata.version(p)
            for p in ['openfold3','numpy','pandas','torch','rdkit','biotite']}},
        'officialSourceFiles':package_sources,
        'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'records':records}
    (args.output/'msa-features.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':len(records),'status':'complete'}))


if __name__=='__main__':main()
