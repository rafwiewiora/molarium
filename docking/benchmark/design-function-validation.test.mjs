import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const base=new URL('../../reviews/design-validation-2026-09-06/',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const summary=JSON.parse(await readFile(new URL('summary.json',base)));
const expected=['parp2-distal-halogen','p38-thiocarbonyl','cdk2-meta-chloro'];

test('frozen three-system evidence is complete and byte-verifiable',async()=>{
  assert.deepEqual(summary.results.map(x=>x.id),expected);
  assert.equal(hash(await readFile(new URL('protocol.json',base))),summary.protocolSha256);
  assert.equal(hash(await readFile(new URL('design-function-validation.mjs',import.meta.url))),summary.runnerSha256);
  for(const r of summary.results) {
    const bytes=gunzipSync(await readFile(new URL(r.id+'.json.gz',base)));
    assert.equal(hash(bytes),r.rawSha256);assert.equal(bytes.length,r.rawBytes);
    assert.equal(JSON.parse(bytes).status,'completed-observations');
    assert(r.positive.candidates>0);assert(r.positive.coverageComplete);
    assert.equal(r.positive.protectedDisplacement.maximumAngstrom,0);
    assert(r.positive.protectedDisplacement.compared>=19);
    for(const lane of [r.fastPocket,r.inducedFit]) {
      assert.equal(lane.accepted,true);assert.equal(lane.error,null);
      assert.equal(lane.undoMaximumLigandDisplacementAngstrom,0);
      assert(lane.contactAudit.length>0);
    }
  }
});

test('live post-relaxation geometry is independently recoverable from raw coordinates',async()=>{
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  for(const r of summary.results) {
    const raw=JSON.parse(gunzipSync(await readFile(new URL(r.id+'.json.gz',base))));
    for(const [name,derived] of [['fastPocket',r.fastPocket],['relaxation',r.inducedFit]]) {
      const pocket=raw.stages[name].pocket;
      const atoms=new Map(pocket.atoms.map(x=>[x.atomId,x.coordinatesAngstrom]));
      for(const c of derived.contactAudit) {
        const contact=pocket.contacts.find(x=>x.contactId===c.id),p=contact.hydrogenBond.participants;
        const d=atoms.get(p.donor.atomId),h=atoms.get(p.hydrogen.atomId),a=atoms.get(p.acceptor.atomId);
        assert(d&&h&&a,'Contact participants must be present even when pocket is truncated');
        const dh=distance(d,h),ha=distance(h,a),da=distance(d,a);
        const angle=Math.acos(Math.max(-1,Math.min(1,(dh*dh+ha*ha-da*da)/(2*dh*ha))))*180/Math.PI;
        assert(Math.abs(ha-c.hydrogenAcceptorAngstrom)<1e-12);
        assert(Math.abs(da-c.donorAcceptorAngstrom)<1e-12);
        assert(Math.abs(angle-c.dhaDegrees)<1e-10);
      }
    }
  }
});

test('dropped intent and chemistry-blocked negative controls cannot become a blanket pass',()=>{
  assert.equal(summary.allPropagationContractsPass,false);
  const cdk=summary.results.find(x=>x.id==='cdk2-meta-chloro');
  assert.equal(cdk.propagationGates.originalRequiredContactSetPreserved,false);
  assert.equal(cdk.positive.droppedRequiredContacts.length,1);
  assert.match(cdk.positive.droppedRequiredContacts[0].label,/N7.*HOH/);
  assert.equal(cdk.negative.chemistryValid,false);
  assert.match(cdk.negative.error,/kekulizing/);
  for(const r of summary.results.slice(0,2)) {
    assert.equal(r.negative.chemistryValid,true);
    assert.match(r.negative.error,/no role-compatible replacement/);
    assert(r.negative.contacts.some(c=>c.required&&!c.available));
  }
  assert(summary.results.some(r=>r.fastPocket.contactAudit.some(c=>Math.abs(c.cachedDistanceDeltaAngstrom)>0.05)));
});

test('an impossible but chemically valid contact rejects poses until explicitly omitted',async()=>{
  const raw=JSON.parse(gunzipSync(await readFile(new URL('impossible-contact.json.gz',base))));
  assert.equal(hash(await readFile(new URL('design-impossible-contact.mjs',import.meta.url))),raw.runnerSha256);
  assert.equal(raw.status,'passed');assert(raw.donorAcceptorAngstrom>8);
  assert.equal(raw.impossible.candidates,8);assert.equal(raw.impossible.feasible,0);
  assert.equal(raw.applyRejected,true);
  assert.match(raw.applyError,/infeasible|violates|required/i);
  assert.equal(raw.omittedControl.feasible,8);
  assert(raw.records.some(r=>r.action==='pose.setContact'&&r.args.required===false));
});
