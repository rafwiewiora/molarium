// DV-04: operation policies must be readable without running an experiment.
// Keep the complete catalogue, but show adjacent buttons only for consequential
// scientific choices. Routine controls must not become a wall of help icons.
import {WORKSPACE_HELP} from './workspace-help.mjs';
export const DESIGN_HELP = {
  ...WORKSPACE_HELP,
  'docking-mode': {
    title:'Reference-guided ligand search',
    text:'Both methods keep the protein fixed. Required H-bonds guide the search and must pass its acceptance gate. Neither method is pocket relaxation.',
    choices:{
      propagate:'Start from the captured ligand pose. Sample edited groups and edit-associated torsions; affected inherited atoms can move, while the remaining protected core stays fixed. UI uses v5 seeding and automatic worker execution; legacy protocol/execution overrides are API-only.',
      'selected-core':'Expert mode: select at least three ligand heavy atoms as an explicit fixed core before capture; search the remainder against the fixed receptor.',
    },
  },
  'docking-edit-cleanup': {
    title:'Ligand cleanup after chemistry edits',
    text:'This controls ligand-only cleanup, not protein motion or the later constrained search. The receptor and required H-bonds are not forces in this cleanup.',
    choices:{
      'preserve-reference':'Keep surviving reference heavy atoms fixed during ligand cleanup; settle new atoms and hydrogens. Subsequent constrained search can explicitly release edit-associated torsions.',
      'free-local':'Allow ligand coordinates to relax during local cleanup. The reference is still retained for later propagation; this setting does not turn on induced fit.',
    },
  },
  'capture-docking-reference': {title:'Capture the design reference', text:'Capture the prepared ligand pose, receptor and contact hypotheses before editing. Propagation protects the inherited core except declared edit-associated motion. Expert mode instead captures your selected core. Review which contacts are required; weak covalent-fluorine hypotheses are optional by default.'},
  'update-docking-receptor': {title:'Accept the moved receptor', text:'Replace the captured receptor coordinates with the current receptor, preserving the ligand reference and contact choices. Use after a rotamer branch or pocket relaxation, then re-run constrained ligand search. This does not itself minimize or certify contacts.'},
  'clear-docking-reference': {title:'Reset the design reference', text:'Clear the captured reference, contact hypotheses and search results. This does not restore the molecule’s old coordinates. Capture a fresh reference to start another design comparison.'},
  'add-docking-contact': {title:'Add a required H-bond hypothesis', text:'Pick a ligand donor or acceptor, then a complementary receptor atom. The proposed contact need not exist geometrically yet. It becomes a required ligand-search acceptance condition—not a restraint in Pocket relax or Induced-fit pocket.'},
  'cancel-docking-contact': {title:'Cancel contact picking', text:'Stop picking a new contact. Existing contact hypotheses and their required/optional choices are unchanged.'},
  'docking-conformer-count': {
    title:'Search effort', text:'Independent candidate chains explore torsions. More chains cost more time and improve coverage; they are not a count of distinct poses or a guarantee of success.',
    choices:{'8':'Quick check: eight chains.', '16':'Default effort: sixteen chains.', '32':'Broader exploration: thirty-two chains.', '64':'Largest UI budget: sixty-four chains. API runs can expose additional execution/protocol controls.'},
  },
  'run-constrained-docking': {title:'Run constrained ligand search', text:'Search edited ligand groups against a fixed protein, enforcing required H-bonds. Protected core atoms stay fixed; edit-associated torsions can release other inherited atoms. Receptor-aware scoring and safeguarded ligand-only cleanup rank feasible candidates. Review and Apply pose separately.'},
  'build-optimizer-select': {
    title:'Compare optimization methods',
    text:'Optimization is local energy minimization, not a search over discrete rotamer branches. None of these methods applies the required-contact restraints used by constrained ligand search. Inspect contacts again afterward.',
    choices:{
      webgpu:'Minimize the numeric force-field system on WebGPU. All eligible atoms move; this is not a fixed-protein ligand search. The full-complex choice is not offered in Design for protein–ligand systems.',
      'pocket-webgpu':'5 Å pocket: move the entire ligand and nearby protein side chains. Protein backbone and outer atoms stay fixed. Required H-bonds are NOT enforced.',
      'induced-fit-webgpu':'Experimental 6 Å pocket: move whole nearby protein residues, including backbone, plus eligible ligand/water atoms. Registered ligand-retention islands and outer atoms stay fixed. Its retained ligand set can differ from the search core. Required H-bonds are NOT enforced.',
      'ligand-rdkit':'MMFF94/UFF ligand-only cleanup; protein fixed and omitted from the energy. Preserve reference fixes surviving reference heavy atoms when active. This cannot assess pocket clashes or enforce receptor H-bonds.',
      rdkit:'Local small-molecule MMFF94 optimization, with UFF fallback when needed. Not available for prepared protein systems; no receptor-contact restraints.',
      ani2x:'Local ANI-2x machine-learning minimization for supported neutral H/C/N/O/F/S/Cl molecules. Not offered for protein–ligand complexes; no receptor-contact restraints.',
    },
  },
  'optimize-button': {title:'Optimize with the selected method', text:'Run the currently selected minimizer. This is separate from constrained ligand search and does not enforce its required H-bonds. A designer-fixed ligand pose or unfinished chemistry can block optimization.', choiceSelector:'#build-optimizer-select'},
  'undo-atom': {title:'Undo the last molecular edit', text:'Restore the preceding undoable molecular state, including coordinates. This is local editing history, distinct from named Design History campaign commits.'},
  'redo-atom': {title:'Redo an undone edit', text:'Reapply the next undone molecular state. A new edit can replace the redo path; use a campaign branch to preserve alternative design histories.'},
  'enumerate-sidechain-rotamers': {title:'Enumerate discrete side-chain branches', text:'Select one atom of a protein side chain. Generate canonical chi-angle candidates and pre-rank by steric overlap. This is not minimization, an affinity score, or an H-bond guarantee.'},
  'sidechain-rotamer-select': {title:'Choose a side-chain rotamer', text:'Candidate labels describe the proposed chi-angle branch and steric pre-ranking. Selecting one does not apply it. After relaxation, the actual chi angles may differ from the seed label.'},
  'apply-sidechain-rotamer': {title:'Apply a receptor branch', text:'Move the selected side chain discretely; the ligand and protein backbone stay fixed. No energy minimization runs here. Recheck contacts, update the moved receptor reference, and re-run ligand search when appropriate.'},
  'geometry-slider': {title:'Adjust selected geometry', text:'Select two atoms for bond length (Å), three bonded atoms for angle (degrees), or four for torsion (degrees). This directly edits coordinates; it does not minimize energy or enforce H-bonds.'},
  'geometry-value': {title:'Set a precise geometry value', text:'Enter the selected bond length in Å or angle/torsion in degrees. “Move connected atoms” controls whether the attached group follows. This is a coordinate edit, not constrained ligand search.'},
  'move-connected': {title:'Move the attached group', text:'On: move the connected group when changing a bond, angle or torsion. Off: move only the directly adjusted atom. Neither choice is an energy relaxation or a promise to preserve contacts.'},
  'designer-ligand-pose-lock': {title:'Hold the designer’s ligand pose', text:'Lock the current ligand coordinates as explicit intent. Ligand search, pose application, and ligand-moving minimizers are blocked; receptor-only side-chain branches remain possible. This whole-ligand lock is stronger than propagation’s protected core.'},
  'chemistry-element': {title:'Change the selected atom’s element', text:'Choose the element, then Apply atom. This edits atom identity/valence, not just its display color; Finish changes validates the full chemical state and reconciles hydrogens.', choices:{H:'Hydrogen', B:'Boron', C:'Carbon', N:'Nitrogen', O:'Oxygen', F:'Fluorine', Si:'Silicon', P:'Phosphorus', S:'Sulfur', Cl:'Chlorine', Br:'Bromine', I:'Iodine'}},
  'chemistry-formal-charge': {title:'Set formal charge', text:'Integer formal charge on the selected atom (−4 to +4 in this control). It is chemical bookkeeping, not the force-field partial charge; partial charges are derived during parameterization.'},
  'apply-atom-chemistry': {title:'Apply atom chemistry', text:'Stage the selected element and formal charge for one atom. Complete related bond/charge edits before Finish changes, unless automatic finishing is enabled.'},
  'chemistry-bond-order': {title:'Choose bond chemistry', text:'Choose the order for two selected atoms, then Set bond. Aromatic edits require chemically consistent complete rings; invalid valence or aromatic states are rejected.', choices:{'1':'Single covalent bond.', '2':'Double covalent bond.', '3':'Triple covalent bond.', '1.5':'Aromatic ring bond—not a free-standing fractional bond. Complete the ring’s chemical state before finishing.'}},
  'apply-bond-chemistry': {title:'Set a bond', text:'Create or change the bond between two selected atoms using the chosen order. This edits the molecular graph; it is separate from changing a bond’s length.'},
  'delete-bond-chemistry': {title:'Delete a bond', text:'Remove the selected atoms’ bond from the chemical graph. Complete the resulting valence state before finishing. This can disconnect fragments and invalidate a required contact’s feature.'},
  'add-explicit-hydrogen': {title:'Add an explicit hydrogen', text:'Attach one explicit hydrogen to the selected atom. Use the atom’s charge and bond orders to specify a consistent protonation state; Finish changes validates the result.'},
  'remove-explicit-hydrogen': {title:'Remove an explicit hydrogen', text:'Remove an attached explicit hydrogen from the selected atom. This can remove an H-bond donor; required contacts remain design decisions, not permission to invent a replacement donor.'},
  'delete-selected-atom': {title:'Delete the selected atom', text:'Remove the atom and its attached bonds. Complete chemistry afterward. If a required contact loses its compatible feature, search must wait for an explicit redesign or omission.'},
  'finish-chemistry-changes': {title:'Finish the complete chemical edit', text:'Validate the staged graph, reconcile hydrogens, and perform the selected ligand cleanup. This is not the separate constrained ligand search or pocket relaxation.'},
  'discard-chemistry-changes': {title:'Discard pending chemistry', text:'Restore the state before the current unfinished group of chemical edits. This does not delete saved campaign commits.'},
  'chemistry-immediate-refine': {title:'Finish after each edit', text:'On: validate and clean up each atom/bond edit immediately. Off: stage several related edits, then Finish changes once the complete chemical state is valid. “Refine” here means chemistry cleanup, not the constrained pose search.'},
  'apply-docking-pose': {title:'Apply the reviewed ligand pose', text:'Install the selected feasible search candidate. Required-contact and state guards must pass; a failed candidate is not silently accepted. Inspect current contacts again after any later coordinate changes.'},
  'download-docking-labbook': {title:'Download readable search notes', text:'Export human-readable search provenance, protocol, hypotheses and candidate results. This records the search, not an experimental affinity measurement.'},
  'download-docking-audit': {title:'Download the machine-readable search audit', text:'Export JSON with the search protocol, constraints, candidates and provenance for independent inspection. Distinct poses and candidate chains are different quantities.'},
  'custom-fragment-smiles': {title:'Specify a custom fragment', text:'Enter a valid SMILES chemical graph and Stage it. Staging does not attach the fragment; click an atom to attach it or open space to add it separately.'},
  'stage-custom-fragment': {title:'Stage a fragment for attachment', text:'Parse the custom SMILES and select the Add tool. Then click the intended attachment atom in the viewer. Review the resulting chemistry before searching a pose.'},
  'fragment-search': {title:'Find a fragment template', text:'Filter template names, labels and SMILES. Choosing a template stages it; it does not yet modify the molecule.'},
  'structure-2d-element': {title:'Element for 2D drawing', text:'Choose the element used by the 2D Atom tool. This is a chemical-graph edit, synchronized with the 3D molecule—not a color setting.', choices:{C:'Carbon', N:'Nitrogen', O:'Oxygen', F:'Fluorine', P:'Phosphorus', S:'Sulfur', Cl:'Chlorine', Br:'Bromine', I:'Iodine'}},
  'structure-2d-bond-order': {title:'Bond order for 2D drawing', text:'Choose the chemical bond order used by the 2D Bond tool. This does not set a bond length.', choices:{'1':'Single covalent bond.', '2':'Double covalent bond.', '3':'Triple covalent bond.', '1.5':'Aromatic ring bond; the complete ring must remain chemically valid.'}},
  'structure-2d-finish': {title:'Finish chemistry from the 2D editor', text:'Commit the same pending chemical edits shown in the 3D editor: validate chemistry, reconcile hydrogens and perform ligand cleanup. It does not run constrained ligand search.'},
  'structure-2d-discard': {title:'Discard pending 2D chemistry', text:'Restore the chemical state before the unfinished edits. The 2D and 3D editors share one pending transaction.'},
  'viewer-finish-chemistry': {title:'Finish pending chemistry', text:'Validate and commit the staged chemical graph shared by both editors. This is ligand cleanup, not pocket relaxation or constrained ligand search.'},
  'viewer-discard-chemistry': {title:'Discard pending chemistry', text:'Restore the chemical state before the current unfinished group of edits, in both 2D and 3D.'},
  'campaign-resume': {title:'Resume local design history', text:'Restore the saved campaign from this browser’s local storage. This is not a server download or a Git branch.'},
  'campaign-title': {title:'Name the campaign', text:'A human-readable name for the local molecular-design history. Keep sensitive project details out of exports you intend to share.'},
  'campaign-id': {title:'Set the campaign identifier', text:'A stable identifier for this molecular-design campaign, separate from its display title and from GitHub repository branches.'},
  'campaign-create': {title:'Start a campaign and commit', text:'Create a local molecular-design history and save the current molecule as its first commit. Nothing is published to GitHub or sent to a collaborator.'},
  'campaign-commit-message': {title:'Describe the molecular change', text:'A short explanation attached to the next campaign commit. State the design intent, not just the operation name.'},
  'campaign-commit': {title:'Commit the current molecule locally', text:'Save the current molecular state to the active campaign branch. This is a Molarium design-history commit, not a source-code Git commit or external publication.'},
  'campaign-branch': {title:'Switch molecular-design branches', text:'Choose a saved campaign branch to restore its molecular state. Branches preserve alternative design paths; they do not change the software repository.'},
  'campaign-new-branch': {title:'Name a design branch', text:'A name for an alternative molecular-design path starting at the current campaign commit.'},
  'campaign-create-branch': {title:'Create a local design branch', text:'Start an alternative campaign history at the current commit. This does not create a GitHub branch or pull request.'},
  'campaign-merge-source': {title:'Choose a campaign branch to merge', text:'Select another local molecular-design branch. Review compatibility before merging; combining history is not proof of physical compatibility.'},
  'campaign-merge': {title:'Merge campaign histories', text:'Merge the selected molecular-design branch into the current local branch using the campaign’s compatibility checks. This does not merge a software pull request.'},
  'campaign-decision-disposition': {title:'Record the design decision', text:'These are authored decisions, not conclusions inferred from a computed score.', choices:{progressed:'Continue pursuing this design.', 'not-progressed':'Do not pursue this design.', deferred:'Postpone the decision.', failed:'Record that the intended attempt failed.', duplicate:'Mark a duplicate design or attempt.', superseded:'Record that a later design replaced this one.', archived:'Retain this design for the record without active pursuit.'}},
  'campaign-decision-rationale': {title:'Explain the decision', text:'Record the evidence, uncertainty and reason for the selected disposition. A lower energy alone does not establish improved potency.'},
  'campaign-record-decision': {title:'Save a decision on this commit', text:'Attach the selected disposition and rationale to the current molecular-design commit. This does not modify coordinates.'},
  'designer-story-import': {title:'Import an executable design story', text:'Load a Chemist Actions story for deliberate playback in the workspace. Unlike a saved campaign import, playback can perform computations and molecular edits.'},
  'campaign-import': {title:'Import saved campaign history', text:'Read a campaign JSON file and validate its history. This is separate from importing an executable Chemist Actions story.'},
  'campaign-export': {title:'Export the local campaign', text:'Download the campaign history as JSON for archiving or sharing. The download is local; you decide where to publish it.'},
  'campaign-verify': {title:'Verify campaign integrity', text:'Check the saved campaign’s hashes and history structure. Integrity checks do not validate the scientific correctness of a design hypothesis.'},
  'campaign-close': {title:'Close the active campaign', text:'Leave the active campaign without deleting its saved local history. Export important histories for durable backup.'},
  'preparation-ph': {title:'Target preparation pH', text:'Use this pH to propose protonation states during preparation. It is not constant-pH dynamics and does not guarantee the unique bound-state protonation.'},
  'preparation-histidine': {title:'Histidine protonation', text:'Choose how histidine hydrogens are assigned before force-field parameterization.', choices:{auto:'Choose locally from the H-bond environment; inspect ambiguous sites.', hid:'Neutral histidine with Nδ1 protonated.', hie:'Neutral histidine with Nε2 protonated.', hip:'Both ring nitrogens protonated; net charge +1.'}},
  'preparation-ligands': {title:'Ligand chemical graphs', text:'Ligand bond orders and atom identities must come from an explicit chemical graph, not be inferred from crystal distances alone.', choices:{ccd:'Retrieve the RCSB Chemical Component Dictionary graph for each ligand; network access is needed.', registered:'Use an already installed, provenance-registered graph. This does not import ideal crystal coordinates.', exclude:'Omit ligands from the prepared simulation system; not appropriate for retaining a ligand-design target.'}},
  'preparation-waters': {title:'Crystal-water policy', text:'Water retention changes the prepared system and possible H-bond hypotheses. Report the policy when comparing runs.', choices:{crucial:'Keep waters classified as bridging or structural by preparation heuristics; inspect the selected set.', exclude:'Remove crystal waters from the prepared system.', retain:'Retain crystal waters and add hydrogens. This does not create a bulk solvent box.'}},
  'preparation-gaps': {title:'Missing residue blocks', text:'Unresolved sequence segments are not experimentally observed coordinates.', choices:{cap:'Cap resolved protein segments instead of constructing missing loops.', block:'Stop preparation until the missing loop problem is resolved.'}},
  'preparation-repair-heavy': {title:'Repair missing heavy atoms', text:'Model missing atoms in otherwise recognized residues before adding hydrogens. These coordinates are modeled, not observed; preparation safeguards can reject clashes.'},
  'prepare-pdb': {title:'Prepare a simulation-ready structure', text:'Apply the selected protonation, ligand, water, gap and repair policies; add hydrogens and parameterize the system. Check the preparation report before capturing a design reference.'},
  'confirm-analogue-design': {title:'Confirm reference capture', text:'Capture the current prepared ligand and receptor before editing. Review the required-contact choices afterward; capturing a reference is not forcing a later analogue to reproduce a crystal pose exactly.'},
  'cancel-analogue-design': {title:'Cancel reference capture', text:'Close this prompt without capturing a new design reference or changing the molecule.'},
};

export const DESIGN_HELP_DYNAMIC = [
  {selector:'#build-tool-tabs [data-tool="add"]', title:'Add atoms or fragments', text:'Click an atom to attach the selected element or staged fragment; click open space to add a separate component. Drag empty space to rotate the view.'},
  {selector:'#build-tool-tabs [data-tool="select"]', title:'Select atoms', text:'Pick one atom for chemistry or a side-chain branch; two for a bond, three for an angle, four for a torsion. Expert selected-core search uses an explicit selected ligand core.'},
  {selector:'#build-tool-tabs [data-tool="manipulate"]', title:'Move atoms directly', text:'Drag an atom to edit its coordinates, or empty space to rotate the view. Direct movement is not minimization and does not enforce required H-bonds.'},
  {selector:'#element-grid [data-element]', title:'Choose an element to add', text:'Select this element for the Add tool, then click the viewer to attach or place an atom. To change an existing atom, use Edit Chemistry → Element → Apply atom instead.'},
  {selector:'#fragment-grid .fragment-card', title:'Stage this fragment template', text:'Select this template for the Add tool, then click an attachment atom in the viewer. Choosing the template alone does not edit chemistry or predict its pose.'},
  {selector:'#docking-hbond-list input[type="checkbox"]', title:'Require this H-bond', text:'Checked: a compatible feature and acceptable geometry are mandatory for ligand-search acceptance. Unchecked: omit that requirement without forgetting the hypothesis. Weak covalent-fluorine hypotheses start optional. These requirements do NOT constrain pocket minimization.'},
  {selector:'#docking-hbond-list .docking-contact-remap-select', title:'Choose a replacement contact feature', text:'Refine all alternatives searches compatible replacement features; choosing one explicitly commits that mapping. This changes the ligand feature assigned to the hypothesis, not whether the contact is required.'},
  {selector:'#docking-hbond-list .forget-docking-contact', title:'Forget a contact hypothesis', text:'Remove the hypothesis itself, unlike unchecking its required flag. The search will no longer test it. Make this an explicit design decision when chemistry removes its feature.'},
  {selector:'#docking-contact-builder-options button', title:'Choose the H-bond direction', text:'Choose which selected atom donates the hydrogen and which accepts it. Both chemical roles must be compatible; this does not assert that the geometry already forms an H-bond.'},
  {selector:'#docking-pose-list button', title:'Review this search candidate', text:'Choose a distinct candidate to review its predicted geometry and scores. Use Apply pose to install it. Candidate feasibility describes this search result, not contacts after later relaxation.'},
  {selector:'[data-2d-tool="select"]', title:'Select in 2D', text:'Select the same persistent atom in both 2D and 3D. Use the Design controls to edit its chemistry or selected geometry.'},
  {selector:'[data-2d-tool="atom"]', title:'Draw an atom in 2D', text:'Use the selected 2D element to add an atom. Finish the chemical edit before evaluating its constrained 3D pose.'},
  {selector:'[data-2d-tool="bond"]', title:'Draw a bond in 2D', text:'Create or change chemical connectivity using the selected bond order. This is different from adjusting the 3D bond length.'},
  {selector:'[data-2d-tool="erase"]', title:'Erase 2D chemistry', text:'Delete an atom or bond from the shared molecular graph. Complete the resulting valence state before finishing; required contact features may become unavailable.'},
  {selector:'#display-options .frame-control input[type="range"]', title:'Scrub displayed frames', text:'Move through stored geometry frames. This changes the displayed coordinates to an existing frame; it does not recompute dynamics or reverse physical time.'},
];

export function designHelpForControl(control) {
  return DESIGN_HELP[control.id] || DESIGN_HELP_DYNAMIC.find((entry) => control.matches(entry.selector)) || null;
}

// EH-01: one explanation per decision, not per element, candidate or action.
// For example, the optimizer selector explains Optimize; docking-mode explains
// Run search; Add required H-bond explains the repeated contact checkboxes.
export const ESSENTIAL_HELP_IDS = Object.freeze([
  'replay-designer-moves',
  'docking-mode', 'docking-edit-cleanup', 'update-docking-receptor',
  'add-docking-contact', 'build-optimizer-select',
  'enumerate-sidechain-rotamers', 'designer-ligand-pose-lock',
  'move-connected', 'chemistry-immediate-refine',
  'preparation-histidine', 'preparation-ligands', 'preparation-waters',
  'preparation-gaps', 'preparation-repair-heavy',
  'ligand-protonation-run', 'fold-protein',
  'job-select', 'method-select', 'solvent-select', 'constraint-select',
  'stormm-replica-count', 'conformer-arena', 'verify-local-build',
]);
const essentialHelpIds = new Set(ESSENTIAL_HELP_IDS);
export function hasEssentialDesignHelp(control) {
  return essentialHelpIds.has(control.id);
}

// Native dialog provides focus containment and Escape dismissal on keyboard and touch.
// Controls keep their IDs/listeners; the help buttons never execute their paired action.
export function installDesignHelp(document) {
  if (document.querySelector('#design-option-help')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'design-option-help';
  dialog.className = 'design-option-help';
  dialog.setAttribute('aria-labelledby', 'design-option-help-title');
  dialog.setAttribute('aria-describedby', 'design-option-help-description');
  const title = document.createElement('h2'); title.id = 'design-option-help-title';
  const description = document.createElement('p'); description.id = 'design-option-help-description';
  const availability = document.createElement('p'); availability.className = 'design-help-availability';
  const choices = document.createElement('dl');
  const close = document.createElement('button'); close.type = 'button'; close.className = 'soft-button';
  close.textContent = 'Close help'; close.autofocus = true;
  const heading = document.createElement('div'); heading.className = 'design-help-heading';
  heading.append(title, close);
  dialog.append(heading, description, availability, choices);
  document.body.append(dialog);
  let active = null;
  const render = () => {
    if (!active) return;
    const {control, entry} = active;
    const select = entry.choiceSelector ? document.querySelector(entry.choiceSelector) : control;
    const selectedEntry = entry.choiceSelector ? designHelpForControl(select) : entry;
    title.textContent = `${entry.title}${active.context ? ` · ${active.context}` : ''}`;
    description.textContent = entry.text;
    availability.textContent = control.disabled ? 'This control is currently unavailable. See the nearby status for prerequisites; help remains available.' : '';
    choices.replaceChildren();
    if (select?.tagName === 'SELECT' && selectedEntry?.choices) {
      for (const option of select.options) {
        const term = document.createElement('dt');
        const note = document.createElement('dd');
        term.textContent = `${option.textContent}${option.value === select.value ? ' · selected' : ''}${option.disabled || option.hidden ? ' · unavailable here' : ''}`;
        note.textContent = selectedEntry.choices[option.value] || 'An application-provided choice; inspect its current label before selecting.';
        choices.append(term, note);
      }
    } else if (select?.tagName === 'SELECT' && select.selectedOptions.length) {
      const term = document.createElement('dt'); term.textContent = 'Current choice';
      const note = document.createElement('dd'); note.textContent = select.selectedOptions[0].textContent;
      choices.append(term, note);
    }
  };
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    // A new help button may reopen the dialog before an earlier close event is
    // delivered. Do not clear the newly opened dialog's accessibility state.
    if (dialog.open) return;
    active?.button.setAttribute('aria-expanded', 'false');
    if (active?.button.isConnected) active.button.focus();
    active = null;
  });
  const installed = new WeakMap();
  const selectors = [...Object.keys(DESIGN_HELP).map((id) => `#${id}`), ...DESIGN_HELP_DYNAMIC.map((entry) => entry.selector)].join(',');
  const refresh = () => {
    for (const control of document.querySelectorAll(selectors)) {
      if (control.dataset.designHelpTrigger !== undefined) continue;
      let item = installed.get(control);
      if (!item) {
        const entry = designHelpForControl(control);
        if (!entry) continue;
        if (!hasEssentialDesignHelp(control)) {
          // Retain unobtrusive native hover help without adding layout wrappers
          // or duplicate keyboard stops to routine and repeated controls.
          if (!control.hasAttribute('title')) control.title = entry.text;
          continue;
        }
        // Keep labels intact and the help button outside them: i must neither
        // toggle a checkbox nor pollute another control's accessible name.
        const label = control.closest('label');
        const target = label && (control.type === 'checkbox'
          || label.querySelectorAll('button,input,select,textarea').length === 1) ? label : control;
        const wrap = document.createElement('span'); wrap.className = 'design-help-control';
        if (control.type === 'checkbox') wrap.classList.add('design-help-checkbox');
        target.before(wrap); wrap.append(target);
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'design-info-button'; button.textContent = 'i';
        button.dataset.designHelpTrigger = control.id || control.dataset.constraintId || control.dataset.fragment || control.dataset.element || control.dataset.tool || entry.title;
        const context = control.dataset.element || (control.dataset.fragment
          ? control.querySelector('span')?.textContent || control.dataset.fragment
          : control.dataset.constraintId ? control.getAttribute('aria-label') : '');
        button.setAttribute('aria-label', `About ${entry.title.toLowerCase()}${context ? ` · ${context}` : ''}`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', dialog.id);
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation();
          active?.button.setAttribute('aria-expanded', 'false');
          active = {control, entry, button, context}; render();
          button.setAttribute('aria-expanded', 'true'); dialog.showModal(); dialog.scrollTop = 0;
        });
        wrap.append(button); installed.set(control, item = {wrap, target, button});
        observer.observe(target, {attributes:true, attributeFilter:['class', 'hidden', 'disabled']});
      }
      const hidden = item.target.hidden || item.target.classList.contains('hidden');
      if (item.wrap.hidden !== hidden) item.wrap.hidden = hidden;
      // Some panels disable all descendant buttons while an action is blocked.
      // The paired action stays disabled; its explanatory button must not be.
      if (item.button.disabled) item.button.disabled = false;
    }
    if (dialog.open) render();
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    document.defaultView.requestAnimationFrame(() => { scheduled = false; refresh(); });
  };
  const observer = new document.defaultView.MutationObserver(schedule);
  for (const id of ['build-left-panel', 'build-right-panel', 'design-history-panel', 'preparation-settings', 'analogue-design-dialog', 'structure-2d-panel', 'load-body', 'display-options', 'run-left-panel', 'result-card', 'protein-fold-body', 'designer-move-tools']) {
    const panel = document.getElementById(id);
    if (panel) observer.observe(panel, {subtree:true, childList:true, attributes:true, attributeFilter:['class', 'hidden', 'disabled']});
  }
  document.addEventListener('change', () => { if (dialog.open) render(); });
  // The old hover-only snippets stay as live text targets for existing status
  // code, but the associated selector now has the keyboard/touch help button.
  for (const id of ['method-info', 'environment-info', 'constraint-info'])
    document.getElementById(id)?.closest('.info-anchor')?.setAttribute('hidden', '');
  refresh();
}
