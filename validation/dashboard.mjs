function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}

function pretty(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toPrecision(digits).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, '$1') : '—';
}

function outcomeLabel(outcome) {
  return ({
    'success-feasible':'feasible',
    'success-infeasible-negative-control':'negative held',
    'preparation-blocked':'prep blocked',
    'parameterization-unsupported':'unsupported',
    'reference-contact-unavailable':'contact unavailable',
    'no-feasible-pose':'no feasible pose',
  })[outcome] || outcome;
}

function statusLabel(status) {
  return ({ complete:'Complete', 'registered-partial':'Registered · partial' })[status] || status;
}

export function validationDashboardHtml(registry) {
  const h = registry.headline;
  const docking = registry.studies.find(entry => entry.studyId === 'bioisostere-pose-propagation-v0.1');
  const parity = registry.studies.find(entry => entry.studyId === 'high-disruption-cross-runtime-2026-08-23');
  const studies = registry.studies.map(study => `
    <article class="validation-study-card">
      <div class="validation-study-heading">
        <div><strong>${escapeHtml(study.title)}</strong><span>${escapeHtml(study.evidenceLevel)}</span></div>
        <b data-validation-status="${escapeHtml(study.status)}">${escapeHtml(statusLabel(study.status))}</b>
      </div>
      <ul>${study.claims.map(claim => `<li>${escapeHtml(claim)}</li>`).join('')}</ul>
      <div class="validation-artifact-links">${study.artifactIds.map(id => {
        const item = registry.artifacts[id];
        return `<a href="${escapeHtml(item.href)}" download title="SHA-256 ${escapeHtml(item.sha256)}">${escapeHtml(id)}</a>`;
      }).join('')}</div>
    </article>`).join('');
  const rows = registry.cases.map(entry => `
    <tr data-validation-tier="${escapeHtml(entry.tier)}" data-validation-outcome="${escapeHtml(entry.terminalOutcome)}">
      <td><strong>${escapeHtml(entry.proteinTarget)}</strong><span>${escapeHtml(entry.referenceSystem)}</span></td>
      <td>${escapeHtml(entry.transformation)}</td>
      <td><span class="validation-outcome validation-outcome-${escapeHtml(entry.terminalOutcome)}">${escapeHtml(outcomeLabel(entry.terminalOutcome))}</span></td>
      <td>${entry.pairedCrystal ? `${pretty(entry.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom)} Å` : '—'}</td>
    </tr>`).join('');
  return `
    <p class="validation-dashboard-scope">${escapeHtml(registry.scope)}</p>
    <div class="validation-count-grid">
      <div><strong data-validation-count="reference-systems">${h.distinctReferenceSystems}</strong><span>reference complexes</span></div>
      <div><strong data-validation-count="cases">${h.registeredDockingCases}</strong><span>registered cases</span></div>
      <div><strong data-validation-count="targets">${h.uniqueProteinTargets}</strong><span>protein targets</span></div>
      <div><strong data-validation-count="crystal-scored">${h.pairedCrystalScored}</strong><span>crystal-scored</span></div>
    </div>
    <div class="validation-definition">${h.casesReachingPoseSearch}/${h.registeredDockingCases} cases reached pose search. The native/GPU gate contains ${h.nativeGpuPoseInstances} exact poses from one target; pose count is not system count.</div>
    <div class="validation-key-results">
      <div><span>Pose benchmark</span><strong>${pretty(docking.metrics.pairedCrystalBestOfFiveMedianAngstrom)} Å</strong><small>median best-of-5 over 5 crystal pairs</small></div>
      <div><span>Browser/native parity</span><strong>${pretty(parity.metrics.browserSageVsOpenmmWasmVacuumMaxEnergyDeltaKcalMol, 3)}</strong><small>max |ΔE| kcal/mol · 5 exact poses</small></div>
    </div>
    <div class="validation-study-grid">${studies}</div>
    <details class="validation-case-ledger">
      <summary>Case ledger <span>${registry.cases.length} preserved outcomes</span></summary>
      <div class="validation-table-wrap"><table>
        <thead><tr><th>Target / reference</th><th>Transformation</th><th>Outcome</th><th>Best-of-5</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>
    <details class="validation-counting-rules">
      <summary>Counting rules</summary>
      <dl>${Object.entries(registry.countingRules).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    </details>
    <p class="validation-registry-footer">Registry ${escapeHtml(registry.version)} · frozen ${escapeHtml(registry.frozenAt)} · <a href="./validation/registry.v0.1.json" download>download machine-readable ledger</a></p>`;
}

export async function mountValidationDashboard(root, href = './validation/registry.v0.1.json') {
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
    root.innerHTML = `<p class="validation-dashboard-error">Validation ledger unavailable · ${escapeHtml(error.message)}</p>`;
  } finally {
    root.removeAttribute('aria-busy');
  }
}
