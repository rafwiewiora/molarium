"""Plot existing full-protein alignment residuals; never recalculate predictions."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import os
import tempfile
os.environ.setdefault('MPLCONFIGDIR',str(Path(tempfile.gettempdir())/'molarium-cofold-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('--profile',action='append',required=True,help='label=file.json')
    p.add_argument('--output',type=Path,required=True);p.add_argument('--tail-start',type=int)
    a=p.parse_args();plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','svg.hashsalt':'molarium-cofold-residuals'})
    fig,ax=plt.subplots(figsize=(8.8,3.9));sources=[];extent=0
    colors=['#197D8C','#D8842C','#486CAC'];identities=None
    for i,argument in enumerate(a.profile):
        label,file=argument.split('=',1);path=Path(file);data=json.loads(path.read_text())
        if data['schema']!='molarium.protein-alignment-residuals.v1':raise ValueError('Unexpected profile schema')
        keys=[(r['chain'],r['residue'],r['resName'])for r in data['residues']]
        if identities is not None and keys!=identities:raise ValueError('Profile residue identities differ')
        identities=keys;values=np.array([r['displacementA']for r in data['profiles']]);q=np.percentile(values,[10,50,90],axis=0)
        if values.shape!=(data['pairs'],len(keys)) or not np.allclose(q[1],[r['medianDisplacementA']for r in data['residues']]):raise ValueError('Profile values/summary differ')
        x=np.arange(1,len(keys)+1);color=colors[i%len(colors)];extent=max(extent,float(q[2].max()))
        ax.fill_between(x,q[0],q[2],color=color,alpha=.13,linewidth=0)
        ax.plot(x,q[1],color=color,linewidth=1.9,label=label)
        sources.append({'label':label,'file':path.name,'sha256':digest(path),'pairs':data['pairs']})
    if a.tail_start:
        ax.axvspan(a.tail_start-.5,len(identities)+.5,color='#82929C',alpha=.07,zorder=-1)
        ax.text((a.tail_start+len(identities))/2,extent*1.05,'C-terminal\ntail',ha='center',va='top',fontsize=8,color='#56616B')
    ax.set(xlim=(1,len(identities)),ylim=(0,extent*1.12),xlabel='Protein sequence position',ylabel='Cα displacement after whole-protein fit (Å)')
    ax.set_title('OpenBind-0: localization of browser/native backbone differences',loc='left',fontsize=12,pad=14)
    ax.spines[['right','top']].set_visible(False);ax.grid(axis='y',color='#E5E9EC',linewidth=.7);ax.set_axisbelow(True)
    ax.legend(loc='upper left',frameon=False)
    fig.text(.11,.035,'Line: median; band: 10–90% of cross-seed pairs. Same full-protein fits; no trimming or core refit.\nExploratory protocol comparison on arbitrary ubiquitin–compound pairs; no experimental pose answers.',fontsize=8,color='#52606B',va='bottom')
    fig.subplots_adjust(left=.11,right=.98,top=.85,bottom=.25);a.output.parent.mkdir(parents=True,exist_ok=True)
    png=a.output.with_suffix('.png');svg=a.output.with_suffix('.svg')
    fig.savefig(png,dpi=200,facecolor='white');fig.savefig(svg,facecolor='white',metadata={'Date':None});plt.close(fig)
    record={'schema':'molarium.cofold-scientific-plot.v1','sources':sources,'tailStart':a.tail_start,'scriptSha256':digest(Path(__file__)),
      'environment':{'python':platform.python_version(),'numpy':np.__version__,'matplotlib':matplotlib.__version__},
      'artifacts':[{'file':path.name,'sha256':digest(path),'bytes':path.stat().st_size}for path in [png,svg]]}
    a.output.with_suffix('.plot.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))


if __name__=='__main__':main()
