"""Replace the JavaScript adapter listing with lossless native action JSON."""
from pathlib import Path
import hashlib, json, subprocess, sys, zipfile

here = Path(__file__).resolve().parent
root = here.parents[1]
base = root / 'paper/revisions/2026-09-06-sos1-executable-protocol-a14'
name = sys.argv[2] if len(sys.argv) > 2 else '2026-09-07-native-json-listing-a15'
revision = root / 'paper/revisions' / name
full_path = root / 'design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json'
full_bytes = full_path.read_bytes()
assert hashlib.sha256(full_bytes).hexdigest() == '7eed2dff0bf3fa127f87b2322aaea4b615d458ad6d8ef3af3c5b5886dc8fe9c3'
full = json.loads(full_bytes)
indices = [36, 37, 38, 41]
actions = [{k:full['actions'][i][k] for k in ('caption','action','args','expect') if k in full['actions'][i]} for i in indices]
excerpt = {'schema':full['schema'], 'label':'SOS1 AWW contact placement and ligand lock (excerpt)', 'actions':actions}

def pretty(value, indent=0):
    pad = ' ' * indent
    if not isinstance(value, (dict,list)):
        return json.dumps(value, ensure_ascii=False)
    # Atom selectors and numerical vectors stay together; nothing is abbreviated.
    if isinstance(value, dict) and value and all(not isinstance(v,(dict,list)) for v in value.values()) and 'atomName' in value:
        fields=[json.dumps(k)+': '+json.dumps(v,ensure_ascii=False) for k,v in value.items()]
        lines=[]
        current='{'
        for n,field in enumerate(fields):
            token=field+(',' if n<len(fields)-1 else '')
            if len(current)+len(token)+indent>88 and current!='{':
                lines.append(current)
                current=' '*(indent+2)+token
            else:
                current+=(' ' if current!='{' else '')+token
        lines.append(current+'}')
        return '\n'.join(lines)
    if isinstance(value, list) and all(not isinstance(v,(dict,list)) for v in value):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value,dict):
        rows = [' '*(indent+2)+json.dumps(k)+': '+pretty(v,indent+2) for k,v in value.items()]
        return '{\n'+',\n'.join(rows)+'\n'+pad+'}'
    rows = [' '*(indent+2)+pretty(v,indent+2) for v in value]
    return '[\n'+',\n'.join(rows)+'\n'+pad+']'

printed = pretty(excerpt)
assert json.loads(printed) == excerpt
source = (base / 'main.tex').read_text()
start = source.index('Listing~\\ref{lst:sos1api} expresses')
end = source.index('The complete \\href',start)
before = source[start:end]
after = r'''Listing~\ref{lst:sos1api} uses Molarium's native JSON action format. Each caption states the chemical purpose; \texttt{action} names the operation, \texttt{args} specifies its inputs, and \texttt{expect} records checks on the returned result. The runner executes these records directly through the public API and stops on a failed action or expectation. No JavaScript adapter is required: the same action record is both a readable protocol step and an executable instruction.

The excerpt retains the two contact declarations, bounded ligand-placement operation, and ligand lock from the published replay, including all their arguments and recorded expectations. It starts from the prepared AWW graph with a captured propagation reference and no prior manual contacts; the two declarations therefore create \texttt{manual-hbond-1} and \texttt{manual-hbond-2}. Intervening inspection-only calls and audit identifiers are omitted. Preparation and subsequent receptor calculations remain in the complete script.

\begin{lstlisting}[language={},caption={Native executable action records for the AWW ligand hypothesis and coordinate lock.},label={lst:sos1api}]
''' + printed + r'''
\end{lstlisting}

'''
old_main = 'pseudocode together with a public API code excerpt.'
new_main = 'pseudocode together with an excerpt in the native executable JSON action format.'
args = ['--base',base.name,'--revision',name,'--before',before,'--after',after,'--before',old_main,'--after',new_main]
subprocess.run([sys.executable,str(here/'apply-approved-text-edit.py'),sys.argv[1],*args],check=True)
if sys.argv[1] == 'build':
    (revision/'sos1-design-intent-excerpt.action-script.json').write_text(printed+'\n')
    (revision/'sos1-full-executable.action-script.json').write_bytes(full_bytes)
    (revision/'protocol-evidence.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(full_bytes).hexdigest(),'sourceActionIndices':indices,'retainedFields':['caption','action','args','expect'],'omittedFields':['auditSequence','auditRequestId'],'omittedInterveningActions':'session.inspect only','formattingOnly':True,'newScientificCalculations':False},indent=2)+'\n')
else:
    assert (revision/'sos1-design-intent-excerpt.action-script.json').read_text().rstrip() == printed
    assert (revision/'sos1-full-executable.action-script.json').read_bytes() == full_bytes
    suffix = name.rsplit('-',1)[-1]
    bundle = root/f'output/prism/molarium-prism-author-approved-{suffix}.zip'
    with zipfile.ZipFile(bundle,'a',zipfile.ZIP_DEFLATED) as z:
        for f in ('sos1-design-intent-excerpt.action-script.json','sos1-full-executable.action-script.json','protocol-evidence.json'):
            z.write(revision/f,f)
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == len(set(z.namelist())) == 12
    print('Native JSON listing: all four actions, arguments, captions and expectations match the frozen script.')
