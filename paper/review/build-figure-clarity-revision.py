"""Preserve a19; integrate the requested figure and appendix-notation clarifications."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, zipfile

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'paper/revisions/2026-09-07-whole-movie-human-account-a19'
OUT=ROOT/'paper/revisions/2026-09-07-figure-clarity-a20'
QA=ROOT.parent/'paper-history-review'
sha=lambda b: hashlib.sha256(b).hexdigest()
original=(BASE/'main.tex').read_text()
old_caption=original.split('  \\caption{Designer intent and receptor response in the Molarium interface.',1)[1].split('\n  \\label{fig:sos1story}',1)[0]
old_caption='  \\caption{Designer intent and receptor response in the Molarium interface.'+old_caption
new_caption=r'''  \caption{Chemical edits and geometric operations in the SOS1 design sequence. (A--E) Graph-derived 2D depictions make the successive changes explicit: naphthyl replacement and 2-methyl addition; thiophene-linked fragment merge; benzyl-alcohol installation with the AWW 5,8-dihydro core; and the BAY-293 attachment, terminal-amine, and aromatic-core changes. Orange marks regions outside the registered atom-lineage conserved subgraph relative to the preceding graph, not a synthetic reaction mechanism. (F) The same AWW graph is placed toward the Tyr884 backbone-carbonyl contact. (G) Phe890 is sampled with that ligand fixed. (H) The seven-atom distal feature is retained approximately through the BAY-293 rewrite and relaxation. Purple shows the current ligand; gray dashes show previous positions, gold the Phe890 response, and the teal highlight the retained feature. The 3D details use exact saved checkpoint coordinates with a common projection and scale; arrows connect endpoint states, not simulated paths. The crystal series informed the hypothesis, but later crystal coordinates were not used to generate these states.}'''
changes=[
    {'before':old_caption,'after':new_caption},
    {'before':r'figures/fig3_build_loop_compact.png','after':r'figures/fig3_build_loop_compact.pdf'},
    {'before':'The listing is a reading guide, not a separately executable script.',
     'after':r'The listing is a reading guide, not a separately executable script. A \texttt{\#} introduces an explanatory comment; unprefixed lines specify operations or checks, including \texttt{require} and \texttt{inspect}. Indented argument continuations belong to the preceding instruction.'},
    {'before':'This appendix specifies the implementation and validation substrate underlying the architectural claims in the main text.',
     'after':r'\textit{Authorship note for Appendices A and B.} These appendices were drafted primarily by GPT-5.6 Sol and subsequently revised with AI assistance under human direction, with limited direct human editing. The authors remain responsible for their content.'+'\n\n'+'This appendix specifies the implementation and validation substrate underlying the architectural claims in the main text.'},
    {'before':'Molarium is designed so that a scientist working through the graphical interface and an agent operating through the Chemist Actions API act on the same molecular state and encounter the same scientific boundaries.',
     'after':r'\textit{Authorship note.} This appendix shares the AI-drafting and limited-human-editing disclosure at the start of Appendix~\ref{app:architecture}.'+'\n\n'+'Molarium is designed so that a scientist working through the graphical interface and an agent operating through the Chemist Actions API act on the same molecular state and encounter the same scientific boundaries.'},
]
result=original
for change in changes:
    assert result.count(change['before'])==1
    result=result.replace(change['before'],change['after'],1)
figure_sources={
    'fig2_sos1_designer_intent.png':QA/'fig2-chemistry-a20.png',
    'fig2_sos1_designer_intent.provenance.json':QA/'fig2-chemistry-a20.provenance.json',
    'fig3_build_loop_compact.png':QA/'fig4-clean-arrow-a20.png',
    'fig3_build_loop_compact.pdf':QA/'fig4-clean-arrow-a20.pdf',
    'fig3_build_loop_compact.provenance.json':QA/'fig4-clean-arrow-a20.provenance.json',
}
manifest={'schema':'molarium.approved-manuscript-figure-edits/v1',
          'baseRevision':str(BASE.relative_to(ROOT)),'baseSourceSha256':sha(original.encode()),
          'outputSha256':sha(result.encode()),'changes':changes,
          'allOtherTextUnchanged':True,'unchangedFigureCount':4,
          'figureChanges':{name:sha(path.read_bytes()) for name,path in figure_sources.items()}}
if sys.argv[1]=='build':
    OUT.mkdir(exist_ok=False)
    shutil.copytree(BASE/'figures',OUT/'figures')
    for name,path in figure_sources.items(): shutil.copyfile(path,OUT/'figures'/name)
    (OUT/'main.tex').write_text(result)
    (OUT/'edit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    for f in BASE.iterdir():
        if f.suffix=='.json' and f.name!='edit-manifest.json' or f.name=='sos1-whole-movie-pseudocode.txt':
            shutil.copyfile(f,OUT/f.name)
    (OUT/'README.md').write_text((BASE/'README.md').read_text()+'\n## Figure-clarity follow-up\n\nThis revision updates Figure 2 to show all five ligand graphs, marks lineage-defined rewritten regions, and separates three frozen-coordinate geometric operations. Its graph depictions and stereo come from the saved states; no molecular calculation or interpolation was performed. Figure 4 (the scientist-agent loop) is reconstructed as a vector diagram with the same text and stage order and a single clean feedback arrowhead; the PDF is used for typesetting and a PNG is supplied for convenience. Four other figure assets remain byte-identical. The new figure provenance files record input hashes and generation details. The appendix AI-authorship disclosure now also appears at Appendix A, with a reminder at Appendix B, and the pseudocode comment/instruction convention is explicit. Earlier revisions are preserved.\n')
    print(OUT)
else:
    assert (OUT/'main.tex').read_text()==result
    assert json.loads((OUT/'edit-manifest.json').read_text())==manifest
    for name,path in figure_sources.items(): assert (OUT/'figures'/name).read_bytes()==path.read_bytes()
    log=(OUT/'main.log').read_text()
    assert not any(s in log for s in ('Missing character','Overfull','undefined references','undefined citations','! LaTeX Error'))
    pdf=ROOT/'output/pdf/molarium-author-approved-a20.pdf'
    bundle=ROOT/'output/prism/molarium-prism-author-approved-a20.zip'
    shutil.copyfile(OUT/'main.pdf',pdf)
    files=[OUT/n for n in ('main.tex','README.md','edit-manifest.json')]
    files+=sorted((OUT/'figures').iterdir())
    files+=sorted(f for f in OUT.iterdir() if f.suffix=='.json' and f.name!='edit-manifest.json')
    files+=[OUT/'sos1-whole-movie-pseudocode.txt']
    with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(f,str(f.relative_to(OUT)))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(set(z.namelist()))
        assert z.read('main.tex')==result.encode()
    print(json.dumps({'pdf':str(pdf),'zip':str(bundle),'files':len(files)},indent=2))
