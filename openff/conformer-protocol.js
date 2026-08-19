// One source of truth for the conformer-search schedule.  The browser WebGPU
// synthesis and the serial OpenMM Reference benchmark both consume this exact
// stage list so timing comparisons cannot silently drift to different work.

export function conformerSearchProtocol(options = {}) {
  const effort = String(options.conformerEffort || 'balanced');
  const searchSteps = Math.max(50, Math.min(5000, Math.round(Number(
    options.conformerSearchSteps ?? ({ quick: 400, balanced: 1000, thorough: 2500 }[effort] || 1000),
  ))));
  const minimizationIterations = Math.max(10, Math.min(500, Math.round(Number(
    options.conformerMinimizationIterations
      ?? ({ quick: 60, balanced: 120, thorough: 240 }[effort] || 120),
  ))));
  const stages = [
    { label: 'ETKDG + MMFF seed', kind: 'seed', steps: 0 },
    { label: 'Sage initial minimization', kind: 'relax', steps: Math.round(minimizationIterations * 0.4) },
    { label: '600 K exploration', kind: 'dynamics', temperature: 600, collisionRate: 3, steps: Math.round(searchSteps * 0.28) },
    { label: '450 K cooling', kind: 'dynamics', temperature: 450, collisionRate: 4, steps: Math.round(searchSteps * 0.20) },
    { label: '300 K settling', kind: 'dynamics', temperature: 300, collisionRate: 6, steps: 0 },
    { label: 'Sage final minimization', kind: 'relax', steps: 0 },
  ];
  stages[4].steps = searchSteps
    - stages.filter((stage) => stage.kind === 'dynamics')
      .reduce((sum, stage) => sum + stage.steps, 0);
  stages.at(-1).steps = minimizationIterations - stages[1].steps;
  return {
    effort, searchSteps, minimizationIterations, stages,
    totalWork: searchSteps + minimizationIterations,
  };
}
