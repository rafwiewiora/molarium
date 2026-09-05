import assert from 'node:assert/strict';
import { createNativeAuditCollector } from './native-audit-collector.mjs';
const collector = createNativeAuditCollector();
for (let i = 1; i <= 810; i++) {
  collector.append(Array.from({ length:Math.min(i,500) }, (_, j) => ({
    sequence:Math.max(1,i-499)+j, action:'session.inspect', status:'completed',
  })));
}
assert.equal(collector.snapshot().length, 810);
assert.equal(collector.throughSequence, 810);
collector.append([{ sequence:811, status:'running' }]);
assert.equal(collector.throughSequence, 810);
collector.append([{ sequence:811, status:'failed', error:'native failure' }]);
assert.equal(collector.snapshot().at(-1).error, 'native failure');
assert.throws(() => collector.append([{ sequence:813, status:'completed' }]), /has a gap/);
const copy = collector.snapshot(); copy[0].action = 'modified';
assert.equal(collector.snapshot()[0].action, 'session.inspect');
console.log('Incremental native audit collection: PASS');
