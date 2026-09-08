#!/usr/bin/env python3
"""Scoped current-SOS1/API reconciliation, preserving author-selected prose elsewhere."""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'paper/revisions/2026-09-06-author-decisions-a04'
OUT=ROOT/'paper/revisions/2026-09-06-current-sos1-api-a05'
def sha(data):return hashlib.sha256(data).hexdigest()
original=(BASE/'main.tex').read_text()
assert sha(original.encode())=='c39ceef4ec53989c53a11093b161b29e2ee49be8449d882c49e3bc8848db4fa2'
marker='\\appendixsection{Editorial history: recovered paragraph versions}{app:paragraph-history}'
live,archive=original.split(marker,1)
repo=(ROOT/'paper/main.tex').read_text()
changes=[]
def change(ident,before,after):
    global live
    assert live.count(before)==1,(ident,live.count(before))
    live=live.replace(before,after,1)
    changes.append({'id':ident,'before':before,'after':after})

# The six-panel image and the new numerical story are one coherent frozen run.
figure_start=live.index('\\begin{figure}[htbp]',live.index('Three task-specific views'))
figure_end=live.index('\\end{figure}',figure_start)+len('\\end{figure}')
new_figure=r'''\begin{figure}[htbp]
  \centering
  \safeincludegraphics[width=\linewidth]{figures/fig2_sos1_designer_intent.png}
  \caption{Designer intent and receptor response in the Molarium interface. (A) The prepared 5OVE/AXE hit. (B) The AWZ precursor. (C) The AWW graph with its inherited arm direction. (D) The designer-directed AWW pose before receptor movement, with the intended Tyr884 backbone-carbonyl contact. (E) The energy-selected Phe890 response with the ligand fixed. (F) The BAY-293 continuation. Purple ligands, gold Phe890, and the labeled Tyr884 contact distinguish ligand placement from receptor response. These are exact saved checkpoints, not interpolated structures. The crystal series informed the design hypothesis, but later crystal coordinates were not imported into the trajectory.}
  \label{fig:sos1story}
\end{figure}'''
change('MR-T01-T02/figure2',live[figure_start:figure_end],new_figure)
change('MR-T01/figure1-context','the prospective hit-to-BAY-293 trajectory in Fig.~\\ref{fig:sos1story} began independently from the 5OVE/AXE structure alone.','the reference-informed SOS1 replay in Fig.~\\ref{fig:sos1story} uses 5OVE/AXE as its sole coordinate-bearing starting input.')
purpose=r'''The purpose of this replay is to make a medicinal-chemistry argument inspectable. The designer specifies an AWW ligand direction and Tyr884 contact; a separate calculation tests the Phe890 response while holding that ligand hypothesis fixed. The BAY-293 graph rewrite then retains a declared distal spatial feature. Public actions and exact checkpoints expose what was changed, what was held fixed, and how the next state was selected. The AWW and BAY-293 ligand RMSDs are 0.851 and 1.880~\AA{}, respectively, after receptor alignment and graph-symmetry minimization without ligand fitting. This is a crystal-informed demonstration of design logic, not a blinded prediction.

Three complementary views are available at \url{https://molarium.org/sos1}: the \href{https://molarium.org/sos1-hit-to-bay293}{recomputable replay} runs the recorded operations through the public API; the \href{https://molarium.org/sos1-hit-to-bay293/review}{precomputed replay} allows inspection of seven exact saved checkpoints without calculation; and the MP4 records that checkpoint review with brief calculation-status popups. Recalculation can change numerical results, whereas the saved states preserve the reported result. Neither the movie nor its shortened popups represent calculation speed; Appendix~\ref{app:architecture} gives the protocol and evidence boundary.'''
change('MR-T01-T03/replay-purpose',r'The executable replay is available at \url{https://molarium.org/sos1-hit-to-bay293}.',purpose)
# The phrase now follows the explicit replay explanation; name its antecedent.
change('replay-transition','This separation becomes important when interfaces are inexpensive to modify.','This separation between interface and molecular state becomes important when interfaces are inexpensive to modify.')
a5_start=repo.index('\\subsection{SOS1 designer-intent replay}')
a5_end=repo.index('\\end{small}',a5_start)
a5=repo[a5_start:a5_end]
a5=re.sub(r'\\ifdefined\\SosAcceptedRunId.*?\\fi\s*','',a5,flags=re.S)
values=dict(re.findall(r'\\newcommand\{\\(Sos\w+)\}\{([^{}]*)\}',(ROOT/'paper/generated/sos1-designer-intent-results.tex').read_text()))
for name,value in sorted(values.items(),key=lambda x:len(x[0]),reverse=True):
    a5=re.sub(r'\\'+name+r'(?:\{\})?(?![A-Za-z])',lambda m:value,a5)
assert not re.search(r'\\Sos[A-Za-z]+',a5)
a5=a5.replace('The selected basin and all alternatives were recorded before numerical crystal comparison.', 'The selected basin and all alternatives were recorded before numerical crystal comparison. The 13 candidates include the unchanged input control and enumerated side-chain alternatives.')
evaluation=r'''\begin{table}[htbp]
\centering\small
\caption{Post-freeze comparison of the reference-informed designer-intent checkpoints. Ligand RMSD is receptor-aligned and graph-symmetry-minimized; the ligand is not fitted independently. These are the current replay's results, not the older hit-only experiment.}
\label{tab:appA_sos1_eval}
\begin{tabular}{@{}lll@{}}
\toprule
\textbf{Checkpoint} & \textbf{Crystal comparison} & \textbf{Ligand RMSD (\AA{})}\\
\midrule
AWW designer hypothesis and Phe890 response & 5OVH & 0.851\\
BAY-293 continuation & 5OVI & 1.880\\
\bottomrule
\end{tabular}
\end{table}

The published release supplies 159 executable public actions, seven exact checkpoint campaigns, and a separate MP4 of the precomputed review. The current MP4 lasts 62.75~s and shows five one-second popups using the recorded calculation-status text; no calculation runs during that review. Thus the executable script tests whether the recorded procedure can be rerun, the precomputed review supports inspection of the exact reported states, and the movie communicates the sequence. The \href{https://molarium.org/design-history/publications/sos1/designer-intent-2026-09-04/release.json}{release record} and \href{https://molarium.org/design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v2/movie.json}{popup-movie manifest} identify the underlying artifacts and timing independently of the live page.

'''
a5=a5.replace('The interface replay executes from a blank canvas',evaluation+'The interface replay executes from a blank canvas',1)
old_start=live.index('\\subsection{SOS1 hit-to-BAY-293 executable replay}')
old_end=live.index('\\end{small}',old_start)
change('MR-T01-T03/appendix-A5',live[old_start:old_end],a5)

# Current, code-backed appendix corrections; no additional med-chem stories.
change('MR-T06/campaign-persistence',next(p for p in live.split('\n\n') if p.startswith('The current live application retains action records')),
r'''The live application records public actions in memory; clearing the scene clears that transient audit. The Design History interface and public \texttt{campaign.*} actions can create a local campaign, commit graph-and-coordinate snapshots and completed actions, create and restore branches, record decisions, merge branch histories, and verify the append-only record. Campaign JSON and the active branch are persisted in browser IndexedDB. Explicit export is needed for portable handoff. Attached action scripts cover completed public operations, not every transient interaction or the complete workbench state.''')
change('MR-T07/explicit-resume','Reload restores the graph and coordinates at the active branch head; it does not restore parameter tables, docking candidates, calculation frames, view state, or the complete workbench session.','Reload makes the saved campaign available to resume without replacing the visible molecule. Explicit Resume restores the graph and coordinates at the active branch head; it does not restore parameter tables, docking candidates, calculation frames, view state, or the complete workbench session.')
change('MR-T08/pocket-motion','only the ligand and explicitly selected pocket atoms move.','the ligand and protein side chains in the automatically selected 5~\\AA{} pocket move, while the protein backbone and outer atoms remain fixed.')
change('MR-T08/three-policies',next(p for p in live.split('\n') if p.startswith('\\item \\textbf{Protein--ligand pose propagation.}')),
r'''\item \textbf{Protein--ligand pose propagation.} A trusted pose is captured with stable atom lineage. Constrained propagation searches edited groups and eligible edit-associated torsions against a fixed receptor, retaining the protected core and enforcing selected required-contact checks. Pocket relaxation moves the ligand and protein side chains in a 5~\AA{} pocket while fixing the backbone. Experimental induced-fit relaxation permits whole-residue motion within 6~\AA{}, including backbone, and eligible ligand/water motion, but fixes ligand atoms protected by registered retention rules. Neither minimization lane enforces the docking hydrogen-bond restraints; contacts must be inspected afterward. Discrete side-chain rotamer enumeration is a separate operation, not an automatic consequence of minimization.''')
change('MR-T08/search-freedom','searches the degrees of freedom introduced by an edit,','searches edited groups and eligible edit-associated torsions, including explicitly released inherited atoms,')
change('MR-T08/contact-options','The separate induced-fit Design optimizer is not part of this ranker and is not an affinity calculation.',r'''The separate induced-fit Design optimizer is not part of this ranker and is not an affinity calculation. Required hydrogen bonds are acceptance conditions for constrained ligand search, not restraints in ligand cleanup, Pocket relax, or Induced-fit pocket. The latter two also differ in whether nearby backbone atoms may move and which ligand atoms remain protected. Adjacent information buttons explain these policies and the available choices. The UI uses v5 feature seeding and automatic worker execution; legacy seeding and execution overrides remain API-only. Weak covalent-fluorine contact hypotheses are optional by default.''')
change('MR-T09/preparation-inspection',r'args:{scope:"pocket", includeCoordinates:false, maximumAtoms:500}})',r'args:{scope:"all", includeCoordinates:false, maximumAtoms:500}})')
# Only B.6's generic optimizer example changes; B.9 has explicitly captured a reference.
needle=r'''  args:{method:"induced-fit-webgpu"}})
await api.execute({action:"session.inspect",
  args:{scope:"pocket", includeCoordinates:true, maximumAtoms:500}})'''
change('MR-T09/optimization-inspection',needle,needle.replace('scope:"pocket"','scope:"ligand"'))
change('MR-T10/f32-mirror','because fixed-point spatial precision degrades far from the working origin.','because the f32 force-evaluation coordinates lose precision far from the working origin.')
change('MR-C16/API-request-limits','Designer Moves JSON files must be smaller than 2 MB; each serialized API request and its argument object are capped at 8 MiB for ASCII JSON, eight nested levels, and 2,048 JSON nodes.', 'Designer Moves JSON files must be smaller than 2 MB. Ordinary API requests are capped at 8 MiB for ASCII JSON, twelve nested levels, and 2,048 JSON nodes. Loading a multi-action script permits 32,768 nodes while retaining the depth and byte limits; each constituent action uses the ordinary request limits. Serialized full-system campaign imports have a separate 32 MiB allowance.')
change('MR-T12/historical-direct-timing','A single Trp-cage energy/force evaluation required 25.5 ms in WebGPU and 5.7 ms in OpenMM Reference.','In the earlier browser benchmark, a single Trp-cage energy/force evaluation required 25.5 ms in WebGPU and 5.7 ms in the bundled OpenMM WebAssembly Reference implementation.')
change('MR-T12/historical-replica-timing','In warm tests, OpenMM Reference was 13.3-fold faster','In the earlier warm comparison against bundled OpenMM WebAssembly Reference, that reference was 13.3-fold faster')
benchmark=r'''A separate production-worker benchmark compares browser WebGPU directly with independently constructed native OpenMM Systems on Apple M1 Pro and NVIDIA L4, without relying on transitive agreement through WebAssembly. The direct worker passes all 47 fixed-f32-input cases and 42 of 47 original-input cases; these are distinct precision gates. The STORMM-style worker passes all 22 supported original-input cases, retaining 25 unsupported cases explicitly. These results concern implementation agreement, not experimental force-field accuracy. The \href{https://github.com/rafwiewiora/molarium/tree/2ab30383d6160349aa3b1e980f7239d6854b329d/benchmarks/simulation}{versioned benchmark supplement} records every energy, Cartesian force vector, tolerance, timing sample, and input identity. Its browser timings include fresh production-job overhead, whereas native GPU baselines use resident Contexts; the column ratios are not matched-kernel speedups or the earlier multi-replica throughput comparison.

'''
change('MR-T11/direct-native-benchmark','\\subsection{Reference-driven implementation and validation}',benchmark+'\\subsection{Reference-driven implementation and validation}')
change('MR-T13/local-computation','Calculations execute on the user\'s local device using WebAssembly or WebGPU,','Most supported calculations execute on the user\'s local device using WebAssembly or WebGPU,')
change('MR-T13/remote-MSA-qualification','The browser reduces installation and orchestration overhead and avoids remote job submission, cloud-compute charges, and application licensing while keeping computation inside the interactive design loop.','The browser reduces installation and orchestration overhead and, for supported local calculations, avoids remote job submission, cloud-compute charges, and application licensing while keeping computation inside the interactive design loop. The optional connected-mode sequence-alignment search remains an explicit remote step (Appendix~\\ref{app:manual}).')
assert not any(s in live[live.index('\\subsection{SOS1 designer-intent replay}'):live.index('\\end{small}',live.index('\\subsection{SOS1 designer-intent replay}'))] for s in ('1.215','2.137','62.58','908.5','withheld during prediction','SosIntent'))
assert 'BCL-xL' not in live and 'CDK2' not in live
assert not OUT.exists(),'Existing revisions are immutable'
OUT.mkdir(parents=True);(OUT/'figures').mkdir()
assets=[]
for item in json.loads((BASE/'integration-manifest.json').read_text())['figures']:
    if item['path'].endswith('fig2_sos1_hit_to_bay293.png'):continue
    raw=(BASE/item['path']).read_bytes();(OUT/item['path']).write_bytes(raw);assets.append(item)
raw=(ROOT/'paper/figures/fig2_sos1_designer_intent.png').read_bytes()
provenance=json.loads((ROOT/'paper/figures/fig2_sos1_designer_intent.provenance.json').read_text())
assert sha(raw)==provenance['figureSha256']
(OUT/'figures/fig2_sos1_designer_intent.png').write_bytes(raw)
assets.append({'path':'figures/fig2_sos1_designer_intent.png','sha256':sha(raw)})
final=live+marker+archive;(OUT/'main.tex').write_text(final)
audit={'schema':'molarium.current-manuscript-reconciliation/v1','baseSourceSha256':sha(original.encode()),'outputSha256':sha(final.encode()),'codeCommit':'2ab30383d6160349aa3b1e980f7239d6854b329d','authorIntegrationManifestSha256':sha((BASE/'integration-manifest.json').read_bytes()),'changes':changes,'figures':assets,'appendixCAndBibliographyPreserved':True,'auditLimitFix':'local uncommitted change in chemist-actions.mjs; not yet deployed','figureSourceProvenance':provenance,'movieManifestSha256':sha((ROOT/'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v2/movie.json').read_bytes())}
(OUT/'reconciliation-manifest.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'output':str(OUT),'changes':len(changes),'sourceSha256':audit['outputSha256']},indent=2))
