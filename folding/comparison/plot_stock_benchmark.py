"""Plot every stock-prediction RMSD, retaining chemical-validity failures."""
import argparse
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import FixedLocator, FuncFormatter


TARGETS = {'32qy-a1keo': 'YTHDF2', '15ji-a1d2g': 'NSP3', '1fkf-fk5': 'FKBP12',
           '9sxf-a1jrg': 'KIT', '9t3v-a1jtg': 'sEH', '9t51-a1jtm': 'STARD4', '9xjq-a1e0i': 'WDR5'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review', type=Path)
    args = parser.parse_args()
    raw = (args.review / 'scores.json').read_bytes()
    report = json.loads(raw)
    output = args.review / 'plots'
    output.mkdir(exist_ok=False)
    plt.rcParams.update({'font.family': 'STIXGeneral', 'font.size': 11,
                         'svg.fonttype': 'none', 'axes.spines.top': False,
                         'axes.spines.right': False})
    fig, ax = plt.subplots(figsize=(11.6, 7.4))
    fig.subplots_adjust(left=0.17, right=0.985, top=0.79, bottom=0.13)
    colors = {'hit': '#008574', 'miss': '#3976a8', 'invalid': '#c64845'}
    for y, summary in enumerate(report['summary']):
        rows = [r for r in report['poses'] if (r['caseId'], r['model']) == (summary['caseId'], summary['model']) and r['status'] == 'complete']
        for row in rows:
            if row['ligandRmsdA'] <= 0:
                raise ValueError('Cannot represent a nonpositive RMSD on this logarithmic axis')
            valid = row['limitedValidityPass']
            color = colors['invalid'] if not valid else colors['hit'] if row['within2A'] else colors['miss']
            ax.scatter(row['ligandRmsdA'], y + (row['seed'] - 4.5) * 0.034,
                       marker='o' if valid else 'x', color=color, s=34, linewidths=1.15, zorder=3)
        ax.scatter(summary['nativeBestA'], y - 0.23, marker='D', color='#242a30', s=30, zorder=4)
    labels = [TARGETS[s['caseId']] + (' †' if not s['nativeHasStereoClashPassingHit'] else '')
              + '\n' + s['caseId'].split('-')[0].upper() + ' · ' + ('Boltz-2' if s['model'] == 'boltz2' else 'OpenBind-0')
              for s in report['summary']]
    values = [r['ligandRmsdA'] for r in report['poses'] if r['status'] == 'complete']
    ax.set_xscale('log')
    ax.set_xlim(min(0.45, min(values) * 0.8), max(12, max(values) * 1.2))
    ax.axvspan(ax.get_xlim()[0], 2, color='#008574', alpha=0.055, zorder=0)
    ax.axvline(2, color='#b18432', linestyle='--', linewidth=1.2, zorder=1)
    ticks = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100]
    ax.xaxis.set_major_locator(FixedLocator(ticks))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _position: f'{value:g}'))
    ax.set_yticks(range(len(labels)), labels)
    ax.set_ylim(len(labels) - 0.55, -0.65)
    ax.grid(axis='x', which='major', color='#dce1e6', linewidth=0.6)
    ax.set_xlabel('Protein-aligned ligand RMSD (Å; logarithmic axis)')
    fig.text(0.17, 0.98, f'Stock LocalFold on native-positive crystal cases\n'
                 f'{report["completed"]}/{report["planned"]} predictions · 200 steps · 3 additional recycles · 10 seeds per pair',
                 ha='left', va='top', fontsize=14)
    handles = [Line2D([], [], marker='D', color='none', markerfacecolor='#242a30', markeredgecolor='#242a30', label='Native best of 3'),
               Line2D([], [], marker='o', color='none', markerfacecolor=colors['hit'], markeredgecolor=colors['hit'], label='Stock <2 Å, limited validity passes'),
               Line2D([], [], marker='o', color='none', markerfacecolor=colors['miss'], markeredgecolor=colors['miss'], label='Stock ≥2 Å, limited validity passes'),
               Line2D([], [], marker='x', color=colors['invalid'], linestyle='none', label='Stock limited validity fails')]
    fig.legend(handles=handles, loc='upper left', bbox_to_anchor=(0.17, 0.90), ncol=2,
              frameon=False, fontsize=9, columnspacing=1.8, handletextpad=0.6)
    fig.supxlabel('† Native geometric hits fail separate limited validity checks. Seed offsets only separate points; no samples are discarded.', fontsize=9)
    for extension in ['png', 'svg']:
        fig.savefig(output / ('poses.' + extension), dpi=220, facecolor='white')
        if extension == 'svg':
            vector = output / 'poses.svg'
            vector.write_text('\n'.join(line.rstrip() for line in vector.read_text().splitlines()) + '\n')
    plt.close(fig)
    manifest = {'scoresSha256': hashlib.sha256(raw).hexdigest(),
                'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'matplotlibVersion': matplotlib.__version__, 'predictions': report['completed'],
                'outputs': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir()}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    readme = args.review / 'README.md'
    with readme.open('a') as stream:
        stream.write('\n## Individual predictions\n\n![Every completed stock prediction and the saved native best](plots/poses.png)\n')
    print(json.dumps({'plot': str(output / 'poses.png'), 'predictions': report['completed']}))


if __name__ == '__main__':
    main()
