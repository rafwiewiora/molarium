"""Plot completed uniform sample budgets and separately measured launcher wall times."""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--analysis', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.analysis.read_bytes()
    analysis = json.loads(raw)
    budgets = [r for r in analysis['allSelected'] if r['fullyProcessed']]
    if not budgets:
        raise ValueError('No uniform completed budget')
    timing = analysis['timing']
    rows = timing['predictions']
    if not rows:
        raise ValueError('No hash-bound timing receipts')
    args.output.mkdir(exist_ok=False)
    plt.rcParams.update({'font.family': 'STIXGeneral', 'font.size': 11, 'svg.fonttype': 'none',
                         'axes.spines.top': False, 'axes.spines.right': False})
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(11.2, 8.9))
    fig.subplots_adjust(left=.09, right=.97, top=.87, bottom=.15, hspace=.6)
    count = budgets[0]['plannedCases']
    prefix = budgets[-1]['samplesPerCase']
    planned = len(analysis['allSelected'])
    fig.suptitle('Sampling, pose selection and observed run time', x=.09, y=.975, ha='left', fontsize=17)
    fig.text(.09, .928, f'{count} native-positive cases · uniform budgets 1–{prefix} of {planned} planned · 200 steps · four trunk passes',
             ha='left', fontsize=11, color='#52606a')
    for key, color, style, label in [
        ('oracleGeometricHitCases', '#8aa6b8', '--', 'Any sample <2 Å (uses crystal answer)'),
        ('oracleLimitedValidityPassingHitCases', '#178d80', '-', 'Any passing <2 Å sample (uses crystal answer)'),
        ('highestIptmGeometricHitCases', '#d5a676', '--', 'Highest-ipTM sample <2 Å'),
        ('highestIptmLimitedValidityPassingHitCases', '#a65c24', '-', 'Highest-ipTM sample passing and <2 Å'),
    ]:
        values = [None if r['rates'][key] is None else r['observedCounts'][key] for r in budgets]
        top.plot([r['samplesPerCase'] for r in budgets], values, marker='o', color=color, ls=style, label=label)
    top.set_xlim(.7, planned + .3)
    top.set_xticks(range(1, planned + 1))
    top.set_ylim(0, count)
    top.set_yticks(range(0, count + 1, 8))
    top.set_xlabel('Predeclared samples per case (seed prefix)')
    top.set_ylabel(f'Cases with a hit / {count}')
    top.grid(axis='y', color='#e4e9ec')
    top.legend(frameon=False, fontsize=9, ncol=2, loc='upper left', bbox_to_anchor=(0, 1.22))
    for row in rows:
        bottom.scatter(row['proteinResidues'], row['launcherElapsedSeconds'], s=18, color='#3677a5', alpha=.45)
    for group in timing['byProteinLength']:
        stats = group['launcherSeconds']
        if stats['count']:
            lower, upper = [int(n) for n in group['interval'].strip('[]()').split(',')]
            bottom.hlines(stats['median'], lower, upper, color='#178d80', lw=2.3, zorder=3)
    bottom.set_xlabel('Protein residues')
    bottom.set_ylabel('Launcher wall time (seconds)')
    bottom.set_xlim(50, 710)
    bottom.set_ylim(0, max(r['launcherElapsedSeconds'] for r in rows) * 1.14)
    bottom.grid(axis='y', color='#e4e9ec')
    bottom.set_title(f'{len(rows)} completed runs on physical Apple WebGPU; green lines show length-bin medians',
                     fontsize=11, loc='left', pad=12)
    fig.text(.09, .057,
             'Confidence selection uses reported ipTM, with lowest seed breaking ties; no crystal or validity filter before ranking.\n'
             '“Passing” means limited stereochemistry/clash diagnostics. Wall time includes browser startup, available asset loading,\n'
             'folding, confidence and archive checks; excludes independent scoring. Selected, related cases; no cross-device speed claim.',
             ha='left', va='center', fontsize=9, color='#52606a')
    for extension in ['png', 'svg']:
        fig.savefig(args.output / ('sampling-and-time.' + extension), dpi=200, facecolor='white')
    plt.close(fig)
    manifest = {'analysisSha256': hashlib.sha256(raw).hexdigest(),
                'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'matplotlibVersion': matplotlib.__version__,
                'completedUniformBudget': prefix, 'plannedBudget': planned,
                'outputs': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in args.output.iterdir()}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'uniformBudget': prefix}))


if __name__ == '__main__':
    main()
