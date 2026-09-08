import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const revision=new URL('../revisions/2026-09-06-current-sos1-api-a05/',import.meta.url);
const text=readFileSync(process.env.MOLARIUM_MANUSCRIPT_PATH || new URL('main.tex',revision),'utf8').split('\\appendixsection{Editorial history:')[0];
const pinned=process.env.MOLARIUM_PUBLIC_CODE_COMMIT || '2ab30383d6160349aa3b1e980f7239d6854b329d';
const moduleSource=execFileSync('git',['show',`${pinned}:chemist-actions.mjs`],{encoding:'utf8'});
const {CHEMIST_ACTION_DEFINITIONS:definitions}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));

function objectAt(start) {
  let depth=0,quote='',escape=false;
  for(let i=start;i<text.length;i++) {
    const c=text[i];
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&!--depth)return text.slice(start,i+1);
  }
  throw Error('Unclosed API example object');
}

test('every Appendix A/B execute example names a current action and only declared argument keys',()=>{
  const names=new Set();let examples=0;
  for(const match of text.matchAll(/await api\.execute\(\s*\{/g)) {
    const literal=objectAt(text.indexOf('{',match.index));
    // Evaluate only the isolated, reviewed object literal; no API or application is invoked.
    // Placeholder variables stand in for the explicitly contextual example inputs.
    const placeholders=Object.create(null);let value;
    for(let n=0;n<25;n++) {
      try {value=runInNewContext('('+literal+')',placeholders,{timeout:100,contextCodeGeneration:{strings:false,wasm:false}});break;}
      catch(error){const missing=error.message.match(/^([A-Za-z_$][\w$]*) is not defined$/);if(!missing)throw error;placeholders[missing[1]]='EXAMPLE_CONTEXT_REQUIRED';}
    }
    assert.ok(value?.action, literal);
    assert.ok(Object.hasOwn(definitions,value.action),value.action);
    const allowed=definitions[value.action].arguments;
    for(const key of Object.keys(value.args??{})) {
      assert.ok(Object.hasOwn(allowed,key),`${value.action}: undeclared argument ${key}`);
      const vocabulary=allowed[key];
      if(typeof value.args[key]==='string' && /^[a-z][a-z0-9-]*(?: \| [a-z][a-z0-9-]*)+$/.test(vocabulary))
        assert.ok(vocabulary.split(' | ').includes(value.args[key]),`${value.action}.${key}: unsupported value ${value.args[key]}`);
    }
    if(value.action==='calculation.run' && value.args?.options?.conformerEffort) {
      const publicHtml=execFileSync('git',['show',`${pinned}:index.html`],{encoding:'utf8'});
      const effortSelect=publicHtml.match(/<select[^>]+id="conformer-effort"[^>]*>([\s\S]*?)<\/select>/);
      assert.ok(effortSelect,'Conformer effort select not found in pinned UI');
      const choices=[...effortSelect[1].matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
      assert.ok(choices.includes(value.args.options.conformerEffort),`Unsupported conformer effort ${value.args.options.conformerEffort}; public UI: ${choices.join(', ')}`);
    }
    names.add(value.action);examples++;
  }
  assert.ok(examples>=40);
  console.log(`${examples} example envelopes / ${names.size} action names checked against ${pinned}; molecular preconditions and GPU results are not executed by this test.`);
});

test('updated scientific run and current API distinctions remain explicit',()=>{
  assert.match(text,/0\.851 and 1\.880/);
  assert.match(text,/seven exact saved checkpoints/);
  assert.match(text,/159 (?:executable )?public actions/);
  assert.match(text,/five one-second popups/);
  assert.match(text,/checkpoint-popups-v2\/movie\.json/);
  assert.match(text,/Explicit Resume restores/);
  assert.match(text,/twelve nested levels/);
  assert.match(text,/32,768 nodes/);
  assert.match(text,/Neither minimization lane enforces the docking hydrogen-bond restraints/);
  assert.match(text,/f32 force-evaluation coordinates lose precision/);
  assert.doesNotMatch(text,/BCL-xL|CDK2|one-click promotion.*not currently exposed|62\.58|908\.5/);
  assert.match(text,/47 fixed-f32-input cases and 42 of 47 original-input cases/);
});
