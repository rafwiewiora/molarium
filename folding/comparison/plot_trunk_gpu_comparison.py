"""Plot saved matched-input errors; no model or GPU execution."""
from pathlib import Path
import hashlib
import json

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
import numpy as np

repo = Path(__file__).resolve().parents[2]
base = repo / 'reviews/cofold-feature-parity-2026-11-13'
inputs = [base / 'trained-trunk-apple/strict-fp32/analysis.json',
          base / 'trained-trunk-nvidia/strict-fp32/independent-replay.json',
          base / 'trained-trunk-nvidia/strict-fp32/independent-replay-plan.json',
          base / 'trained-trunk-nvidia/strict-fp32/measurement-receipt.json']
out = base / 'trained-trunk-nvidia/strict-fp32'
names = ['tap.trunk_in_single', 'tap.z_init_generic', 'tap.template_term',
         'tap.z_after_template', 'tap.msa_activations', 'tap.z_after_msa',
         'tap.trunk_out_pair', 'trunk-output-single']
labels = ['Single input', 'Pair initialization', 'Template contribution',
          'Pair + template', 'MSA features', 'Pair + MSA', 'Final pair', 'Final single']
apple, nvidia, plan, measurement = [json.loads(path.read_bytes()) for path in inputs]
sources = [apple, nvidia]
gates = {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True}
assert all(data['gates'] == gates for data in sources)
assert apple['fixtureReceiptSha256'] == plan['fixtureReceiptSha256'] == measurement['fixtureReceiptSha256']
assert nvidia['transport']['receiptSha256'] == plan['outputReceiptSha256'] == hashlib.sha256(inputs[3].read_bytes()).hexdigest()
fig, axes = plt.subplots(2, 2, figsize=(11, 9), constrained_layout=True)
for column, (title, data) in enumerate(zip(['Apple Metal-3', 'NVIDIA L4'], sources)):
    rows = {item['seam']: item for item in data['records']}
    assert len(rows) == 32 and all(item['finite'] for item in rows.values())
    for row, (key, norm, limit) in enumerate([
            ('relativeRms', LogNorm(1e-8, 1e-4), 1e-4),
            ('maxAbs', LogNorm(1e-6, 1), 1e-3)]):
        values = np.array([[rows[f'cycle-{cycle}.{name}'][key]
                            for cycle in range(4)] for name in names])
        ax = axes[row, column]
        image = ax.imshow(values, norm=norm, cmap='viridis', aspect='auto')
        ax.set_xticks(range(4), ['0', '1', '2', '3'])
        ax.set_yticks(range(8), labels if column == 0 else [''] * 8)
        ax.tick_params(axis='both', length=0, labelsize=9)
        ax.set_xlabel('Captured native pass', fontsize=9)
        metric = 'Relative RMS error' if row == 0 else 'Maximum absolute feature error'
        ax.set_title(f'{title} — {metric}', fontsize=10, pad=10)
        for y in range(8):
            for x in range(4):
                value = values[y, x]
                text = f'{value:.1e}' + ('*' if value > limit else '')
                color = 'black' if norm(value) > .63 else 'white'
                ax.text(x, y, text, ha='center', va='center', color=color, fontsize=8)
        bar = fig.colorbar(image, ax=ax, fraction=.05, pad=.025)
        bar.ax.tick_params(labelsize=8)
        bar.ax.axhline(limit, color='crimson', linewidth=1.4)
fig.suptitle('Matched-input strict-FP32 trunk: one STARD4 fixture\n'
             'Relative limit: 32/32 on both GPUs · Both limits: Apple 14/32, NVIDIA 16/32',
             fontsize=12)
fig.supxlabel('* Original absolute limit exceeded. Limits unchanged; no full-model or pose qualification.',
              fontsize=9)
png = out / 'cross-gpu-errors.png'
fig.savefig(png, dpi=170)
plt.close(fig)
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
receipt = {'scope': 'Saved numerical errors only; zero model calls.',
           'inputs': {str(path.relative_to(repo)): sha(path) for path in inputs},
           'scriptSha256': sha(Path(__file__)), 'pngSha256': sha(png),
           'gates': gates, 'newModelCalls': 0}
(out / 'plot-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
