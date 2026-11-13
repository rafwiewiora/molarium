import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmilesNormalizer} from './ligand-normalization.mjs';
class WorkerStub{
  static last;listeners={};messages=[];
  constructor(){WorkerStub.last=this;}
  addEventListener(type,callback){this.listeners[type]=callback;}
  postMessage(m){this.messages.push(m);}
  emit(data){this.listeners.message({data});}
  terminate(){this.terminated=true;}
}
test('normalization preserves result identity, caches successful chemistry and isolates aborts',async()=>{
  const normalize=createSmilesNormalizer({WorkerClass:WorkerStub}),abort=new AbortController();
  const first=normalize('input1',{signal:abort.signal}),second=normalize('input2');
  const rejected=assert.rejects(first,/cancelled/);abort.abort(new Error('cancelled'));await rejected;
  const w=WorkerStub.last;w.emit({id:w.messages[0].id,type:'result',canonicalSmiles:'late',rdkitVersion:'test'});
  assert.equal(w.messages[0].type,'run');assert.equal(w.messages[0].job,'smiles-canonical');
  w.emit({id:w.messages[1].id,type:'result',canonicalSmiles:'c1ccccc1-c2ccccc2',rdkitVersion:'test'});
  assert.equal((await second).canonicalSmiles,'c1ccccc1-c2ccccc2');
  assert.equal((await normalize('input2')).rdkitVersion,'test');assert.equal(w.messages.length,2);
  const failed=normalize('invalid'),check=assert.rejects(failed,/invalid chemistry/);
  w.emit({id:w.messages.at(-1).id,type:'error',message:'invalid chemistry'});await check;
});
