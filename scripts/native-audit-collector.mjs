import assert from 'node:assert/strict';

// The public API exposes a bounded recent-history window. Collect completed
// native records as the replay advances so presentation cues cannot evict the
// beginning of a long scientific story from its movie's audit artifact.
export function createNativeAuditCollector() {
  const records = [];
  return {
    get throughSequence() { return records.at(-1)?.sequence || 0; },
    append(chunk) {
      for (const record of chunk) {
        if (record.status === 'running' || record.sequence <= this.throughSequence) continue;
        assert.equal(record.sequence, this.throughSequence + 1,
          'Native audit collection has a gap; refusing an incomplete movie audit');
        assert(['completed','failed'].includes(record.status));
        records.push(structuredClone(record));
      }
    },
    snapshot() { return structuredClone(records); },
  };
}
