#!/usr/bin/env python3
"""Build a local-first review, with no accepted decisions or manuscript mutation."""
import difflib
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HISTORY = ROOT/'history-2026-09-06'
manifest = json.loads((HISTORY/'manifest.json').read_text())

def digest(text): return hashlib.sha256(text.encode()).hexdigest()
def norm(text): return re.sub(r'\s+',' ',text).strip()
def plain(text):
    """Convenience reading view, never a substitute for the retained source."""
    text = re.sub(r'(?m)^\s*%.*$', '', text)
    text = re.sub(r'\\(?:safeincludegraphics|includegraphics)(?:\[[^\]]*\])?\{([^}]+)\}', r'[Figure file: \1]',text)
    text = re.sub(r'\\(?:label)\{[^}]*\}', '', text)
    text = re.sub(r'\\(?:citep|citet|cite)\{([^}]+)\}', r'[\1]', text)
    text = re.sub(r'\\ref\{([^}]+)\}', r'[\1]', text)
    text = re.sub(r'\\(?:begin|end)\{[^}]+\}(?:\[[^\]]*\])?', '', text)
    for _ in range(5):
        text = re.sub(r'\\(?:textbf|textit|emph|texttt|url|path|caption|lead|subhead|section|subsection|paragraph)\*?\{([^{}]*)\}',r'\1',text)
    text = text.replace('\\AA{}','Å').replace('\\AA','Å').replace('~',' ').replace('---','—').replace('--','–').replace('``','“').replace("''",'”')
    text = text.replace('\\centering','').replace('\\item','• ').replace('\\FloatBarrier','[Figure placement barrier]').replace('\\clearpage','[Page break]')
    return text.strip()

def artifact_named(name):
    matches = [a for a in manifest['aliases'] if a['source']==name and a['origin']=='Downloads']
    assert len(matches)==1, (name,matches)
    return matches[0]['artifact']

current_id = artifact_named('main (2).tex')
current = (HISTORY/'artifacts'/current_id).read_text()
marker = '\\appendixsection{Editorial history: recovered paragraph versions}{app:paragraph-history}'
cstart = current.index(marker)
bstart = current.index('\\begin{thebibliography}',cstart)
target = '61e57f2d6944b25becb1c033e97c098d1848fa35d90027485f838c8baca6cc8f'
scientific = None
for middle in ['', '\\clearpage']:
    for before in range(1,7):
        for after in range(0,5):
            candidate = current[:cstart].rstrip()+'\n'*before+middle+'\n'*after+current[bstart:]
            if digest(candidate)==target: scientific=candidate
if scientific is None:
    scientific = current[:cstart].rstrip()+'\n\n\\clearpage\n\n'+current[bstart:]
baseline_verified = digest(scientific)==target
baseline_id = 'd098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9.tex'
baseline = (HISTORY/'artifacts'/baseline_id).read_text()

records = {}
for match in re.finditer(r'^R(\d{3})\s*&\s*(\d+)\s*&[^\n]*?&\s*(.*?)\s*\\\\',current,re.M):
    records['R'+match[1]] = {'line':int(match[2]),'location':plain(match[3])}
assert len(records)==228, len(records)
variants = {}
for match in re.finditer(r'\\subsection\{(R\d{3}):[^\n]+\}(.*?)(?=\\subsection\{|\Z)',current[cstart:],re.S):
    entries=[]
    for version in re.finditer(r'\\paragraph\{Version (\d+) --- ([^}]+)\}(.*?)(?=\\paragraph\{|\Z)',match[2],re.S):
        listing = re.search(r'\\begin\{lstlisting\}\n(.*?)\n\\end\{lstlisting\}', version[3],re.S)
        if listing:
            entries.append({'label':version[2], 'latex':listing[1], 'text':plain(listing[1]),'evidence':re.findall(r'\\item (.*)',version[3])})
    if entries: variants[match[1]]=entries
assert len(variants)==38, len(variants)

def section_at(lines,index):
    name='Preamble and title'
    for line in lines[:index+1]:
        if '\\begin{abstract}' in line: name='Abstract'
        match=re.search(r'^\\(?:section|subsection|subhead|appendixsection)\*?\{([^}]+)\}',line)
        if match: name=plain(match[1])
        if '\\begin{thebibliography}' in line: name='References'
    return name

left=baseline.splitlines(keepends=True)
right=scientific.splitlines(keepends=True)
changes=[]
for kind,a,b,c,d in difflib.SequenceMatcher(None,left,right,autojunk=False).get_opcodes():
    if kind=='equal': continue
    before=''.join(left[a:b]); after=''.join(right[c:d])
    record_ids=[key for key,v in records.items() if c+1<=v['line']<=max(c+1,d)]
    area='Main text' if c < next(i for i,x in enumerate(right) if x.strip()=='\\appendix') else 'Appendices'
    if c<next(i for i,x in enumerate(right) if '\\begin{document}' in x): area='Preamble'
    if c>next(i for i,x in enumerate(right) if '\\begin{thebibliography}' in x): area='References'
    change={'id':'D'+str(len(changes)+1).zfill(3),'kind':kind,'area':area,'section':section_at(right,c),'before':before,'after':after,'beforeText':plain(before),'afterText':plain(after),'beforeLine':a+1,'afterLine':c+1,'beforeEndLine':b,'afterEndLine':d,'formatOnly':norm(before)==norm(after),'recordIds':record_ids,'appendixVariants':[{**v,'recordId':key} for key in record_ids for v in variants.get(key,[])], 'contextBefore':next((plain(x) for x in reversed(right[max(0,c-10):c]) if x.strip()),''),'contextAfter':next((plain(x) for x in right[d:d+10] if x.strip()),'')}
    changes.append(change)

sources=[]
for item in manifest['artifacts']:
    if item['extension'] not in ('.tex','.bib','.md'): continue
    aliases=[a for a in manifest['aliases'] if a['artifact']==item['id']]
    preferred=min(aliases,key=lambda a:({'Downloads':0,'Downloads source directory':1,'Downloads archive member':2}.get(a['origin'],3),len(a['source'])))
    sources.append({'id':item['id'],'label':preferred['source'],'origin':preferred['origin'],'aliases':aliases,'text':(HISTORY/'artifacts'/item['id']).read_text(errors='replace')})
sources.append({'id':'current-scientific-view','label':'Current manuscript · Appendix C omitted for comparison only','origin':'Derived view; original retained','aliases':[],'text':scientific})
for item in manifest['artifacts']:
    if item['extension'] != '.pdf': continue
    aliases=[a for a in manifest['aliases'] if a['artifact']==item['id']]
    preferred=min(aliases,key=lambda a:({'Downloads':0,'Repository file':1}.get(a['origin'],2),len(a['source'])))
    extracted=(HISTORY/'text'/(item['sha256']+'.txt')).read_text()
    assert digest(extracted)==item['textSha256'], item['id']
    sources.append({'id':'pdf-text:'+item['sha256'],'label':'PDF text · '+preferred['source'],
                    'origin':'Derived Poppler layout extraction; original PDF retained',
                    'aliases':aliases,'text':extracted,'pdfArtifact':item['id'],
                    'textSha256':item['textSha256'],'pages':item['pages']})
data={'schema':'molarium.manuscript-review/v1','currentArtifact':current_id,'currentSha256':current_id[:-4], 'currentPdf':artifact_named('main (9).pdf'),'comparisonBaseline':baseline_id,'baselineBeforeAppendixC':digest(scientific),'appendixBaselineHashVerified':baseline_verified,'changes':changes,'appendixRecords':records,'appendixChangedRecords':variants,'sources':sources,'history':manifest,'suggestions':json.loads((ROOT/'suggestions.json').read_text()) if (ROOT/'suggestions.json').exists() else [],'policy':{'default':'Every decision is pending; current manuscript is untouched.','scope':'Every source-line difference in the selected baseline comparison is retained, including whitespace, headings, preamble, references, insertions and deletions. Appendix C is excluded from this default comparison as an editorial archive, but retained in full source comparison.','authorship':'User reports Woody manually revised the draft. Snapshot differences alone do not attribute each edit to him. Source B is an alternative baseline, not a proven immediately-pre-Woody snapshot.','sourceView':'Reading view simplifies LaTeX for convenience; exact source and source hashes remain authoritative.','application':'Exports record decisions and proposals; they do not compile, modify, or publish a final paper.'}}
data['policy']['authorship']='User reports Woody manually revised the draft. Snapshot differences alone do not attribute each edit to him. The actual local September 2 bundle is an alternative baseline, not the exact Source B bytes named by Appendix C or a proven immediately-pre-Woody snapshot.'
data['technicalReview']=(ROOT/'TECHNICAL-REVIEW-2026-09-06.md').read_text() if (ROOT/'TECHNICAL-REVIEW-2026-09-06.md').exists() else ''
data['technicalFindings']=[{'id':m[1],'title':m[2],'markdown':m[3].strip()} for m in re.finditer(r'^## (MR-T\d+) — (.*?)\n(.*?)(?=^## |\Z)',data['technicalReview'],re.M|re.S)]
data['figureAssets']={}
for ident,old_file,new_file in [('F01','current-pdf-000.png','e7bc14fa9f4f520c76131cd09309740d223441d71e157e411d84509af68de765.png'),('F02','current-pdf-001.png','962f6acecf2971357f6f87d6842820ec6d122351f2c8752152f7411ab6332018.png')]:
    pair={}
    for side,path in [('current',ROOT/'figures'/old_file),('repository',ROOT/'figures'/new_file)]:
        raw=path.read_bytes(); hashed=hashlib.sha256(raw).hexdigest(); destination=ROOT/'figures'/(hashed+'.png')
        if destination.exists(): assert destination.read_bytes()==raw
        else: destination.write_bytes(raw)
        pair[side]={'path':'figures/'+destination.name,'sha256':hashed}
    data['figureAssets'][ident]=pair
data['dataId']=digest(json.dumps(data,sort_keys=True,ensure_ascii=False))
for suggestion in data['suggestions']:
    assert suggestion['before'] in current.splitlines()[suggestion['line']-1], suggestion['id']
(ROOT/'review-data.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
template=(ROOT/'review-template.html').read_text() if (ROOT/'review-template.html').exists() else None
if template:
    assert template.count('/* REVIEW_DATA */')==1
    payload=json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
    (ROOT/'index.html').write_text(template.replace('/* REVIEW_DATA */',payload))
print(json.dumps({'changes':len(changes),'areas':{k:sum(x['area']==k for x in changes) for k in ('Main text','Appendices','Preamble','References')},'formatOnly':sum(x['formatOnly'] for x in changes),'currentSha256':data['currentSha256'],'appendixBaselineHashVerified':baseline_verified,'dataId':data['dataId'],'sources':len(sources)},indent=2))
