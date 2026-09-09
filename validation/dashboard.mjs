function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}

function numerical(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Missing numerical comparison');
  return value.toExponential(2);
}

// Explicit numerical subset: archived docking studies are not dashboard claims.
export function validationDashboardHtml(registry) {
  const parity = registry.studies.find(entry =>
    entry.studyId === 'high-disruption-cross-runtime-2026-08-23');
  if (!parity?.metrics || !parity.counts) throw new Error('Numerical evidence unavailable');
  const m = parity.metrics;
  const comparisons = [
    ['Same OpenMM C interface: WebAssembly vs native',
      m.openmmWasmVsNativeReferenceMaxEnergyDeltaKcalMol,
      m.openmmWasmVsNativeReferenceMaxForceRelativeRms, 'openmmNative'],
    ['Browser Sage vs OpenMM WebAssembly · vacuum',
      m.browserSageVsOpenmmWasmVacuumMaxEnergyDeltaKcalMol,
      m.browserSageVsOpenmmWasmVacuumMaxForceRelativeRms, 'browserVacuum'],
    ['Browser Sage vs OpenMM WebAssembly · OBC2',
      m.browserSageVsOpenmmWasmObc2MaxEnergyDeltaKcalMol,
      m.browserSageVsOpenmmWasmObc2MaxForceRelativeRms, 'browserObc2'],
  ];
  const rows = comparisons.map(([label, energy, force, id]) => {
    const artifact = registry.artifacts[id];
    if (!artifact || !/^\.\/docking\/validation\/cloud-panel\/[\w.-]+\.json$/.test(artifact.href)
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Invalid numerical evidence link');
    return `<tr data-validation-comparison="${id}"><th scope="row">${label}</th>
      <td>${numerical(energy)}</td><td>${numerical(force)}</td>
      <td><a href="${escapeHtml(artifact.href)}" download title="SHA-256 ${artifact.sha256}">Raw results</a></td></tr>`;
  }).join('');
  return `
    <p class="validation-dashboard-scope">Numerical implementation checks on matched inputs.
      These comparisons test energies and forces, not docking pose accuracy,
      binding affinity, or force-field accuracy against experiment.</p>
    <article class="validation-study-card">
      <div class="validation-study-heading"><strong>Fixed-input cross-runtime agreement</strong></div>
      <p>${escapeHtml(parity.counts.hashSelectedPoseInstances)} exact configurations from
        ${escapeHtml(parity.counts.analogueChemistries)} analogue chemistries of the
        7KPA/D84 complex: one reference system, not five independent systems.
        Graphs, coordinates, parameters and solvent settings are matched.</p>
      <div class="validation-table-wrap"><table class="validation-numerical-table">
        <thead><tr><th scope="col">Comparison</th><th scope="col">Max |ΔE| (kcal/mol)</th>
        <th scope="col">Max relative force RMS (unitless)</th><th scope="col">Evidence</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p>The WebAssembly/native row checks compilation of the same C interface.
        The browser Sage rows use that WebAssembly reference; they are not a
        separate, independently constructed native oracle.</p>
    </article>
    <article class="validation-study-card">
      <div class="validation-study-heading"><strong>Independent native OpenMM comparisons</strong></div>
      <p>The broader WebGPU suite compares every Cartesian force with independently
        constructed native OpenMM systems. Reports distinguish fixed-f32-input
        agreement from original-input precision limits, and identify tested hardware.</p>
      <div class="validation-artifact-links">
        <a href="https://github.com/rafwiewiora/molarium/tree/main/benchmarks/simulation">Protocol and reproduction</a>
        <a href="https://github.com/rafwiewiora/molarium/tree/main/benchmarks/simulation/results">Measured results and limitations</a>
        <a href="https://github.com/rafwiewiora/molarium/blob/main/benchmarks/simulation/results/STORMM.md">STORMM/native comparison scope</a>
      </div>
    </article>
    <p class="validation-registry-footer">Numerical subset of registry ${escapeHtml(registry.version)}
      · frozen ${escapeHtml(registry.frozenAt)}. A passing check applies only to its specified fixtures and protocol.</p>`;
}

export async function mountValidationDashboard(root, href = './validation/registry.v0.2.json') {
  if (!root || root.dataset.validationMounted === 'true') return;
  root.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(href, { cache:'no-cache' });
    if (!response.ok) throw new Error(`Registry request failed (${response.status})`);
    const registry = await response.json();
    if (registry.schema !== 'molarium.validation-registry/v1') throw new Error('Unsupported validation registry');
    root.innerHTML = validationDashboardHtml(registry);
    root.dataset.validationMounted = 'true';
  } catch (error) {
    root.innerHTML = `<p class="validation-dashboard-error">Numerical evidence unavailable · ${escapeHtml(error.message)}</p>`;
  } finally {
    root.removeAttribute('aria-busy');
  }
}
