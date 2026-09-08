import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateActionScript,replayActionScript} from '../../design-history/replay.mjs';
import {CHEMIST_ACTIONS_SCHEMA} from '../../chemist-actions.mjs';
const revision=new URL('../revisions/2026-09-07-native-json-current-appendix-a18/',import.meta.url);
const excerpt=JSON.parse(readFileSync(new URL('sos1-design-intent-excerpt.action-script.json',revision)));
const full=JSON.parse(readFileSync(new URL('sos1-full-executable.action-script.json',revision)));
test('native printed JSON is valid and preserves source arguments, captions and expectations',()=>{
  validateActionScript(excerpt);
  excerpt.actions.forEach((action,i)=>{
    const original=full.actions[[36,37,38,41][i]];
    for(const key of ['caption','action','args','expect']) assert.deepEqual(action[key],original[key]);
  });
  const tex=readFileSync(new URL('main.tex',revision),'utf8');
  const start=tex.indexOf('\n{\n',tex.indexOf('label={lst:sos1api}'));
  const printed=tex.slice(start,tex.indexOf('\\end{lstlisting}',start)).trim();
  assert.deepEqual(JSON.parse(printed),excerpt);
  assert.doesNotMatch(tex,/pseudocode|prepared on 2 September|specifyAwwIntent/);
});
test('the production runner rejects a missing declared outcome and stops before the lock',async()=>{
  let calls=0;
  const replay=await replayActionScript({schema:CHEMIST_ACTIONS_SCHEMA,
    execute:async()=>{calls++;return {result:{}};}},excerpt);
  assert.equal(replay.status,'failed');
  assert.equal(calls,3);
  assert.match(replay.steps[2].error,/designerBranchContact\.externalReferenceCoordinatesUsed is unavailable/);
});
