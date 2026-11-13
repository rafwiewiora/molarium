"""Plot every fixed-panel seed and separate protein/ligand reconstruction errors."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['svg.hashsalt']='molarium-recent-panel-v1'


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--panel',type=Path,required=True)
    p.add_argument('--scores',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();panel=json.loads(a.panel.read_text());scores=json.loads(a.scores.read_text())
    cases=panel['cases'];methods=list(dict.fromkeys(r['method']for r in scores['poses']))
    labels={('browser-'+p['id']):p['label']for p in scores.get('phaseDefinitions',[])}
    fig,axes=plt.subplots(2,1,figsize=(13,8),sharex=True,layout='constrained')
    colors=plt.get_cmap('tab10');width=.72/max(1,len(methods))
    for j,method in enumerate(methods):
        for i,c in enumerate(cases):
            rows=[r for r in scores['poses']if r['caseId']==c['id']and r['method']==method and r['status']=='complete']
            x=i+(j-(len(methods)-1)/2)*width
            for ax,key in zip(axes,['proteinCaRmsdA','ligandRmsdA']):
                values=[r[key]for r in rows]
                if not values:continue
                ax.scatter([x]*len(values),values,s=25,color=colors(j),alpha=.65,zorder=3)
                ax.plot([x-width*.35,x+width*.35],[np.median(values)]*2,color=colors(j),lw=3,zorder=4)
        axes[0].scatter([],[],s=28,color=colors(j),label=labels.get(method,method))
    axes[0].set_ylabel('Protein Cα RMSD (Å)');axes[1].set_ylabel('Ligand RMSD in protein frame (Å)')
    axes[1].axhline(2,color='#697b85',ls='--',lw=1,label='2 Å geometric criterion')
    for ax in axes:
        ax.set_ylim(bottom=0);ax.grid(axis='y',alpha=.2);ax.spines[['top','right']].set_visible(False)
    axes[1].set_xticks(range(len(cases)),[c['pdbId']+'\n'+c['ccdId']for c in cases])
    axes[0].legend(loc='lower left',bbox_to_anchor=(0,1.01),fontsize=8,ncols=2,frameon=False)
    axes[1].legend(loc='upper left',fontsize=9,frameon=False)
    axes[0].set_title('Recent-release PDB reconstruction · every seed retained',loc='left',weight='bold',pad=70)
    fig.supxlabel('Dots: seeds 0, 1, 2. Bars: per-system medians. All observed matching Cα atoms determine the protein fit.',fontsize=10)
    for suffix in ['.png','.svg']:
        path=a.output.with_suffix(suffix)
        fig.savefig(path,dpi=180,metadata={'Date':None}if suffix=='.svg'else None)
        if suffix=='.svg':path.write_text('\n'.join(line.rstrip()for line in path.read_text().splitlines())+'\n')
    a.output.with_suffix('.plot.json').write_text(json.dumps({'panelSha256':hashlib.sha256(a.panel.read_bytes()).hexdigest(),
        'scoresSha256':hashlib.sha256(a.scores.read_bytes()).hexdigest(),'methods':methods,
        'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},indent=2)+'\n')


if __name__=='__main__':main()
