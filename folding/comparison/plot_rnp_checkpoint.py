"""Plot a uniform completed seed prefix, keeping unfinished budgets out of rates."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from summarize_rnp_stock import summarize
from analyze_rnp_sampling import analyze


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan',type=Path,required=True);p.add_argument('--scores',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--samples',type=int,default=3)
    a=p.parse_args();plan_bytes=a.plan.read_bytes();score_bytes=a.scores.read_bytes();plan=json.loads(plan_bytes);report=json.loads(score_bytes)
    if hashlib.sha256(plan_bytes).hexdigest()!=report['planSha256']:raise ValueError('Frozen plan changed')
    summary=summarize(plan,report)
    sampling=analyze(plan,report)
    if not 1<=a.samples<=len(sampling['allSelected']):raise ValueError('Sample budget outside frozen plan')
    budget=sampling['allSelected'][a.samples-1]
    if not budget['fullyProcessed']:raise ValueError('Uniform sample budget is unfinished')
    rows=[r for r in report['poses']if r['status']=='complete'and r['seed']<a.samples]
    if not rows:raise ValueError('No completed structures in this prefix to plot')
    pairs={p['caseId']:p for p in plan['pairs']}
    a.output.mkdir(exist_ok=False)
    plt.rcParams.update({'font.family':'STIXGeneral','font.size':11,'svg.fonttype':'none','axes.spines.top':False,'axes.spines.right':False})
    fig,(top,bottom)=plt.subplots(2,1,figsize=(11.2,8.6),gridspec_kw={'height_ratios':[1,1.55]})
    fig.subplots_adjust(left=.09,right=.97,top=.89,bottom=.13,hspace=.56)
    fig.suptitle(f'Stock LocalFold after {a.samples} predictions per system',x=.09,y=.975,ha='left',fontsize=17)
    fig.text(.09,.928,f"{len(plan['pairs'])} native-positive cases · seeds 0–{a.samples-1} · 200 diffusion steps · four trunk passes · physical Apple WebGPU",ha='left',fontsize=11,color='#52606a')
    bins=summary['bySimilarityBin'];x=np.arange(4);width=.32
    for offset,key,color,label in [(-width/2,'oracleGeometricHitCases','#9abacb','Any pose <2 Å'),(width/2,'oracleLimitedValidityPassingHitCases','#178d80','Any <2 Å pose passing limited diagnostics')]:
        counts=[b['budgets'][a.samples-1]['observedCounts'][key]for b in sampling['bySimilarityBin']]
        heights=[100*n/b['plannedCases']if b['plannedCases']else 0 for n,b in zip(counts,bins)]
        top.bar(x+offset,heights,width,color=color,label=label,zorder=3)
        for xx,height,b,n in zip(x+offset,heights,bins,counts):
            top.text(xx,height+3,f"{n}/{b['plannedCases']}",ha='center',va='bottom',fontsize=10)
    top.set_xticks(x,[b['interval']+'\n'+f"n={b['plannedCases']}"for b in bins]);top.set_ylim(0,118)
    top.set_yticks([0,25,50,75,100],['0%','25%','50%','75%','100%']);top.set_ylabel(f'Cases with a hit in {a.samples} predictions')
    top.set_xlabel('Published training-similarity bin');top.grid(axis='y',color='#e4e9ec',zorder=0)
    top.legend(frameon=False,loc='upper right',ncol=2,fontsize=10)
    for pair in plan['pairs']:
        bottom.scatter(pair['similarity'],pair['nativeBestA'],marker='D',s=19,color='#667780',alpha=.42,zorder=2)
    for row in rows:
        valid=row['limitedValidityPass'];color='#c34b45'if not valid else '#178d80'if row['within2A']else'#3677a5'
        bottom.scatter(pairs[row['caseId']]['similarity'],row['ligandRmsdA'],marker='o'if valid else'x',s=26,color=color,alpha=.8,zorder=3)
    bottom.axhline(2,color='#b0822e',ls='--',lw=1.1,zorder=1)
    bottom.set_yscale('log');bottom.set_xlim(-3,103);bottom.set_ylim(.08,max(r['ligandRmsdA']for r in rows)*1.35)
    ticks=[.1,.25,.5,1,2,5,10,20,50,100];ticks=[t for t in ticks if bottom.get_ylim()[0]<=t<=bottom.get_ylim()[1]]
    bottom.set_yticks(ticks,[f'{t:g}'for t in ticks]);bottom.set_xlabel('Published training similarity: SuCOS shape × pocket coverage (0–100)')
    bottom.set_ylabel('Protein-frame ligand RMSD (Å)');bottom.grid(axis='y',which='major',color='#e4e9ec',zorder=0)
    handles=[Line2D([],[],marker='D',ls='none',color='#667780',label='Saved native best'),
             Line2D([],[],marker='o',ls='none',color='#178d80',label='Stock <2 Å; limited diagnostics pass'),
             Line2D([],[],marker='o',ls='none',color='#3677a5',label='Stock ≥2 Å; limited diagnostics pass'),
             Line2D([],[],marker='x',ls='none',color='#c34b45',label='Stock limited diagnostics fail')]
    bottom.legend(handles=handles,frameon=False,loc='upper left',bbox_to_anchor=(0,1.23),ncol=2,fontsize=9)
    failures=budget['executionFailures']
    fig.text(.09,.055,f"All {len(rows)} completed predictions in this prefix are shown; {failures} execution failures remain in the denominator. Best-of-{a.samples} uses the experimental answer.\nThe low-similarity bin has {bins[0]['plannedCases']} case(s). Selected native-positive reconstruction cohort; related targets remain identifiable. This is not numerical parity or general accuracy.",ha='left',va='center',fontsize=9,color='#52606a')
    basename='first-three'if a.samples==3 else f'first-{a.samples}'
    for extension in ['png','svg']:fig.savefig(a.output/(basename+'.'+extension),dpi=200,facecolor='white')
    plt.close(fig)
    manifest={'planSha256':hashlib.sha256(plan_bytes).hexdigest(),'scoresSha256':hashlib.sha256(score_bytes).hexdigest(),
              'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'matplotlibVersion':matplotlib.__version__,
              'seeds':list(range(a.samples)),'plottedStockPredictions':len(rows),'outputs':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in a.output.iterdir()}}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'predictions':len(rows),'output':str(a.output)}))


if __name__=='__main__':main()
