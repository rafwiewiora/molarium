"""Synthetic storage fixtures only; no neural inference or scientific scores."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from merge_stock_attempts import merge


def digest(raw):return hashlib.sha256(raw).hexdigest()
def write(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))


class AttemptMerge(unittest.TestCase):
    def fixture(self,root,records,source=b'# synthetic source, never executed\n'):
        root.mkdir();(root/'source').mkdir();(root/'source/run_stock_benchmark.py').write_bytes(source)
        write(root/'source-manifest.json',{'run_stock_benchmark.py':digest(source)})
        jobs=[]
        for i in range(2):
            raw=json.dumps({'seed':i,'synthetic':True}).encode();p=root/'frozen-plan/inputs'/f'{i}.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
            jobs.append({'index':i,'caseId':'case','model':'boltz2','seed':i,'input':f'inputs/{i}.json','inputSha256':digest(raw)})
        for name in ['scores.json','reference.json']:
            p=root/'reference-evidence'/name;p.parent.mkdir(exist_ok=True);p.write_bytes(b'{}')
        plan={'jobs':jobs,'pairs':[{'nativeScoreFile':'scores.json','nativeScoreSha256':digest(b'{}'),'referenceFile':'reference.json','referenceSha256':digest(b'{}')}]}
        write(root/'frozen-plan/plan.json',plan);rows=[]
        for index,status in records:
            directory=root/('job-'+str(index));directory.mkdir();record={k:jobs[index][k]for k in ['index','caseId','model','seed']};record.update(status=status,directory=directory.name)
            if status=='complete':
                data=b'SYNTHETIC STORAGE FIXTURE: NOT A PREDICTION\n';(directory/'prediction.pdb').write_bytes(data)
                write(directory/'receipt.json',{'status':'complete','neuralInferenceCompleted':True,'inputSha256':jobs[index]['inputSha256'],'outputs':{'prediction.pdb':{'sha256':digest(data)}}})
                write(directory/'score.json',{'synthetic':True});record.update(receiptSha256=digest((directory/'receipt.json').read_bytes()),scoreSha256=digest((directory/'score.json').read_bytes()))
            rows.append(record)
        write(root/'progress.json',{'status':'synthetic-storage-fixture','planSha256':digest((root/'frozen-plan/plan.json').read_bytes()),'records':rows})

    def test_incomplete_attempt_can_continue_without_replacing_completed_output(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);self.fixture(root/'one',[(0,'complete'),(1,'running')]);self.fixture(root/'two',[(1,'complete')])
            before=(root/'one/progress.json').read_bytes();result=merge([root/'one',root/'two'],root/'merged')
            self.assertEqual(result['completed'],2);self.assertEqual(result['newNeuralForwards'],0)
            self.assertEqual((root/'one/progress.json').read_bytes(),before)
            self.assertEqual((root/'merged/predictions/000/prediction.pdb').read_bytes(),(root/'one/job-0/prediction.pdb').read_bytes())
            history=json.loads((root/'merged/merge-receipt.json').read_bytes())['attemptHistory'];self.assertEqual(len(history),3)

    def test_repeated_complete_or_changed_source_fails_before_staging(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);self.fixture(root/'one',[(0,'complete')]);self.fixture(root/'two',[(0,'complete')])
            with self.assertRaisesRegex(ValueError,'Repeated completed prediction'):merge([root/'one',root/'two'],root/'bad')
            self.assertFalse((root/'bad').exists())
            self.fixture(root/'three',[(1,'complete')],source=b'# changed synthetic source\n')
            with self.assertRaisesRegex(ValueError,'Different consumed code'):merge([root/'one',root/'three'],root/'changed')
            self.assertFalse((root/'changed').exists())


if __name__=='__main__':unittest.main()
