"""Count similarity-stratified outcomes without presenting partial work as final."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def summarize(plan,report):
    rows=report['poses'];jobs=plan['jobs'];pairs=plan['pairs']
    if len(rows)!=len(jobs):raise ValueError('Planned denominator differs')
    for job,row in zip(jobs,rows):
        if any(row[k]!=job[k]for k in ['index','caseId','model','seed']):raise ValueError('Prediction identity/order differs')
        if row['status']not in ['complete','failed','not-started','running']:raise ValueError('Unknown prediction state')
        if row['status']=='complete'and(not isinstance(row['limitedValidityPass'],bool)or not math.isfinite(row['ligandRmsdA'])or row['ligandRmsdA']<0 or row['within2A']!=(row['ligandRmsdA']<2)):
            raise ValueError('Invalid completed score or strict threshold')
    def group(selected):
        identities={(p['caseId'],p['model'])for p in selected};chosen=[r for r in rows if(r['caseId'],r['model'])in identities]
        complete=[r for r in chosen if r['status']=='complete'];terminal=[r for r in chosen if r['status']in ['complete','failed']]
        finished=[]
        for identity in identities:
            case=[r for r in chosen if(r['caseId'],r['model'])==identity]
            if case and all(r['status']in ['complete','failed']for r in case):finished.append(identity)
        hits={(r['caseId'],r['model'])for r in complete if r['within2A']}
        valid={(r['caseId'],r['model'])for r in complete if r['within2A']and r['limitedValidityPass']}
        final=len(terminal)==len(chosen)
        return {'plannedCases':len(identities),'plannedPredictions':len(chosen),'completePredictions':len(complete),
                'executionFailures':sum(r['status']=='failed'for r in chosen),'fullyProcessedCases':len(finished),
                'observedGeometricHitCases':len(hits),'observedLimitedValidityPassingHitCases':len(valid),
                'geometricPoseHits':sum(r['within2A']for r in complete),
                'limitedValidityPassingPoseHits':sum(r['within2A']and r['limitedValidityPass']for r in complete),
                'final':final,'finalLimitedValidityCaseHitRate':len(valid)/len(identities)if final and identities else None}
    return {'schema':'molarium.rnp-stock-summary.v1','allSelected':group(pairs),
            'nativeLimitedValiditySubset':group([p for p in pairs if p['nativeHasStereoClashPassingHit']]),
            'bySimilarityBin':[{'bin':i,'interval':interval,**group([p for p in pairs if p['similarityBin']==i])}
                              for i,interval in enumerate(['[0,25)','[25,50)','[50,75)','[75,100]'])],
            'scope':'Selected native-positive reconstruction cohort. Related sequences/clusters remain in the metadata. Counts are descriptive, not population accuracy or numerical parity.',
            'partialPolicy':'No final case hit rate until every planned prediction in that group is terminal. Execution failures stay in the denominator; geometric and limited-validity hits stay separate.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan',type=Path,required=True);p.add_argument('--scores',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();raw=a.plan.read_bytes();score_bytes=a.scores.read_bytes();report=json.loads(score_bytes)
    if hashlib.sha256(raw).hexdigest()!=report['planSha256']:raise ValueError('Source plan identity mismatch')
    result=summarize(json.loads(raw),report);result['planSha256']=report['planSha256'];result['scoresSha256']=hashlib.sha256(score_bytes).hexdigest()
    with a.output.open('x')as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result['allSelected']))
