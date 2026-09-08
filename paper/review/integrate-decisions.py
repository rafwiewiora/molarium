#!/usr/bin/env python3
"""Apply an exact author export to a separate source package, never to the originals."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def sha(raw): return hashlib.sha256(raw).hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--decisions',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--mechanical-fixes',action='store_true',help='Only with separate author approval')
    args=parser.parse_args()
    data=json.loads((ROOT/'review-data.json').read_text())
    raw=args.decisions.read_bytes(); decisions=json.loads(raw)
    assert decisions['schema']=='molarium.manuscript-decisions/v1'
    assert decisions['reviewDataId']==data['dataId'],'Different review dataset'
    assert decisions['currentSourceSha256']==data['currentSha256']
    assert decisions['comparisonBaseline']==data['comparisonBaseline']
    assert decisions['identity']==data['currentSha256']+':'+data['comparisonBaseline']
    for group in ('figures','technical','suggestions'):
        assert not decisions.get(group),f'{group} choices require deliberate integration not implemented by this text-only pass'
    history=ROOT/'history-2026-09-06'
    original=(history/'artifacts'/data['currentArtifact']).read_bytes()
    assert sha(original)==data['currentSha256']
    original=original.decode(); source=original.splitlines(keepends=True)
    by_id={c['id']:c for c in data['changes']}
    assert set(decisions['decisions'])<=set(by_id)
    applied=[]
    for ident,d in sorted(decisions['decisions'].items(),key=lambda item:by_id[item[0]]['afterLine'],reverse=True):
        change=by_id[ident]
        assert d['before']==change['before'] and d['after']==change['after'],ident
        assert d['choice'] in ('current','earlier','custom','pending'),ident
        start,end=change['afterLine']-1,change['afterEndLine']
        assert ''.join(source[start:end])==change['after'],ident
        if d['choice']=='earlier': replacement=change['before']
        elif d['choice']=='custom':
            assert ident=='D007' and re.fullmatch(r'\\date\{[A-Za-z]+ \d{1,2}, \d{4}\}',d['custom']), 'Custom prose needs explicit LaTeX integration'
            replacement=d['custom']+'\n'
        else: continue
        source[start:end]=replacement.splitlines(keepends=True)
        applied.append({'id':ident,'kind':d['choice'],'before':change['after'],'after':replacement})
    source=''.join(source)
    marker='\\appendixsection{Editorial history: recovered paragraph versions}{app:paragraph-history}'
    live,archive=source.split(marker,1)
    assert marker+archive==original[original.index(marker):], 'Historical Appendix C and bibliography must remain unchanged'
    def revise(ident,before,after,reason):
        nonlocal live
        assert decisions['decisions'].get(ident,{}).get('note'),f'{ident}: no author note'
        assert live.count(before)==1,(ident,before,live.count(before))
        live=live.replace(before,after,1)
        applied.append({'id':ident,'kind':'author-note','before':before,'after':after,'reason':reason})
    revise('D012','a fixed software environments','a fixed software environment','Singular agreement requested in note')
    revise('D012','Implementing new methods from the literature or integrating open-source software often required software engineering support, if it was even possible.','Even when feasible, implementing new methods from the literature or integrating open-source software often required software engineering support.','Minimal rewrite of the clunky feasibility qualification')
    revise('D015','It began as a need for a better environment to view and modify molecular structures, then evolved through active scientific use, all over the course of a weekend to create the first version.','It began as a need for a better environment to view and modify molecular structures; the first version evolved through active scientific use over a weekend.','Minimal rewrite of the first-version/weekend sentence')
    revise('D030','resouirces','resources','Requested spelling correction')
    revise('D031','protien','protein','Requested spelling correction')
    revise('D031','In Molarium the editing','In Molarium, the editing','Requested comma')
    revise('D032','synthesized next while running','synthesized next, while running','Requested comma')
    revise('D033','andmethods','and methods','Requested missing space')
    revise('D035','The current live application retains at most 500 action records in memory; clearing the scene clears that audit.','The current live application retains action records in memory; clearing the scene clears that audit.','Remove default-cap description following the requested code fix; pending paragraph choice is otherwise retained')
    revise('D035','Session memory; serialized calls; bounded history, normally 500 entries; cleared with the scene unless exported through a script path.','Session memory; serialized calls; cleared with the scene unless exported through a script path.','Remove the same retired audit-cap statement from the Appendix B record table')
    revise('D037','The SOS1, BCL-xL, and CDK2 routes use this schema.','The SOS1 route uses this schema.','Keep the live manuscript focused on SOS1; frozen historical quotations are retained')
    if args.mechanical_fixes:
        for proposal in data['suggestions']:
            if proposal['kind'] not in ('Typo','Grammar'): continue
            if proposal['before'] not in live:
                assert proposal['after'] in live,proposal['id']
                continue
            assert live.count(proposal['before'])==1,proposal['id']
            live=live.replace(proposal['before'],proposal['after'],1)
            applied.append({'id':proposal['id'],'kind':'separately-approved-mechanical','before':proposal['before'],'after':proposal['after']})
    # Compile-only accommodations: retain every historical quotation verbatim.
    typesetting=[('\\usepackage{placeins}','\\usepackage{placeins}\n\\usepackage{newunicodechar}\n\\newunicodechar{’}{\\textquoteright}'),
                 ('\\lstset{basicstyle=\\ttfamily\\footnotesize,breaklines=true,columns=fullflexible,keepspaces=true}',
                  '\\lstset{basicstyle=\\ttfamily\\footnotesize,breaklines=true,columns=fullflexible,keepspaces=true,literate={’}{{\\textquoteright}}1}'),
                 ('Registered design routes use a separate \\texttt{molarium.registered-design-route/v1}',
                  'Registered design routes use a separate \\path{molarium.registered-design-route/v1}'),
                 ('The \\texttt{molarium.design-campaign/v1} schema stores snapshots',
                  'The \\path{molarium.design-campaign/v1} schema stores snapshots')]
    for before,after in typesetting:
        assert live.count(before)==1,before
        live=live.replace(before,after,1)
        applied.append({'id':'typesetting','kind':'compile-only','before':before,'after':after})
    final=live+marker+archive
    assert not args.output.exists(),'Use a new output directory; existing revisions are immutable'
    args.output.mkdir(parents=True)
    (args.output/'main.tex').write_text(final)
    (args.output/'figures').mkdir()
    figure_names={'fig1_molarium_interface.png':'fig1_molarium_interface.png','fig2_sos1_hit_to_bay293.png':'fig2_sos1_hit_to_bay293.png','fig2_architecture.png':'fig2_architecture (2).png','fig3_build_loop_compact.png':'fig3_build_loop_compact (1).png','fig4_evidence_ladder_fixed.png':'fig4_evidence_ladder_fixed (1).png','fig5_value_layers_fixed.png':'fig5_value_layers_fixed (2).png'}
    assets=[]
    for filename,download in figure_names.items():
        aliases=[a for a in data['history']['aliases'] if a['origin']=='Downloads' and a['source']==download]
        assert len(aliases)==1,download
        artifact=aliases[0]['artifact']; content=(history/'artifacts'/artifact).read_bytes()
        assert sha(content)==artifact[:-4]
        (args.output/'figures'/filename).write_bytes(content)
        assets.append({'path':'figures/'+filename,'sourceArtifact':artifact,'sha256':sha(content)})
    report={'schema':'molarium.author-integration/v1','decisionExportSha256':sha(raw),'exportedAt':decisions['exportedAt'],'reviewDataId':data['dataId'],'sourceSha256':data['currentSha256'],'outputSha256':sha(final.encode()),'applied':applied,'figures':assets,'undecidedText':[c['id'] for c in data['changes'] if decisions['decisions'].get(c['id'],{}).get('choice','pending')=='pending'],'unselectedGroups':['figures','technical','suggestions'],'mechanicalFixesSeparatelyApproved':args.mechanical_fixes,'archivePreservedVerbatim':True,'noteClarifications':{'D016':'The singular possessive "the user\'s local device" is grammatical and is retained.','D035':'Requested cap wording removed and local code fixed; other current paragraph claims are unchanged because the paragraph remains pending. Its claim that live campaign commits are unavailable remains a technical-review issue.'},'status':'Author-selected text revision; not approval of undecided figures or scientific claims.'}
    (args.output/'integration-manifest.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:report[k] for k in ('outputSha256','undecidedText','mechanicalFixesSeparatelyApproved','archivePreservedVerbatim','status')},indent=2))

if __name__=='__main__':main()
