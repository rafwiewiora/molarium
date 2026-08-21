/* RDKit 2025.03.4 MinimalLib + Molarium's thin force-field bridge.
 * MMFF94 and UFF are RDKit implementations; energies are kcal/mol. */

self.importScripts('./rdkit/dist/RDKit_minimal.js');
self.importScripts('./rdkit/dimorphite-sites.js');

const MAX_V2000_ATOMS = 999;
let modulePromise;

function progress(id, phase, model, calculation) {
  self.postMessage({ type: 'progress', id, phase, model, calculation });
}

function getRDKit(id) {
  if (!modulePromise) {
    progress(id, 'Loading RDKit WebAssembly…', 0.12, 0);
    modulePromise = self.initRDKitModule({
      locateFile: (file) => new URL(`./rdkit/dist/${file}`, self.location.href).href,
    }).catch((error) => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

function fixed(value, width, decimals = 0) {
  const formatted = decimals ? Number(value).toFixed(decimals) : String(Math.trunc(value));
  if (formatted.length > width) throw new Error(`Molfile field ${formatted} exceeds V2000 limits`);
  return formatted.padStart(width, ' ');
}

function moleculeToMolBlock(molecule) {
  if (!molecule?.atoms?.length) throw new Error('The molecule is empty');
  if (molecule.atoms.length > MAX_V2000_ATOMS || molecule.bonds.length > MAX_V2000_ATOMS) {
    const lines = [
      String(molecule.name || 'Molarium molecule').slice(0, 80),
      '  Molarium 3D', '', '  0  0  0     0  0            999 V3000',
      'M  V30 BEGIN CTAB', `M  V30 COUNTS ${molecule.atoms.length} ${molecule.bonds.length} 0 0 0`,
      'M  V30 BEGIN ATOM',
    ];
    molecule.atoms.forEach((atom, index) => {
      const element = String(atom.element || '').trim();
      if (!/^[A-Z][a-z]?$/.test(element)) throw new Error(`Invalid element ${element || '(empty)'}`);
      const charge = Math.trunc(Number(atom.charge || 0));
      lines.push(`M  V30 ${index + 1} ${element} ${Number(atom.x).toFixed(6)} ${Number(atom.y).toFixed(6)} ${Number(atom.z).toFixed(6)} 0${charge ? ` CHG=${charge}` : ''}`);
    });
    lines.push('M  V30 END ATOM', 'M  V30 BEGIN BOND');
    molecule.bonds.forEach((bond, index) => {
      const order = Number(bond.order || 1);
      const type = Math.abs(order - 1.5) < 0.1 ? 4 : Math.max(1, Math.min(3, Math.round(order)));
      lines.push(`M  V30 ${index + 1} ${type} ${bond.a + 1} ${bond.b + 1}`);
    });
    lines.push('M  V30 END BOND', 'M  V30 END CTAB', 'M  END');
    return lines.join('\n');
  }

  const lines = [
    String(molecule.name || 'Molarium molecule').slice(0, 80),
    '  Molarium 3D',
    '',
    `${fixed(molecule.atoms.length, 3)}${fixed(molecule.bonds.length, 3)}  0  0  0  0            999 V2000`,
  ];
  molecule.atoms.forEach((atom) => {
    const element = String(atom.element || '').trim();
    if (!/^[A-Z][a-z]?$/.test(element)) throw new Error(`Invalid element ${element || '(empty)'}`);
    lines.push(`${fixed(atom.x, 10, 4)}${fixed(atom.y, 10, 4)}${fixed(atom.z, 10, 4)} ${element.padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  molecule.bonds.forEach((bond) => {
    const order = Number(bond.order || 1);
    const type = Math.abs(order - 1.5) < 0.1 ? 4 : Math.max(1, Math.min(3, Math.round(order)));
    lines.push(`${fixed(bond.a + 1, 3)}${fixed(bond.b + 1, 3)}${fixed(type, 3)}  0  0  0  0`);
  });

  const charges = molecule.atoms
    .map((atom, index) => ({ index: index + 1, charge: Math.trunc(Number(atom.charge || 0)) }))
    .filter((entry) => entry.charge);
  for (let offset = 0; offset < charges.length; offset += 8) {
    const group = charges.slice(offset, offset + 8);
    lines.push(`M  CHG${fixed(group.length, 3)}${group.map((entry) => `${fixed(entry.index, 4)}${fixed(entry.charge, 4)}`).join('')}`);
  }
  lines.push('M  END');
  return lines.join('\n');
}

function packFrames(frames, atomCount) {
  const stride = atomCount * 3;
  const frameEnergies = Float64Array.from(frames, (frame) => frame.energy);
  const frameSteps = Int32Array.from(frames, (frame) => frame.step);
  const trajectory = new Float64Array(frames.length * stride);
  frames.forEach((frame, index) => {
    if (!Array.isArray(frame.positions) || frame.positions.length !== stride)
      throw new Error('RDKit returned an invalid trajectory frame');
    trajectory.set(frame.positions, index * stride);
  });
  return { frameEnergies, frameSteps, trajectory };
}

function scoreMolBlock(module, molBlock) {
  let candidateMol;
  try {
    candidateMol = module.get_mol(molBlock, JSON.stringify({
      sanitize:true, removeHs:false, strictParsing:true,
    }));
    if (!candidateMol) throw new Error('RDKit could not read an embedded conformer');
    const score = JSON.parse(candidateMol.run_forcefield('energy', 1, 1, 1, 300, 2, '[]'));
    if (score.error || !Number.isFinite(score.finalEnergy)) throw new Error(score.error || 'non-finite energy');
    return { energy:score.finalEnergy, forcefield:score.forcefield, fallback:Boolean(score.fallback) };
  } finally { candidateMol?.delete(); }
}

async function runCalculation(message) {
  const { id, job, molecule, options = {} } = message;
  const started = performance.now();
  const module = await getRDKit(id);
  if (job === 'depict') {
    if (!molecule?.atoms?.length || molecule.atoms.length > 256)
      throw new Error('2D depiction supports molecular components with 1–256 atoms');
    let rdMol, templateMol;
    try {
      rdMol = module.get_mol(moleculeToMolBlock(molecule), JSON.stringify({
        sanitize:false, removeHs:false, strictParsing:false,
      }));
      if (!rdMol) throw new Error('RDKit could not read this molecular component');
      let alignedToTemplate = false;
      if (options.alignmentTemplateMolBlock) {
        try {
          templateMol = module.get_mol(String(options.alignmentTemplateMolBlock), JSON.stringify({
            sanitize:false, removeHs:false, strictParsing:false,
          }));
          if (templateMol) {
            rdMol.generate_aligned_coords(templateMol, JSON.stringify({
              useCoordGen:true, allowRGroups:true, acceptFailure:false,
            }));
            alignedToTemplate = true;
          }
        } catch { alignedToTemplate = false; }
      }
      if (!alignedToTemplate && !rdMol.set_new_coords())
        throw new Error('RDKit could not generate 2D coordinates');
      const selected = Array.from(options.selectedAtomIndices || [], Number)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length);
      const selectedSet = new Set(selected);
      const selectedBonds = molecule.bonds.flatMap((bond, index) =>
        selectedSet.has(bond.a) && selectedSet.has(bond.b) ? [index] : []);
      const color = [0.09, 0.53, 0.72];
      const atomColors = Object.fromEntries(selected.map((index) => [index, color]));
      const bondColors = Object.fromEntries(selectedBonds.map((index) => [index, color]));
      const svg = rdMol.get_svg_with_highlights(JSON.stringify({
        width:260, height:184, atoms:selected, bonds:selectedBonds,
        atomColors, bondColors, highlightRadius:0.27,
      }));
      if (typeof svg !== 'string' || !svg.includes('<svg'))
        throw new Error('RDKit returned an invalid 2D depiction');
      self.postMessage({
        type:'result', id, job, svg, atomCount:molecule.atoms.length,
        alignmentTemplateMolBlock:rdMol.get_molblock(JSON.stringify({ kekulize:false })),
        alignedToTemplate,
        rdkitVersion:module.version?.() || null, elapsedMs:performance.now() - started,
        platform:'WebAssembly', backend:'RDKit MolDraw2D',
      });
      return;
    } finally { templateMol?.delete(); rdMol?.delete(); }
  }
  if (job === 'protonation') {
    const smiles = String(options.smiles || '').trim();
    if (!smiles) throw new Error('A SMILES string is required');
    const targetPh = Number(options.ph ?? 7.4);
    const phSpread = Math.max(0, Math.min(4, Number(options.phSpread ?? 0.5)));
    if (!Number.isFinite(targetPh) || targetPh < 0 || targetPh > 14)
      throw new Error('Target pH must be between 0 and 14');
    progress(id, 'Detecting ionizable sites with RDKit…', 0.68, 0.18);
    const rdMol = module.get_mol(smiles, JSON.stringify({ sanitize:true, removeHs:false }));
    if (!rdMol) throw new Error('RDKit could not parse this SMILES string');
    try {
      const source = self.MOLARIUM_DIMORPHITE;
      const raw = rdMol.enumerate_protonation_states(
        source.siteData,
        Math.max(0, targetPh - phSpread),
        Math.min(14, targetPh + phSpread),
        Math.max(0, Math.min(4, Number(options.precision ?? 1))),
        Math.max(1, Math.min(64, Math.round(Number(options.maxStates ?? 16)))),
      );
      const parsed = JSON.parse(raw);
      if (parsed.error) throw new Error(parsed.error);
      if (!Array.isArray(parsed.states) || !parsed.states.length)
        throw new Error('No valid protonation state was generated');
      progress(id, `Ranked ${parsed.states.length} protonation state${parsed.states.length === 1 ? '' : 's'}…`, 1, 1);
      self.postMessage({
        type:'result', id, job, ...parsed,
        source:{ name:'Dimorphite-DL', version:source.version, revision:source.revision,
          license:source.license, url:source.source },
        elapsedMs:performance.now() - started, platform:'WebAssembly', backend:'RDKit + Dimorphite-DL sites',
      });
      return;
    } finally { rdMol.delete(); }
  }
  if (job === 'smiles-embed') {
    const smiles = String(options.smiles || '').trim();
    if (!smiles) throw new Error('A SMILES string is required');
    progress(id, 'Parsing SMILES with RDKit…', 0.58, 0.04);
    const rdMol = module.get_mol(smiles, JSON.stringify({ sanitize:true, removeHs:false }));
    if (!rdMol) throw new Error('RDKit could not parse this SMILES string');
    try {
      rdMol.add_hs_in_place();
      progress(id, 'Generating ETKDGv3 starting structures…', 0.78, 0.18);
      const raw = rdMol.generate_conformers(
        Math.max(1, Math.min(32, Math.round(Number(options.conformerCount ?? 8)))),
        Math.round(Number(options.conformerSeed ?? 20260817)),
        Math.max(0, Number(options.conformerPruneRms ?? 0.35)),
        Math.max(0, Math.round(Number(options.conformerMinimizeIterations ?? 100))),
      );
      const parsed = JSON.parse(raw);
      if (parsed.error) throw new Error(parsed.error);
      if (!Array.isArray(parsed.conformers) || !parsed.conformers.length)
        throw new Error('RDKit ETKDGv3 returned no conformers');
      progress(id, `Ranking ${parsed.conformers.length} embedded conformers…`, 0.96, 0.82);
      const candidates = parsed.conformers.map((_, conformer) => {
        const molBlock = rdMol.get_molblock(JSON.stringify({ confId:conformer, kekulize:false }));
        try { return { molBlock, ...scoreMolBlock(module, molBlock) }; }
        catch { return { molBlock, energy:Number.POSITIVE_INFINITY, forcefield:'', fallback:false }; }
      });
      let bestIndex = 0;
      for (let index = 1; index < candidates.length; index++)
        if (candidates[index].energy < candidates[bestIndex].energy) bestIndex = index;
      const best = candidates[bestIndex];
      progress(id, `Selected ETKDGv3 conformer ${bestIndex + 1}/${candidates.length}…`, 1, 0.96);
      self.postMessage({
        type:'result', id, job, molBlock:best.molBlock, conformerCount:candidates.length, bestIndex,
        conformerEnergies:candidates.map(({ energy }) => Number.isFinite(energy) ? energy : null),
        finalEnergy:Number.isFinite(best.energy) ? best.energy : null,
        forcefield:best.forcefield || parsed.preparationForcefield || 'ETKDGv3',
        fallback:best.fallback || parsed.preparationForcefield === 'UFF',
        requestedCount:parsed.requestedCount, embeddedCount:parsed.embeddedCount,
        minimizedCount:parsed.minimizedCount, conformerMethod:parsed.method,
        conformerSeed:parsed.randomSeed, pruneRmsThreshold:parsed.pruneRmsThreshold,
        canonicalSmiles:rdMol.get_smiles(), rdkitVersion:module.version?.() || null,
        elapsedMs:performance.now() - started, platform:'WebAssembly', backend:'RDKit ETKDGv3',
      });
      return;
    } finally { rdMol.delete(); }
  }
  progress(id, 'Reading structure and assigning atom types…', 0.62, 0.04);
  const rdMol = module.get_mol(moleculeToMolBlock(molecule), JSON.stringify({
    sanitize: true,
    removeHs: false,
    strictParsing: true,
  }));
  if (!rdMol) throw new Error('RDKit could not read the current structure');

  let parsed;
  let fixedAtomIndices = [];
  try {
    if (job === 'sanitize') {
      progress(id, 'Sanitizing valence and aromaticity with RDKit…', 1, 0.85);
      const canonicalSmiles = rdMol.get_smiles();
      self.postMessage({ type:'result', id, job, canonicalSmiles,
        elapsedMs:performance.now() - started, rdkitVersion:module.version?.() || null,
        platform:'WebAssembly', backend:'RDKit', unit:null });
      return;
    }
    if (job === 'conformers' || job === 'embed') {
      progress(id, 'Generating diverse ETKDGv3 conformers…', 0.76, 0.18);
      const raw = rdMol.generate_conformers(
        Math.max(1, Math.min(256, Math.round(Number(options.conformerCount ?? (job === 'embed' ? 8 : 64))))),
        Math.round(Number(options.conformerSeed ?? 20260817)),
        Math.max(0, Number(options.conformerPruneRms ?? 0.35)),
        Math.max(0, Math.round(Number(options.conformerMinimizeIterations ?? 100))),
      );
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`RDKit returned malformed ETKDG data (${raw?.length || 0} bytes)`);
      }
      if (parsed.error) throw new Error(parsed.error);
      if (!Array.isArray(parsed.conformers) || !parsed.conformers.length)
        throw new Error('RDKit ETKDGv3 returned no conformers');
      const stride = molecule.atoms.length * 3;
      const conformerCount = parsed.conformers.length;
      const conformers = new Float32Array(conformerCount * stride);
      parsed.conformers.forEach((positions, index) => {
        if (!Array.isArray(positions) || positions.length !== stride
          || positions.some((value) => !Number.isFinite(value)))
          throw new Error(`RDKit ETKDGv3 conformer ${index + 1} is invalid`);
        conformers.set(positions, index * stride);
      });
      if (job === 'embed') {
        progress(id, `Ranking ${conformerCount} embedded conformers…`, 0.96, 0.82);
        const energies = [];
        const forcefields = [];
        for (let conformer = 0; conformer < conformerCount; conformer++) {
          const positions = parsed.conformers[conformer];
          const candidate = {
            ...molecule,
            atoms:molecule.atoms.map((atom, atomIndex) => ({
              ...atom,
              x:positions[atomIndex * 3], y:positions[atomIndex * 3 + 1], z:positions[atomIndex * 3 + 2],
            })),
          };
          try {
            const score = scoreMolBlock(module, moleculeToMolBlock(candidate));
            energies.push(score.energy); forcefields.push(score.forcefield);
          } catch {
            energies.push(Number.POSITIVE_INFINITY); forcefields.push('');
          }
        }
        let bestIndex = 0;
        for (let index = 1; index < energies.length; index++)
          if (energies[index] < energies[bestIndex]) bestIndex = index;
        if (!Number.isFinite(energies[bestIndex])) bestIndex = 0;
        const positions = Float64Array.from(parsed.conformers[bestIndex]);
        progress(id, `Selected ETKDGv3 conformer ${bestIndex + 1}/${conformerCount}…`, 1, 0.96);
        const result = {
          type:'result', id, job, positions, conformerCount, bestIndex,
          conformerEnergies:energies.map((energy) => Number.isFinite(energy) ? energy : null),
          finalEnergy:Number.isFinite(energies[bestIndex]) ? energies[bestIndex] : null,
          forcefield:forcefields[bestIndex] || parsed.preparationForcefield || 'ETKDGv3',
          fallback:(forcefields[bestIndex] || parsed.preparationForcefield) === 'UFF',
          requestedCount:parsed.requestedCount, embeddedCount:parsed.embeddedCount,
          minimizedCount:parsed.minimizedCount, conformerMethod:parsed.method,
          conformerSeed:parsed.randomSeed, pruneRmsThreshold:parsed.pruneRmsThreshold,
          elapsedMs:performance.now() - started, platform:'WebAssembly', backend:'RDKit ETKDGv3',
        };
        self.postMessage(result, [positions.buffer]);
        return;
      }
      progress(id, `Generated ${conformerCount} symmetry-pruned conformers…`, 1, 0.96);
      const result = {
        type: 'result', id, job, conformerCount, conformers,
        requestedCount: parsed.requestedCount,
        embeddedCount: parsed.embeddedCount,
        minimizedCount: parsed.minimizedCount,
        preparationForcefield: parsed.preparationForcefield,
        conformerMethod: parsed.method,
        conformerSeed: parsed.randomSeed,
        pruneRmsThreshold: parsed.pruneRmsThreshold,
        elapsedMs: performance.now() - started,
        platform: 'WebAssembly', backend: 'RDKit ETKDGv3',
      };
      self.postMessage(result, [conformers.buffer]);
      return;
    }
    const phase = job === 'geometry' ? 'Optimizing with MMFF94…'
      : job === 'dynamics' ? 'Running MMFF94 molecular dynamics…'
        : 'Evaluating MMFF94 potential energy…';
    progress(id, phase, 1, 0.16);
    fixedAtomIndices = Array.isArray(options.fixedAtomIndices)
      || ArrayBuffer.isView(options.fixedAtomIndices)
      ? [...options.fixedAtomIndices].map(Number) : [];
    if (fixedAtomIndices.some((index) => !Number.isInteger(index)
        || index < 0 || index >= molecule.atoms.length)
        || new Set(fixedAtomIndices).size !== fixedAtomIndices.length)
      throw new Error('Fixed atom indices must be unique valid atom indices');
    if (fixedAtomIndices.length && job !== 'geometry')
      throw new Error('Fixed atoms are supported only for geometry optimization');
    if (fixedAtomIndices.length >= molecule.atoms.length)
      throw new Error('Geometry optimization requires at least one movable atom');
    const raw = rdMol.run_forcefield(
      job,
      Math.max(1, Number(options.maxIterations ?? 750)),
      Math.max(1, Number(options.snapshotFrequency ?? 25)),
      Math.max(1, Number(options.steps ?? 250)),
      Number(options.temperature ?? 300),
      Math.max(2, Number(options.savedFrameCount ?? 26)),
      JSON.stringify(fixedAtomIndices),
    );
    if (typeof raw !== 'string' || !raw.trim())
      throw new Error(`RDKit could not parameterize ${rdMol.get_smiles() || 'the current structure'}`);
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`RDKit returned malformed force-field data (${raw.length} bytes): ${raw.slice(0, 160)}`);
    }
    if (parsed.error) throw new Error(parsed.error);
  } finally {
    rdMol.delete();
  }

  if (!Array.isArray(parsed.frames) || !parsed.frames.length)
    throw new Error('RDKit returned no calculation frames');
  // V2000 mol blocks store coordinates to four decimal places. Fixed atoms
  // must remain exact in the editor, so restore their original browser-side
  // coordinates after RDKit has optimized the movable neighborhood.
  if (fixedAtomIndices.length) parsed.frames.forEach((frame) => {
    fixedAtomIndices.forEach((index) => {
      frame.positions[index * 3] = molecule.atoms[index].x;
      frame.positions[index * 3 + 1] = molecule.atoms[index].y;
      frame.positions[index * 3 + 2] = molecule.atoms[index].z;
    });
  });
  progress(id, 'Collecting RDKit results…', 1, 0.94);
  const { frameEnergies, frameSteps, trajectory } = packFrames(parsed.frames, molecule.atoms.length);
  const positions = trajectory.slice(trajectory.length - molecule.atoms.length * 3);
  const result = {
    type: 'result',
    id,
    job,
    initialEnergy: parsed.initialEnergy,
    finalEnergy: parsed.finalEnergy,
    positions,
    elapsedMs: performance.now() - started,
    forcefield: parsed.forcefield,
    fallback: Boolean(parsed.fallback),
    converged: Boolean(parsed.converged),
    rdkitVersion: parsed.rdkitVersion,
    platform: 'WebAssembly',
    backend: 'RDKit',
    unit: 'kcal/mol',
    timestepFs: job === 'dynamics' ? 0.1 : null,
    fixedAtomCount: Number(parsed.fixedAtomCount || 0),
    movableAtomCount: Number(parsed.movableAtomCount || molecule.atoms.length),
    frameCount: parsed.frames.length,
    frameEnergies,
    frameSteps,
    trajectory,
  };
  self.postMessage(result, [positions.buffer, frameEnergies.buffer, frameSteps.buffer, trajectory.buffer]);
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'run') return;
  runCalculation(event.data).catch((error) => {
    self.postMessage({
      type: 'error',
      id: event.data.id,
      message: `${event.data.job}: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
});
