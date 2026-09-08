#!/usr/bin/env python3
"""Recover manuscript artifacts without changing originals or inferring authorship.

Requires Poppler (pdftotext/pdfinfo), Python standard library, and Git.
Downloads is supplied explicitly. Only manuscript-named files are admitted.
DOCX binaries/comments remain private; their hashes and structural counts are public.
"""
import argparse
import hashlib
import json
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def clean(text):
    text = unicodedata.normalize('NFKC', text)
    return re.sub(r'\s+', ' ', re.sub(r'(\w)-\n(?=[a-z])', r'\1', text)).strip()

def pdf_blocks(path):
    xml = ET.fromstring(run('pdftotext', '-bbox-layout', str(path), '-'))
    ns = {'h': 'http://www.w3.org/1999/xhtml'}
    records = []
    for number, page in enumerate(xml.findall('.//h:page', ns), 1):
        height = float(page.get('height'))
        for block in page.findall('.//h:block', ns):
            if float(block.get('yMin')) < 39 or float(block.get('yMax')) > height - 32:
                continue
            lines = []
            for line in block.findall('./h:line', ns):
                lines.append(' '.join(''.join(w.itertext()) for w in line.findall('./h:word', ns)))
            text = clean('\n'.join(lines))
            if text and not re.fullmatch(r'\d+', text):
                records.append({'page': number, 'bbox': [float(block.get(k)) for k in ('xMin','yMin','xMax','yMax')], 'text': text})
    return records

def docx_private(data):
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    import io
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        pars = []
        for p in root.findall('.//w:body/w:p', ns):
            accepted, rejected = [], []
            def walk(e, excluded=None):
                kind = e.tag.rsplit('}', 1)[-1]
                mode = kind if kind in ('ins', 'del') else excluded
                if kind in ('t', 'delText'):
                    if mode != 'del': accepted.append(e.text or '')
                    if mode != 'ins': rejected.append(e.text or '')
                for child in e: walk(child, mode)
            walk(p)
            if accepted or rejected:
                pars.append({'accepted': ''.join(accepted), 'rejected': ''.join(rejected)})
        changes = []
        for e in root.iter():
            if e.tag.rsplit('}', 1)[-1] in ('ins','del'):
                changes.append({'kind': e.tag.rsplit('}',1)[-1], 'author': e.get('{'+ns['w']+'}author'), 'date': e.get('{'+ns['w']+'}date'), 'text': ''.join(e.itertext())})
        comments = []
        if 'word/comments.xml' in z.namelist():
            for c in ET.fromstring(z.read('word/comments.xml')):
                comments.append({'id': c.get('{'+ns['w']+'}id'), 'author': c.get('{'+ns['w']+'}author'), 'date': c.get('{'+ns['w']+'}date'), 'text': ''.join(t.text or '' for t in c.findall('.//w:t',ns))})
        return {'paragraphs': pars, 'trackedChanges': changes, 'comments': comments}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--private-output', type=Path, required=True)
    parser.add_argument('--additional-download', action='append', default=[], help='Exact additional manuscript basename, e.g. a separately downloaded figure')
    args = parser.parse_args()
    public_root, private_root, repo_root = args.output.resolve(), args.private_output.resolve(), args.repo.resolve()
    if private_root.is_relative_to(public_root) or public_root.is_relative_to(private_root) or private_root.is_relative_to(repo_root):
        parser.error('--private-output must be outside the repository and separate from the public output tree')
    args.output.mkdir(parents=True, exist_ok=False)
    args.private_output.mkdir(parents=True, exist_ok=False)
    (args.output/'artifacts').mkdir()
    (args.output/'text').mkdir()
    (args.output/'recover-history.py').write_bytes(Path(__file__).read_bytes())
    artifacts, aliases, pdfs, private = {}, [], {}, []
    def add(data, name, origin, observation=None, commit=None):
        extension = Path(name).suffix.lower()
        digest = sha(data)
        identity = digest + extension
        record = {'source': name, 'origin': origin, 'artifact': identity}
        if observation: record['observedFileMtimeUTC'] = observation
        if commit: record['gitCommit'] = commit
        aliases.append(record)
        if identity in artifacts: return
        item = {'id': identity, 'sha256': digest, 'bytes': len(data), 'extension': extension, 'publication': 'source artifact'}
        artifacts[identity] = item
        if extension == '.docx':
            parsed = docx_private(data)
            item.update({'publication': 'hash only; collaborator comments and raw DOCX held for privacy review', 'paragraphs':len(parsed['paragraphs']), 'trackedChanges': len(parsed['trackedChanges']), 'comments':len(parsed['comments'])})
            parsed['source'] = name
            parsed['sha256'] = digest
            private.append(parsed)
            return
        path = args.output/'artifacts'/identity
        path.write_bytes(data)
        if extension == '.pdf':
            text = run('pdftotext','-layout',str(path),'-').decode('utf-8')
            (args.output/'text'/(digest+'.txt')).write_text(text)
            blocks = pdf_blocks(path)
            pdfs[digest] = {'id': digest, 'artifact': identity, 'source': name, 'pages': len(text.split('\f'))-1, 'blocks':blocks}
            item.update({'pages':pdfs[digest]['pages'], 'textSha256':sha(text.encode())})
    permitted = {'.pdf','.tex','.bib','.png','.docx','.md','.json'}
    for path in sorted(args.downloads.iterdir()):
        # A review export is not a historical manuscript; never sweep test or author decisions into publication.
        if re.match(r'(?i)^molarium-manuscript-decisions(?: \(\d+\))?\.json$',path.name): continue
        relevant = re.match(r'(?i)^(molarium|main(?: \(\d+\))?(?:\.|$)|fig1_molarium)',path.name)
        if not relevant and path.name not in args.additional_download: continue
        stamp = datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()
        if path.is_file() and path.suffix.lower() in permitted:
            add(path.read_bytes(),path.name,'Downloads',stamp)
        elif path.is_file() and path.suffix.lower()=='.zip':
            with zipfile.ZipFile(path) as z:
                for member in z.infolist():
                    name = member.filename
                    if '__MACOSX' in name or '/build/' in name or name.endswith('/') or Path(name).suffix.lower() not in permitted: continue
                    add(z.read(member),path.name+' :: '+name,'Downloads archive member',stamp)
        elif path.is_dir():
            for child in sorted(path.rglob('*')):
                if child.is_file() and child.suffix.lower() in permitted and 'build' not in child.relative_to(path).parts:
                    add(child.read_bytes(),str(child.relative_to(args.downloads)),'Downloads source directory',stamp)
    # Recover all reachable revisions of the main source and figures, including development branches.
    commits = run('git','-C',str(args.repo),'log','--all','--format=%H','--','paper').decode().splitlines()
    commits = list(dict.fromkeys(commits))
    for commit in commits:
        paths = run('git','-C',str(args.repo),'ls-tree','-r','--name-only',commit,'paper').decode().splitlines()
        for name in paths:
            if not (name.endswith(('.tex','.bib')) or (name.startswith('paper/figures/') and name.endswith(('.png','.pdf','.json')))): continue
            add(run('git','-C',str(args.repo),'show',commit+':'+name),name,'Git snapshot (not necessarily accepted)',commit=commit)
    # Non-committed manuscript files are explicitly distinct from Git snapshots.
    for root, label in [(args.repo, 'review-worktree source'), (args.repo.parent.parent,'marco working source'), (args.repo.parent.parent.parent/'molarium','earlier public worktree source')]:
        for name in ('paper/main.tex','paper/appendix-architecture.tex','paper/appendix-b-workflows.tex'):
            path = root/name
            if path.exists(): add(path.read_bytes(),name,label)
        for name in ('output/pdf/molarium-system-paper.pdf','output/pdf/molecular-design-tools-are-free-now.pdf','output/pdf/marco-stormm-validation-preprint.pdf','design-history/publications/sos1/designer-intent-2026-09-04/molarium-paper.pdf','paper/PROVENANCE-ARCHIVE.md','paper/provenance/manuscript-drafts-2026-08-26/README.md','paper/provenance/manuscript-drafts-2026-08-26/manifest.json'):
            path = root/name
            if path.exists(): add(path.read_bytes(),name,label)
    manifest = {'schema':'molarium.manuscript-recovery/v1','recoveredDate':'2026-09-06','builderSha256':sha(Path(__file__).read_bytes()),'policy':{'authorship':'Not inferred from metadata, filenames, Git authors, or similarity. Use declared lineage evidence separately.','dates':'Filesystem and ZIP dates are observations, not proven edit chronology.','originals':'Read-only; exact bytes retained by SHA-256.','coverage':'Named manuscript files in Downloads, named source bundles, all reachable Git paper snapshots; not unseen Prism sessions or private conversations.','comments':'Raw collaborator DOCX and comments stay private pending review.','publication':'Prepared for repository review; inclusion here does not mean publication or editorial approval.'},'artifacts':list(artifacts.values()),'aliases':aliases,'gitCommits':commits}
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (args.output/'pdf-records.json').write_text(json.dumps(pdfs,ensure_ascii=False,indent=2)+'\n')
    (args.private_output/'docx-review.json').write_text(json.dumps(private,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'artifacts':len(artifacts),'aliases':len(aliases),'pdfs':len(pdfs),'gitCommits':len(commits),'bytes':sum(x['bytes'] for x in artifacts.values()),'docx':[{'source':x['source'],'paragraphs':len(x['paragraphs']),'changes':len(x['trackedChanges']),'comments':len(x['comments'])} for x in private]},indent=2))

if __name__ == '__main__': main()
